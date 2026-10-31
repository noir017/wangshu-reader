# 望舒 Android app

WebView 壳 + 内置服务端。前端（`npm run build` 的产物）打进 APK，由 WebViewAssetLoader 挂在 `https://localhost/`。

两种服务端模式，在「设置 → 服务端 → 服务端模式」里切换：

- **本机**（默认）：app 启动时在后台拉起内置服务端（Termux 编的 node 24 跑 `server/`），只监听 `127.0.0.1`，带每台设备随机生成的令牌，前端自动连上。
- **远程**：不起内置服务端，用设置里填的服务端地址和令牌。允许局域网 http 服务端。

两种模式共用同一个页面源，书架、进度、标注不会因为切换模式而丢。

文件管理器等的「打开方式」里有望舒：选了就把书导入书架并直接打开（同 PWA 的「用本应用打开」）。原生把收到的 content uri 挂在 `https://localhost/__opened/<编号>`，页面取来导入。

## 构建

需要 Node 22+、JDK 17+、Android SDK（platform 34）、`curl` `dpkg-deb` `readelf` `python3` `zip`。在仓库根目录：

```bash
npm install
android/scripts/build.sh            # 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

脚本依次做：前端构建 → `assets/www`；服务端用 esbuild 打成单文件连同 `node-unrar-js` 压成 `assets/server.zip`；没有 node 时执行 `scripts/fetch-node.sh`，从 Termux 仓库取 `nodejs-lts` 及依赖库（校验 sha256），改名成 `lib*.so` 放进 `jniLibs/arm64-v8a`；最后 `gradlew assembleDebug`。

`build.sh release` 打发版包：设了 `WANGSHU_KEYSTORE`（keystore 路径）、`WANGSHU_KEYSTORE_PASSWORD`（口令）、`WANGSHU_KEY_ALIAS`（别名，默认 `wangshu`）就用发版密钥签名，否则用 debug 签名。打 `v*` tag 时 `.github/workflows/release.yml` 会用仓库 secrets 里的发版密钥打包并附到 Release。版本号取自 `package.json`。

在 arm64 Linux 上构建：Google 的 aapt2 只出 x86_64，用 Debian 的 `aapt` 包，并在 `~/.gradle/gradle.properties` 写 `android.aapt2FromMavenOverride=/usr/lib/android-sdk/build-tools/debian/aapt2`。它读不了 android-35 的资源表，所以 compileSdk 停在 34。

## 限制

- 只支持 arm64 手机。
- 内置服务端没有 7z / ddjvu / espeak-ng：CHM、DJVU、压缩包浏览不可用，朗读只有 Edge 在线语音。封面缩略图不缩放。
- 服务端书库目录是 app 专属目录 `Android/data/io.github.noir017.wangshu/files/books`。
- 还没接原生能力：导出/备份下载、分享、音量键翻页、系统朗读、后台朗读。
