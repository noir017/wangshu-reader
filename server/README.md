# wangshu-reader 服务端

Node + [Hono](https://hono.dev)。替浏览器做它做不到的事：跨域代理、格式转换/解包、内置 WebDAV、在线朗读、翻译/词典、服务端书库、网页传书、字体目录；同时托管前端静态文件（`dist`）。接口契约见 `shared/api.ts`。

## 运行

```bash
npm run dev:server          # tsx watch，默认 127.0.0.1:8090

# 部署
npm run build && npm run build:server       # 前端 → dist/，服务端 → dist-server/index.mjs（依赖保持 external，需要 node_modules）
MR_HOST=0.0.0.0 MR_TOKEN=换成长随机串 MR_LIBRARY_DIR=/books npm start
```

要求：Node ≥ 22（用到 `zlib.crc32`）。启动日志会打印各能力的开关；`GET /api/health` 返回同样的 `features`，前端据此置灰功能。

## 系统依赖（都可选，缺了对应能力自动关闭）

| 程序 | 用途 | 缺了会怎样 |
|---|---|---|
| `7z`（Debian/Ubuntu 包 `7zip`，或 `7zz`/`7za`） | 压缩包列目录/取条目、cbr/cb7/zip → cbz、chm → epub | `features.convert = false`，相关接口 501；书库里的压缩包不能进去浏览 |
| `ddjvu`（`djvulibre-bin`） | djvu → pdf | `features['convert.djvu'] = false` |
| `espeak-ng` | 离线朗读后备 | 只有 Edge 在线朗读 |
| `fc-list`（`fontconfig`） | 取系统字体的 family 名 | 回退到自己解析字体文件的 name 表 |

**RAR 说明**：Debian 的 `7zip` 包去掉了非自由的 RAR 解压代码，能列目录但压缩过的条目解不出来（`Unsupported Method`）。所以 RAR/CBR 的内容读取走 npm 依赖 `node-unrar-js`（官方 unrar 的 WASM 版，RAR 3/4/5），不需要装系统包；该库是进程级单例，服务端内部串行化。另有可选依赖 `@napi-rs/canvas` 用来缩放封面缩略图（没有就原图返回）。

## 环境变量

所有配置都来自环境变量（`server/src/config.ts`）。布尔值 `0/false/off/no` 为假。

| 变量 | 默认 | 说明 |
|---|---|---|
| `MR_HOST` / `MR_PORT` | `127.0.0.1` / `8090` | 监听地址。要给局域网/公网用才改 `0.0.0.0`，**同时务必设 `MR_TOKEN`** |
| `MR_TOKEN` | 空（不鉴权） | 访问令牌，见「安全」 |
| `MR_DATA_DIR` | `<cwd>/server/data` | 持久数据：`dav/`（WebDAV）、`cache/tts/`、`cache/thumbs/`、`tmp/` |
| `MR_TMP_DIR` | `<MR_DATA_DIR>/tmp` | 转换/解包的临时目录（大文件，放大盘） |
| `MR_STATIC_DIR` | `<cwd>/dist` | 前端静态文件目录，不存在就不托管；未知路径回退 `index.html` |
| `MR_LIBRARY_DIR` | 空（关闭书库） | 服务端书库根目录，多个用 `:` 分隔（各根以目录名作第一段路径） |
| `MR_LIBRARY_READONLY` | `0` | 书库只读：禁用上传/新建/改名/拷贝/移动/删除 |
| `MR_FONTS_DIR` | 空 | 用户字体目录，`:` 分隔 |
| `MR_FONTS_SYSTEM` | `1` | 是否同时列出系统字体目录（`/usr/share/fonts` 等） |
| `MR_DAV` | `1` | 内置 WebDAV（`/dav`） |
| `MR_PROXY` | `auto` | `auto`：设了 `MR_TOKEN` 或请求直接来自本机才开放；`on`：一律开放；`off`：关闭 |
| `MR_PROXY_ALLOW_HOSTS` | 空 | 逗号分隔的主机白名单（`example.com` 含子域，`*.example.com` 只含子域）；非空时其余主机一律拒绝，重定向也检查 |
| `MR_PROXY_BLOCK_PRIVATE` | `0` | 禁止代理到回环/内网地址（10/8、172.16/12、192.168/16、100.64/10、127/8、::1、fc00::/7）。默认关，因为 Calibre/NAS 就在内网 |
| `MR_PROXY_TIMEOUT_MS` | `30000` | 空闲超时（连接、等响应头、数据间隔）；前端可用 `X-Proxy-Timeout`（秒，≤300）逐请求覆盖 |
| `MR_PROXY_MAX_REDIRECTS` | `10` | 最多跟随重定向次数 |
| `MR_PROXY_INSECURE_TLS` | `0` | 不校验目标 HTTPS 证书（自签名的 Calibre/NAS；原 app 也是全信任） |
| `MR_PROXY_USER_AGENT` | `Mozilla/5.0 (compatible; WangshuReader/0.1; +opds)` | 默认 UA；前端用 `X-Proxy-User-Agent` 覆盖 |
| `MR_MAX_CONVERT_MB` | `1024` | `/api/convert`、`/api/archive/*` 接收的原文件上限 |
| `MR_MAX_UPLOAD_MB` | `4096` | 书库上传、`/dav` PUT 的单文件上限，`0` 不限 |
| `MR_MAX_EXTRACT_MB` | `4096` | 压缩包解开后总大小上限（防压缩炸弹） |
| `MR_ARCHIVE_CODEPAGES` | `936` | 无 UTF-8 标志的老 zip 文件名的重试代码页（逗号分隔，936 = GBK；繁体可加 `950`） |
| `MR_TTS` | `auto` | `auto`/`edge`：Edge 在线朗读，本机有 `espeak-ng` 作后备；`off`：关闭在线朗读 |
| `MR_TTS_CACHE_MB` | `256` | 合成音频的磁盘缓存上限，`0` 关闭缓存 |
| `MR_TTS_DEFAULT_VOICE` | 按文字语言选 | 没指定声音时的默认声音（如 `zh-CN-XiaoxiaoNeural`） |
| `MR_EDGE_TTS_WSS` / `MR_EDGE_TTS_VOICES` | 微软官方端点 | Edge 朗读的 WebSocket / 声音列表端点；微软改接口时可不改代码覆盖 |
| `MR_TRANSLATE_PROVIDER` | `google` | 默认翻译引擎：`google`（免费 gtx 端点，被拦时自动换 dict-chrome-ex）、`deepl`、`libretranslate`、`mymemory` |
| `MR_DEEPL_KEY` / `MR_DEEPL_URL` | 空 | DeepL key（以 `:fx` 结尾走免费端点）；`MR_DEEPL_URL` 可自定义端点 |
| `MR_LIBRETRANSLATE_URL` / `MR_LIBRETRANSLATE_KEY` | 空 | 自建 LibreTranslate 的地址与 key |
| `MR_BIN_<NAME>` | 空 | 直接指定外部程序路径，如 `MR_BIN_7Z=/opt/7zz`、`MR_BIN_DDJVU`、`MR_BIN_ESPEAK_NG`、`MR_BIN_FC_LIST` |

## 安全

- **鉴权**：设了 `MR_TOKEN` 后，`/api/*` 需要 `Authorization: Bearer <token>`，或 `?token=`（给 `<img>`/`<audio>`/`<a>` 直链用）；`/dav` 用 HTTP Basic（用户名随意，**密码填令牌**）。`/api/health`、`/transfer` 页面本身、前端静态文件不需要令牌。没设 `MR_TOKEN` 就完全不鉴权——只应在本机/可信内网使用，监听非本机地址时启动日志会警告。令牌比较用常数时间。
- **没设令牌时的跨站防护**：CORS 对 API 是全开的（单文件版从 `file://` 打开，Origin 为 `null`），所以没设 `MR_TOKEN` 时服务端会拒绝「来源是别的站点」的请求（`Origin` 既不是 `null`、本机、IP 字面量，也不等于请求的 `Host`/`X-Forwarded-Host`），免得你随手打开的恶意网页就能读书库、借代理打内网。不带 `Origin` 的客户端（curl、WebDAV 客户端）不受影响。拦不住 DNS 重绑定和 `Origin: null` 的沙箱页面——想彻底防就设 `MR_TOKEN`。
- **没有内置 TLS**：令牌走明文，公网请放在 HTTPS 反向代理后面。反代需要：放行 WebDAV 方法（PROPFIND/MKCOL/MOVE/COPY…）、关闭请求体缓冲与大小限制（nginx：`client_max_body_size 0; proxy_request_buffering off;`）、关闭响应缓冲（朗读/大文件）、挂在子路径时带 `X-Forwarded-Prefix`（WebDAV 的 href 与词典发音地址会用它）。
- **代理（`/api/proxy`）是最大的暴露面**——它会替调用方去访问任意 URL。取舍：
  - 默认 `MR_PROXY=auto`：**没设令牌时只对「直接来自本机」的请求开放**；带 `X-Forwarded-For`/`Forwarded`/`X-Real-IP` 的请求（说明前面有反代，所有外部请求看起来都是 127.0.0.1）一律不算本机。所以单机自用零配置可用，一旦公开部署就必须设令牌，否则代理自动关闭（`/api/health` 的 `features.proxy` 如实反映，前端会置灰）。
  - 链路本地与云元数据地址（169.254/16、100.100.100.200、fe80::/10、fd00:ec2::254）**永远禁止**，IPv4 映射/NAT64/6to4 写法的 IPv6 同样识别；检查发生在 DNS 解析之后的连接阶段，所以域名重绑定、重定向到禁止地址都拦得住。
  - 内网地址默认**不**禁止（Calibre、NAS、局域网 OPDS 是主要用途）；公网部署建议加 `MR_PROXY_BLOCK_PRIVATE=1`，并用 `MR_PROXY_ALLOW_HOSTS` 只放行要用的站点。
  - 跨主机重定向不带 `Authorization`/`Cookie`；目标的 `WWW-Authenticate`、`Set-Cookie` 改名成 `X-Proxy-WWW-Authenticate`、`X-Proxy-Set-Cookie`（避免浏览器弹登录框、避免把第三方 cookie 种到本站）。
- **书库与 WebDAV**：路径只接受相对路径，拒绝 `..` 与 NUL；每次访问都 `realpath` 后确认仍在根内，所以指向根外的符号链接读不到、写不进、不在列表里出现；上传/新建时文件名净化成单段；写入先落 `.mr-part` 临时文件再改名。书库里用户上传的内容一律带 `X-Content-Type-Options: nosniff` 与 `Content-Security-Policy: sandbox`，html/svg/xml 强制下载，防同源 XSS。压缩包解包忽略符号链接条目，路径净化后落在临时目录内。
- 词典发音文件（`/api/dict/audio`）只允许从几个固定的词典站点取，不是通用代理。
- Edge 朗读和 Google 免费翻译用的是**未公开承诺的接口**，可能随时变动或被限流（数据中心 IP 尤其容易被 Google 拦）；失败时接口返回 502 与原因，前端会降级。

## 接口

全部见 `shared/api.ts`。补充约定（契约注释里没写、前端已在用的）：

- `/api/proxy`：额外支持请求头 `X-Proxy-User-Agent`（覆盖 UA）、`X-Proxy-Method`（覆盖方法）、`X-Proxy-Timeout`（秒）；响应额外头 `X-Proxy-Error: 1`（代理自己出的错，body 为 `{error}`）、`X-Proxy-WWW-Authenticate`、`X-Proxy-Set-Cookie`；URL 里的 `user:pass@` 会转成 Basic 认证；请求体 ≤ 8 MB 缓冲转发（307/308 可重放），更大的流式转发。
- `/api/library`：路径里 `?` 之后是压缩包内路径（`Comics/a.cbr?vol1/001.jpg`）；压缩包条目只读、不支持 Range；`hidden=1` 显示隐藏项；搜索结果被截断时带 `X-Truncated: 1`；单个书库根时路径里不出现根名，多个根时第一段是根名（目录名重复自动加 `-2`）。上传目录不存在会自动创建；重名自动加 ` (1)`，`&overwrite=1` 覆盖。拷贝时目录内指向书库外的符号链接被跳过。
- `/api/library/thumb`：封面缓存在 `<MR_DATA_DIR>/cache/thumbs`，按「路径+mtime+size+尺寸」做键，取不到封面也缓存（负缓存）。
- `/api/convert`：CHM 按 `#SYSTEM` 的语言 ID 决定页面编码（GBK/Big5/Shift-JIS/…，页面自带 `<meta charset>` 优先），按 `.hhc` 生成 EPUB 目录（带 NCX），内部链接大小写不敏感改写；cbz 页序用自然排序（`page2` 在 `page10` 之前）。生成的 zip 不支持 zip64（> 4 GB 报错）。
- `/api/tts`：`audio/mpeg`（Edge）或 `audio/wav`（espeak），响应头 `X-Tts-Engine`、`X-Tts-Voice`；声音可以是完整名（`zh-CN-XiaoxiaoNeural`）、只给语言（`zh`、`en-GB`）或 `espeak:<语言>`；单次文本 ≤ 20000 字，Edge 内部按句切成 ≤ 2000 字分段合成再拼接；时钟偏差导致 403 时按服务端 `Date` 校准重试。
- `/api/dict`：来源 `youdao`（中英互查）、`freedict`（英英）、`wiktionary`（多语种），`source=auto` 按词的语言与目标语言排序依次尝试；返回的 `html` 已清洗（只含白名单标签，class 只有 `mr-*` 钩子供前端上样式）；`audio` 是本服务端的绝对 URL（设了令牌会带 `&token=`）。`GET /api/dict/sources` 列出来源。
- `/dav`：OPTIONS、PROPFIND（Depth 0/1，`infinity` 按 1 处理）、PROPPATCH（只回执）、GET/HEAD（Range）、PUT（`If-Match`/`If-None-Match`）、DELETE、MKCOL、MOVE、COPY（`Overwrite`、`Depth`）、LOCK/UNLOCK（假锁，仅为 Windows/macOS 客户端满意）。父目录不存在时 PUT/MKCOL/MOVE/COPY 返回 409（符合 RFC，客户端要逐级 MKCOL）。已用 npm 包 `webdav` 做过端到端验证。

## 测试

```bash
npx vitest run server                    # 全部（不需要外网）
MR_TEST_NET=1 npx vitest run server      # 加跑联网用例：真实 OPDS 代理、Edge 朗读、Google 翻译、有道/Wiktionary
npx tsc -p server/tsconfig.json --noEmit
```

测试里的 Edge 朗读用本地 WebSocket 替身，DJVU/espeak 用替身脚本（`MR_BIN_*`）。需要真实样本的用例在样本不存在时自动跳过：`samples/rar/*.rar`（RAR 压缩样本，无法程序生成）、`samples/chm/*.chm`（`samples/` 不进 git）。联调用的样例书库：`npx tsx server/scripts/make-sample-library.ts <目录>`。

## 已知限制

- CBR/RAR 的 RAR 解压每次要把条目解到临时目录再回传（库不支持流式）；固实（solid）大包取单个条目要解到该条目为止。
- 不支持带密码的压缩包（返回 422）。
- `/dav` 是单用户、无真实锁；`Depth: infinity` 不递归。
- 在线朗读不返回词边界时间戳（前端按句高亮）。
