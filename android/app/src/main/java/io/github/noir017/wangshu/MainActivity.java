package io.github.noir017.wangshu;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.util.Log;
import android.view.DisplayCutout;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
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

import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Collections;
import java.util.Set;
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
    /** 状态栏颜色由前端取页面顶边的颜色发来；全屏阅读时隐藏状态栏和导航栏 */
    private int barColor = Color.WHITE;
    private boolean barLight = true;
    private boolean fullscreen;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("wangshu", MODE_PRIVATE);
        if (server == null) server = new LocalServer(this, prefs);

        root = new FrameLayout(this);
        root.setBackgroundColor(barColor);
        // targetSdk 35 在 Android 15 上强制全面屏，WebView 拿不到系统栏的 safe-area，内容会钻到状态栏底下：直接按系统栏/键盘留边。
        // 全屏时窗口铺进刘海（见 applySystemBars），再按刘海的安全区留边，留出的那一条是 root 的底色（= 页面顶边色）
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int l = insets.getSystemWindowInsetLeft(), t = insets.getSystemWindowInsetTop();
            int r = insets.getSystemWindowInsetRight(), b = insets.getSystemWindowInsetBottom();
            DisplayCutout cut = fullscreen && Build.VERSION.SDK_INT >= 28 ? insets.getDisplayCutout() : null;
            if (cut != null) {
                l = Math.max(l, cut.getSafeInsetLeft());
                t = Math.max(t, cut.getSafeInsetTop());
                r = Math.max(r, cut.getSafeInsetRight());
                b = Math.max(b, cut.getSafeInsetBottom());
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
                return loader.shouldInterceptRequest(req.getUrl());
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
                    case "setMode": {
                        String mode = "remote".equals(msg.optString("mode")) ? "remote" : "local";
                        if (!mode.equals(mode())) {
                            prefs.edit().putString("mode", mode).apply();
                            boot();
                        }
                        break;
                    }
                    case "statusBar":
                        barColor = Color.parseColor(msg.optString("color"));
                        barLight = msg.optBoolean("light", true);
                        applySystemBars();
                        break;
                    case "fullscreen":
                        fullscreen = msg.optBoolean("on");
                        applySystemBars();
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
                // 页面要重新加载：先退出全屏，页面起来后会按自己的状态再发
                if (fullscreen) {
                    fullscreen = false;
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

    /** 状态栏底色、图标深浅，全屏时隐藏状态栏和导航栏（从屏幕边缘划入可临时呼出） */
    @SuppressWarnings("deprecation")
    private void applySystemBars() {
        Window w = getWindow();
        View decor = w.getDecorView();
        w.setStatusBarColor(barColor);
        root.setBackgroundColor(barColor);
        // 默认模式下隐藏状态栏后，刘海那一条是窗口外的黑边；全屏时才铺进去，平时保持默认，布局和以前一样
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            int cutMode = fullscreen ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            if (lp.layoutInDisplayCutoutMode != cutMode) {
                lp.layoutInDisplayCutoutMode = cutMode;
                w.setAttributes(lp);
            }
        }
        // API 30 上旧标志位仍会盖过新接口（主题里写了 windowLightStatusBar），所以图标深浅新旧两套都设，同 androidx 的 WindowInsetsControllerCompat
        int hide = View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
        int flags = decor.getSystemUiVisibility() & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (barLight) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT < 30) flags = fullscreen ? flags | hide : flags & ~hide;
        decor.setSystemUiVisibility(flags);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c == null) return;
            c.setSystemBarsAppearance(barLight ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS : 0,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
            if (fullscreen) {
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsets.Type.systemBars());
            } else {
                c.show(WindowInsets.Type.systemBars());
            }
        }
    }

    /** 旧系统弹过对话框、键盘后会清掉沉浸标志，回到焦点时重设 */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && fullscreen) applySystemBars();
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
        if (isFinishing()) bg.execute(server::stop);
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
