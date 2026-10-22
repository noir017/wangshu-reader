package io.github.noir017.wangshu;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * app 内置服务端：Termux 编的 node（jniLibs 里的 libnode.so，见 scripts/fetch-node.sh）跑 assets/server.zip 里打好包的服务端。
 * Android 10+ 只允许执行 nativeLibraryDir 里的文件，所以 node 不能放进数据目录。
 * 只监听 127.0.0.1，但手机上任何 app 都能连回环地址，所以一律带每台设备随机生成的令牌。
 */
final class LocalServer {
    static final class Status {
        final String url;
        final String token;
        final boolean ok;
        final String error;

        Status(String url, String token, boolean ok, String error) {
            this.url = url;
            this.token = token;
            this.ok = ok;
            this.error = error;
        }
    }

    private static final String TAG = "WangshuServer";
    /** 固定端口优先：内置 WebDAV 之类会把地址存进设置，端口每次变就失效了；被占用才随机 */
    private static final int PREFERRED_PORT = 18090;
    private static final long START_TIMEOUT_MS = 20_000;

    private final Context ctx;
    private final SharedPreferences prefs;
    private Process proc;
    private Status status;
    /** 最近的输出，启动失败时拿来当原因 */
    private final ArrayDeque<String> tail = new ArrayDeque<>();

    LocalServer(Context ctx, SharedPreferences prefs) {
        this.ctx = ctx.getApplicationContext();
        this.prefs = prefs;
    }

    /** 启动并等到 /api/health 通（阻塞，别在主线程调）；已在跑就直接返回 */
    synchronized Status start() {
        if (proc != null && proc.isAlive() && status != null && status.ok) return status;
        stop();
        String token = token();
        int port = pickPort();
        String url = "http://127.0.0.1:" + port;
        try {
            File dir = installServer();
            File nativeDir = new File(ctx.getApplicationInfo().nativeLibraryDir);
            File node = new File(nativeDir, "libnode.so");
            if (!node.exists()) return status = new Status(url, token, false, "APK 里没有 node（libnode.so）");

            File data = new File(ctx.getFilesDir(), "server-data");
            File tmp = new File(ctx.getCacheDir(), "server-tmp");
            File books = ctx.getExternalFilesDir("books");
            //noinspection ResultOfMethodCallIgnored
            tmp.mkdirs();

            // --use-bundled-ca：Termux 版 node 默认去 Termux 目录找根证书，这里没有
            ProcessBuilder pb = new ProcessBuilder(node.getPath(), "--use-bundled-ca", new File(dir, "index.mjs").getPath())
                    .directory(dir)
                    .redirectErrorStream(true);
            Map<String, String> env = pb.environment();
            env.put("LD_LIBRARY_PATH", nativeDir.getPath());
            env.put("HOME", ctx.getFilesDir().getPath());
            env.put("TMPDIR", tmp.getPath());
            env.put("MR_HOST", "127.0.0.1");
            env.put("MR_PORT", String.valueOf(port));
            env.put("MR_TOKEN", token);
            env.put("MR_DATA_DIR", data.getPath());
            env.put("MR_TMP_DIR", tmp.getPath());
            if (books != null) {
                //noinspection ResultOfMethodCallIgnored
                books.mkdirs();
                env.put("MR_LIBRARY_DIR", books.getPath());
            }
            proc = pb.start();
            pumpOutput(proc.getInputStream());
            return status = waitHealthy(url, token);
        } catch (IOException e) {
            Log.e(TAG, "start failed", e);
            stop();
            return status = new Status(url, token, false, String.valueOf(e.getMessage()));
        }
    }

    synchronized void stop() {
        status = null;
        if (proc == null) return;
        proc.destroy();
        try {
            if (!proc.waitFor(2, TimeUnit.SECONDS)) proc.destroyForcibly();
        } catch (InterruptedException e) {
            proc.destroyForcibly();
            Thread.currentThread().interrupt();
        }
        proc = null;
    }

    private Status waitHealthy(String url, String token) {
        long deadline = System.currentTimeMillis() + START_TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline) {
            if (!proc.isAlive()) return new Status(url, token, false, "node 退出（" + proc.exitValue() + "）：" + lastOutput());
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url + "/api/health").openConnection();
                c.setConnectTimeout(500);
                c.setReadTimeout(1000);
                int code = c.getResponseCode();
                c.disconnect();
                if (code == 200) return new Status(url, token, true, null);
            } catch (IOException ignored) {
                // 还没开始监听
            }
            try {
                Thread.sleep(200);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        return new Status(url, token, false, "启动超时：" + lastOutput());
    }

    private String token() {
        String t = prefs.getString("server_token", null);
        if (t == null) {
            byte[] b = new byte[24];
            new SecureRandom().nextBytes(b);
            StringBuilder sb = new StringBuilder();
            for (byte x : b) sb.append(String.format("%02x", x));
            t = sb.toString();
            prefs.edit().putString("server_token", t).apply();
        }
        return t;
    }

    private static int pickPort() {
        try (ServerSocket s = new ServerSocket(PREFERRED_PORT, 1, InetAddress.getByName("127.0.0.1"))) {
            return s.getLocalPort();
        } catch (IOException e) {
            try (ServerSocket s = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
                return s.getLocalPort();
            } catch (IOException e2) {
                return PREFERRED_PORT;
            }
        }
    }

    /** 把 assets/server.zip 解到 files/server；APK 没更新过就沿用上次解好的 */
    private File installServer() throws IOException {
        File dir = new File(ctx.getFilesDir(), "server");
        long stamp;
        try {
            stamp = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).lastUpdateTime;
        } catch (PackageManager.NameNotFoundException e) {
            stamp = -1;
        }
        if (dir.isDirectory() && prefs.getLong("server_stamp", 0) == stamp) return dir;
        deleteTree(dir);
        String root = dir.getCanonicalPath() + File.separator;
        byte[] buf = new byte[64 * 1024];
        try (ZipInputStream zin = new ZipInputStream(ctx.getAssets().open("server.zip"))) {
            for (ZipEntry e; (e = zin.getNextEntry()) != null; ) {
                File f = new File(dir, e.getName());
                if (!f.getCanonicalPath().startsWith(root)) throw new IOException("bad entry " + e.getName());
                if (e.isDirectory()) {
                    //noinspection ResultOfMethodCallIgnored
                    f.mkdirs();
                    continue;
                }
                //noinspection ResultOfMethodCallIgnored
                f.getParentFile().mkdirs();
                try (OutputStream out = new FileOutputStream(f)) {
                    for (int n; (n = zin.read(buf)) > 0; ) out.write(buf, 0, n);
                }
            }
        }
        prefs.edit().putLong("server_stamp", stamp).apply();
        return dir;
    }

    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    /** node 的输出进 logcat 和 files/server.log（覆盖写，只留本次运行） */
    private void pumpOutput(InputStream in) {
        File log = new File(ctx.getFilesDir(), "server.log");
        synchronized (tail) {
            tail.clear();
        }
        Thread t = new Thread(() -> {
            try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
                 PrintWriter w = new PrintWriter(new FileOutputStream(log), true)) {
                for (String line; (line = r.readLine()) != null; ) {
                    Log.i(TAG, line);
                    w.println(line);
                    synchronized (tail) {
                        tail.addLast(line);
                        if (tail.size() > 5) tail.removeFirst();
                    }
                }
            } catch (IOException ignored) {
                // 进程结束
            }
        }, "server-log");
        t.setDaemon(true);
        t.start();
    }

    private String lastOutput() {
        synchronized (tail) {
            return tail.isEmpty() ? "无输出" : String.join(" / ", tail);
        }
    }
}
