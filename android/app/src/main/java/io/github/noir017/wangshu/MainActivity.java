package io.github.noir017.wangshu;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.provider.OpenableColumns;
import android.util.Log;
import android.view.DisplayCutout;
import android.view.Gravity;
import android.view.PixelCopy;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * WebView 壳。前端（assets/www）由 WebViewAssetLoader 挂在 https://localhost/ 下：两种服务端模式共用这一个页面源，
 * IndexedDB 里的书架数据不会因为切模式而分家。服务端只是前端里的一个地址：
 * - 本机模式：启动内置服务端（LocalServer），把地址和令牌注入页面；
 * - 远程模式：不起服务端，前端用设置里填的远程地址。
 */
public class MainActivity extends Activity {
    private static final String TAG = "Wangshu";
    private static final String ORIGIN = "https://localhost";
    private static final Set<String> ORIGINS = Collections.singleton(ORIGIN);
    private static final int REQ_FILE = 1;
    /** 「用望舒打开」收到的文件挂在 ORIGIN + OPENED + 编号 上，页面 fetch 时现读 content uri */
    private static final String OPENED = "/__opened/";

    /** 进程级：Activity 重建（比如从后台回来）不重启服务端 */
    private static LocalServer server;
    private static final ExecutorService bg = Executors.newSingleThreadExecutor();

    private SharedPreferences prefs;
    private FrameLayout root;
    private WebView web;
    private TextView splash;
    private ScriptHandler hostScript;
    private boolean loaded;
    private ValueCallback<Uri[]> fileCallback;
    /** 状态栏颜色：页面一变就对它顶边实际画出来的像素取色（sampleTop）；前端发来的估计色只在取不到时用 */
    private int barColor = Color.WHITE;
    private boolean barLight = true;
    private int hintColor = Color.WHITE;
    private boolean hintLight = true;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable sampler = this::sampleTop;
    /** 注入给页面的状态栏高度（CSS px）：阅读页顶部按它留出那一条 */
    private double statusCss;
    /** 阅读页：铺满全屏（顶部那条由页面自己留），状态栏透明；hideStatus / hideNav 由前端按全屏设置和菜单栏显隐发来 */
    private boolean reader, hideStatus, hideNav;
    /** 主题里的导航栏颜色，离开阅读页时还原 */
    private int navColor;
    /** 编号 → 别的 app 发来的 uri；shouldInterceptRequest 在 WebView 的后台线程读 */
    private final Map<String, Uri> opened = new ConcurrentHashMap<>();
    private int openedSeq;
    /** 还没交给页面的文件地址：页面发来 ready 才交，页面没起来时先攒着 */
    private final List<String> pendingOpen = new ArrayList<>();
    /** 当前页面的回信通道，页面重新加载就作废 */
    private JavaScriptReplyProxy page;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("wangshu", MODE_PRIVATE);
        if (server == null) server = new LocalServer(this, prefs);

        navColor = getWindow().getNavigationBarColor();
        root = new FrameLayout(this);
        root.setBackgroundColor(barColor);
        // targetSdk 35 在 Android 15 上强制全面屏，WebView 拿不到系统栏的 safe-area，内容会钻到状态栏底下：直接按系统栏/键盘留边。
        // 阅读页铺满全屏：顶部不留（页面按注入的 statusBarHeight 自己留，状态栏显隐时正文高度不变），两侧、底部按刘海/导航栏/键盘留
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int l = insets.getSystemWindowInsetLeft(), t = insets.getSystemWindowInsetTop();
            int r = insets.getSystemWindowInsetRight(), b = insets.getSystemWindowInsetBottom();
            if (reader) {
                t = 0;
                // 铺满全屏后键盘不再缩小窗口，按键盘高度留底
                if (Build.VERSION.SDK_INT >= 30) b = Math.max(b, insets.getInsets(WindowInsets.Type.ime()).bottom);
                DisplayCutout cut = Build.VERSION.SDK_INT >= 28 ? insets.getDisplayCutout() : null;
                if (cut != null) {
                    l = Math.max(l, cut.getSafeInsetLeft());
                    r = Math.max(r, cut.getSafeInsetRight());
                    b = Math.max(b, cut.getSafeInsetBottom());
                }
            }
            v.setPadding(l, t, r, b);
            // WindowInsets.CONSUMED 是 API 30 才有的，直接引用在 Android 8~10 上会 NoSuchFieldError
            if (Build.VERSION.SDK_INT >= 30) return WindowInsets.CONSUMED;
            WindowInsets rest = insets.consumeSystemWindowInsets();
            return Build.VERSION.SDK_INT >= 28 ? rest.consumeDisplayCutout() : rest;
        });
        web = new WebView(this);
        root.addView(web);
        splash = new TextView(this);
        splash.setText(R.string.starting);
        splash.setGravity(Gravity.CENTER);
        splash.setBackgroundColor(Color.WHITE);
        root.addView(splash);
        setContentView(root);

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
                || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            splash.setText(R.string.webview_too_old);
            return;
        }
        setupWebView();
        boot();
        // 重建或从最近任务里恢复时 getIntent() 还是当初那个 VIEW，不能再打开一遍
        if (savedInstanceState == null && (getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) takeOpened(getIntent());
    }

    /** singleTask：app 已在运行时，文件管理器发来的 VIEW 走这里 */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        takeOpened(intent);
    }

    /** 「用望舒打开」：记下 uri，交给页面导入后打开 */
    private void takeOpened(Intent intent) {
        if (!Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
        String id = String.valueOf(++openedSeq);
        opened.put(id, intent.getData());
        pendingOpen.add(ORIGIN + OPENED + id);
        deliverOpened();
    }

    private void deliverOpened() {
        if (page == null || pendingOpen.isEmpty()) return;
        try {
            page.postMessage(new JSONObject().put("type", "openFiles").put("urls", new JSONArray(pendingOpen)).toString());
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        pendingOpen.clear();
    }

    /** 页面 fetch 收到的文件：现读 content uri；文件名放在 X-File-Name（前端按扩展名认格式） */
    private WebResourceResponse openedFile(String id) {
        Uri uri = id == null ? null : opened.get(id);
        if (uri != null) {
            try {
                ContentResolver cr = getContentResolver();
                String type = cr.getType(uri);
                String name = openedName(uri, type);
                InputStream in = cr.openInputStream(uri);
                if (in != null) {
                    return new WebResourceResponse(type != null ? type : "application/octet-stream", null, 200, "OK",
                            Collections.singletonMap("X-File-Name", Uri.encode(name)), in);
                }
            } catch (IOException | RuntimeException e) {
                // 这里在 WebView 的 IO 线程，异常漏出去整个 app 就崩了
                Log.w(TAG, "open " + uri, e);
            }
        }
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
    }

    private String openedName(Uri uri, String type) {
        String name = null;
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (RuntimeException e) {
            // 有的 provider 不支持查询，退回路径
        }
        if (name == null || name.isEmpty()) name = uri.getLastPathSegment();
        if (name == null) name = "";
        name = name.substring(name.lastIndexOf('/') + 1);
        if (name.isEmpty()) name = "book";
        // 没扩展名时按 MIME 补一个，前端才认得出格式
        String ext = type == null ? null : MimeTypeMap.getSingleton().getExtensionFromMimeType(type);
        if (name.indexOf('.') < 0 && ext != null) name += "." + ext;
        return name;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        // 页面是 https，远程模式下局域网服务端常是 http
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        // 排版字号由阅读设置决定，不跟系统字体缩放
        s.setTextZoom(100);

        WebViewAssetLoader.AssetsPathHandler assets = new WebViewAssetLoader.AssetsPathHandler(this);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain("localhost")
                .addPathHandler("/", path -> assets.handle("www/" + (path.isEmpty() ? "index.html" : path)))
                .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                String path = u.getPath();
                if ("https".equals(u.getScheme()) && "localhost".equals(u.getHost()) && path != null && path.startsWith(OPENED)) {
                    return openedFile(u.getLastPathSegment());
                }
                return loader.shouldInterceptRequest(u);
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                page = null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("https".equals(u.getScheme()) && "localhost".equals(u.getHost())) return false;
                openExternal(u);
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                // 前端的 accept 写的是扩展名（.epub,.mobi…），系统选择器只认 MIME，按扩展名过滤会把书过滤光，所以不限类型
                Intent i = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(i, REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            /** window.open（外部链接、词典网页等）：交给系统浏览器 */
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView probe = new WebView(MainActivity.this);
                probe.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                        openExternal(req.getUrl());
                        v.destroy();
                        return true;
                    }
                });
                ((WebView.WebViewTransport) resultMsg.obj).setWebView(probe);
                resultMsg.sendToTarget();
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.messageLevel() + " " + m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });

        // 前端 → 原生：只收 app 自己页面主框架发的消息
        WebViewCompat.addWebMessageListener(web, "WangshuAndroid", ORIGINS, (view, message, sourceOrigin, isMainFrame, reply) -> {
            if (!isMainFrame || message.getData() == null) return;
            try {
                JSONObject msg = new JSONObject(message.getData());
                switch (msg.optString("type")) {
                    case "ready":
                        page = reply;
                        deliverOpened();
                        break;
                    case "setMode": {
                        String mode = "remote".equals(msg.optString("mode")) ? "remote" : "local";
                        if (!mode.equals(mode())) {
                            prefs.edit().putString("mode", mode).apply();
                            boot();
                        }
                        break;
                    }
                    case "statusBar":
                        hintColor = Color.parseColor(msg.optString("color"));
                        hintLight = msg.optBoolean("light", true);
                        scheduleSample();
                        break;
                    case "reader":
                        reader = msg.optBoolean("on");
                        hideStatus = reader && msg.optBoolean("hideStatus");
                        hideNav = reader && msg.optBoolean("hideNav");
                        applySystemBars();
                        scheduleSample();
                        break;
                    default:
                        break;
                }
            } catch (JSONException | IllegalArgumentException e) {
                Log.w(TAG, "bad message " + message.getData());
            }
        });
    }

    private String mode() {
        return prefs.getString("mode", "local");
    }

    /** 按当前模式启停内置服务端，把宿主信息注入页面后（重新）加载 */
    private void boot() {
        String mode = mode();
        splash.setVisibility(View.VISIBLE);
        bg.execute(() -> {
            LocalServer.Status st = null;
            if ("local".equals(mode)) st = server.start();
            else server.stop();
            LocalServer.Status status = st;
            runOnUiThread(() -> {
                if (isDestroyed()) return;
                // 页面要重新加载：先退出阅读页布局，页面起来后会按自己的状态再发
                if (reader) {
                    reader = hideStatus = hideNav = false;
                    applySystemBars();
                }
                injectHost(mode, status);
                if (loaded) web.reload();
                else web.loadUrl(ORIGIN + "/");
                loaded = true;
                splash.setVisibility(View.GONE);
                if (status != null && !status.ok) Toast.makeText(this, "内置服务端没有启动：" + status.error, Toast.LENGTH_LONG).show();
            });
        });
    }

    /** window.__WANGSHU_HOST__，结构见前端 src/core/host.ts；只注入 app 自己的源 */
    private void injectHost(String mode, LocalServer.Status st) {
        JSONObject host = new JSONObject();
        try {
            host.put("platform", "android");
            host.put("mode", mode);
            statusCss = statusBarCssHeight();
            host.put("statusBarHeight", statusCss);
            if (st != null) {
                JSONObject local = new JSONObject();
                local.put("url", st.url);
                local.put("token", st.token);
                local.put("ok", st.ok);
                if (st.error != null) local.put("error", st.error);
                host.put("local", local);
            }
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        if (hostScript != null) hostScript.remove();
        hostScript = WebViewCompat.addDocumentStartJavaScript(web, "window.__WANGSHU_HOST__=" + host + ";", ORIGINS);
    }

    /** 状态栏高度（CSS px）：取系统的 status_bar_height，刘海更高时取刘海 */
    @SuppressLint("DiscouragedApi")
    private double statusBarCssHeight() {
        int px = 0;
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        if (id > 0) px = getResources().getDimensionPixelSize(id);
        WindowInsets wi = root.getRootWindowInsets();
        if (wi != null && Build.VERSION.SDK_INT >= 30) px = Math.max(px, wi.getInsetsIgnoringVisibility(WindowInsets.Type.statusBars()).top);
        if (wi != null && Build.VERSION.SDK_INT >= 28 && wi.getDisplayCutout() != null) px = Math.max(px, wi.getDisplayCutout().getSafeInsetTop());
        return px > 0 ? px / getResources().getDisplayMetrics().density : 24;
    }

    /**
     * 系统栏。书架等页面是普通布局，状态栏涂成页面顶边的颜色；阅读页铺满全屏（刘海也铺进去），状态栏透明浮在页面上，
     * 按前端的要求隐藏状态栏 / 导航栏（从屏幕边缘划入可临时呼出）
     */
    @SuppressWarnings("deprecation")
    private void applySystemBars() {
        Window w = getWindow();
        View decor = w.getDecorView();
        w.setStatusBarColor(reader ? Color.TRANSPARENT : barColor);
        w.setNavigationBarColor(reader ? Color.TRANSPARENT : navColor);
        // 系统自己留出的边（比如没铺进去的刘海）露出来的是窗口底色，也跟页面顶边一致
        w.setBackgroundDrawable(new ColorDrawable(barColor));
        root.setBackgroundColor(barColor);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            int cutMode = reader ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            if (lp.layoutInDisplayCutoutMode != cutMode) {
                lp.layoutInDisplayCutoutMode = cutMode;
                w.setAttributes(lp);
            }
        }
        if (Build.VERSION.SDK_INT >= 30) w.setDecorFitsSystemWindows(!reader);
        // API 30 上旧标志位仍会盖过新接口（主题里写了 windowLightStatusBar），所以图标深浅新旧两套都设，同 androidx 的 WindowInsetsControllerCompat
        int flags = decor.getSystemUiVisibility() & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (barLight) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT < 30) {
            flags &= ~(View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            if (reader) flags |= View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            if (hideStatus) flags |= View.SYSTEM_UI_FLAG_FULLSCREEN;
            if (hideNav) flags |= View.SYSTEM_UI_FLAG_HIDE_NAVIGATION;
            if (hideStatus || hideNav) flags |= View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
        }
        decor.setSystemUiVisibility(flags);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.setSystemBarsAppearance(barLight ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS : 0,
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                if (hideStatus) c.hide(WindowInsets.Type.statusBars());
                else c.show(WindowInsets.Type.statusBars());
                if (hideNav) c.hide(WindowInsets.Type.navigationBars());
                else c.show(WindowInsets.Type.navigationBars());
            }
        }
        // 进出阅读页留边规则不同，重新分发一次
        root.requestApplyInsets();
    }

    /** 页面刚变过：等它画到屏幕上再取色；背景图解码、过渡动画收尾要晚一点才画完，再取一次 */
    private void scheduleSample() {
        ui.removeCallbacks(sampler);
        ui.postDelayed(sampler, 32);
        ui.postDelayed(sampler, 400);
    }

    /**
     * 对 WebView 顶边实际画出来的像素取色：阅读页铺满全屏，取状态栏底下那一条；其余页面在状态栏下方，取最上面几行。
     * 纹理、背景图、对话框遮罩都算在内（前端只读得到 CSS 底色）。取不到（窗口还没画、被别的窗口挡着）就用前端的估计色
     */
    private void sampleTop() {
        if (isDestroyed() || splash.getVisibility() == View.VISIBLE || !web.isAttachedToWindow()) return;
        float density = getResources().getDisplayMetrics().density;
        int w = web.getWidth();
        int h = Math.min(web.getHeight(), reader ? (int) Math.round(statusCss * density) : 3);
        if (w <= 0 || h <= 0) {
            setBar(hintColor, hintLight);
            return;
        }
        int[] at = new int[2];
        web.getLocationInWindow(at);
        // 缩小拷贝：纯色缩完还是原色，纹理、图片缩小正好先做了平均
        Bitmap bmp = Bitmap.createBitmap(Math.min(w, 120), Math.min(h, 12), Bitmap.Config.ARGB_8888);
        try {
            PixelCopy.request(getWindow(), new Rect(at[0], at[1], at[0] + w, at[1] + h), bmp, result -> {
                if (result == PixelCopy.SUCCESS && !isDestroyed()) {
                    int c = dominantColor(bmp);
                    setBar(c, Color.red(c) * 0.299 + Color.green(c) * 0.587 + Color.blue(c) * 0.114 >= 128);
                } else {
                    setBar(hintColor, hintLight);
                }
                bmp.recycle();
            }, ui);
        } catch (IllegalArgumentException e) {
            // 窗口没有可拷贝的 surface
            bmp.recycle();
            setBar(hintColor, hintLight);
        }
    }

    /** 一半以上像素同色就取它（纯色标题栏原样还原），否则取平均（纹理、图片） */
    private static int dominantColor(Bitmap b) {
        int n = b.getWidth() * b.getHeight();
        int[] px = new int[n];
        b.getPixels(px, 0, b.getWidth(), 0, 0, b.getWidth(), b.getHeight());
        Map<Integer, Integer> count = new HashMap<>();
        long r = 0, g = 0, bl = 0;
        for (int p : px) {
            r += Color.red(p);
            g += Color.green(p);
            bl += Color.blue(p);
            count.merge(p | 0xff000000, 1, Integer::sum);
        }
        for (Map.Entry<Integer, Integer> e : count.entrySet()) if (e.getValue() * 2 > n) return e.getKey();
        return Color.rgb((int) (r / n), (int) (g / n), (int) (bl / n));
    }

    private void setBar(int color, boolean light) {
        if (color == barColor && light == barLight) return;
        barColor = color;
        barLight = light;
        applySystemBars();
    }

    /** 旧系统弹过对话框、键盘后会清掉沉浸标志，回到焦点时重设；离开期间页面可能变了（定时换主题等），重新取色 */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && reader) applySystemBars();
        if (hasFocus) scheduleSample();
    }

    private void openExternal(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, u.toString(), Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_FILE || fileCallback == null) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                result = new Uri[n];
                for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacks(sampler);
        if (isFinishing()) bg.execute(server::stop);
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
