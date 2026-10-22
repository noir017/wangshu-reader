# 验收表：书架 / 书库 / 同步 / 网络书库 / 统计 / 备份（01-library）+ 服务端接口

阶段 4 整站验收，2026-10-22，基于最终工作区代码。状态：✅ 完成 / 🟡 部分 / ❌ 未做 / ⛔ 不做（用户已定或规格标 [不做]）。
证据里 `e2e X「…」` 指 `tests/e2e/accept.library.X.spec.ts` 的用例（真实构建产物 + 真实服务端），`u:` 指源码旁的单元测试。
路径缩写：`lib/` = `src/library/`，`st/` = `src/storage/`，`srv/` = `server/src/`。

**统计（73 条）**：✅ 67 · 🟡 2 · ❌ 0 · ⛔ 4（LIB-037、SYNC-009、SYNC-010、NET-006）。
**P0/P1 未完成**：LIB-001（P0，🟡：浏览器后退键不按书架下钻层级返回、首次启动不自动开抽屉、无「导入中断续导」）；LIB-034（P1，🟡：只有简体中文/英文，缺繁体与其他语言）。两项都要跨模块改造（路由历史、i18n 体系），留到后续。

## 部署形态（B 节第 7 条）

在最终代码上复测：`npx playwright test tests/e2e/accept.library.deploy.spec.ts`（构建标准版/单文件版到 out/accept-library，esbuild 打服务端，端口 5411–5414）→ 28/28 通过。

| 形态 | MR_TOKEN | 结果 | 证据 |
|---|---|---|---|
| ① 服务端托管整站（`MR_STATIC_DIR` = 标准构建） | 未设 | ✅ 设置页检测、网络书库（真实 Gutenberg 搜索→详情→下载→入书架）、文件页（浏览/面包屑/排序/搜索/新建/上传/改名/删除/ZIP 包内浏览）、网页传书 /transfer、WebDAV 同步（两个浏览器上下文经内置 /dav 同步进度与标注、云端备份在 B 恢复）、本地备份恢复、CHM/CBR/DJVU 经服务端转换后打开 | e2e deploy「部署形态：服务端托管 › …」7 条 |
| ① 服务端托管整站 | 设了 | ✅ 同上 7 条全部通过 | e2e deploy「部署形态：服务端托管 + MR_TOKEN › …」7 条 |
| ② file:// 单文件版，设置里填服务端地址 | 未设 | ✅ 同上（originGuard 对 `Origin: null` 放行） | e2e deploy「部署形态：file:// 单文件版 › …」7 条 |
| ② file:// 单文件版 | 设了 | ✅ 同上（令牌填在设置里，`Authorization: Bearer`；`<img>`/音频走 `?token=`） | e2e deploy「部署形态：file:// 单文件版 + MR_TOKEN › …」7 条 |
| 跨源（别的站点的页面连服务端） | 未设 | ✅ 被 originGuard 拒（403 带 CORS 头，页面能显示「请设置 MR_TOKEN」的说明，不崩溃）；同源用域名访问、file:// 放行 | e2e origin 前 3 条 |
| 跨源 | 设了 | ✅ 带令牌可用；没带令牌给出明确提示，填上后恢复；令牌填错时「检测连接」提示令牌不对 | e2e origin 后 2 条 |

## 功能表

| ID | 优先级 | 状态 | 证据 | 备注 |
|---|---|---|---|---|
| LIB-001 | P0 | 🟡 | lib/Shell.tsx TAB_ROUTES/lastTab；ShelfPage firstShelfShown；TopBar 标题点按滚到顶/底；e2e shelf「空书架：首次进入书架会弹出「导入书籍」对话框」、extras「冷启动回到上次停留的标签页」 | 缺：书架「书→分组→全部」下钻不进浏览器历史（浏览器后退直接离开书架，界面上的返回按钮正常）；首次启动不自动开抽屉；无「导入中断续导」 |
| LIB-002 | P0 | ✅ | lib/Drawer.tsx（收藏夹子列表、长按「继续阅读」最近 100 本、晚上模式） | 「退出」按规格不做 |
| LIB-003 | P1 | ✅ | lib/DashPage.tsx 6 行 + 统计卡片；e2e shelf「统计页与首页卡片…」 | 不记 lastDashItem |
| LIB-004 | P0 | ✅ | lib/RecentPage.tsx；e2e shelf「最近阅读：按打开顺序、进度、移除、「使用最近阅读作为开始页」」 | — |
| LIB-005 | P1 | ✅ | lib/Shell.tsx FAB_ROUTES/hideFab；设置「显示继续阅读浮动按键」 | 无首次点击提示 |
| LIB-006 | P0 | ✅ | shelf-model groupsOf/booksInGroup；e2e shelf「分类：全部 / 我的珍藏 / 书籍系列 / 书籍作者 / 书籍标签 / 存储目录，下钻与返回」 | 浏览器后退见 LIB-001 |
| LIB-007 | P0/P2 | ✅ | lib/BookViews.tsx Grid/List/CoverFlow；e2e shelf「视图：列表 / 格子 / 封面流…」「网格视图（木纹）」 | 封面流停留位置不保存 |
| LIB-008 | P0 | ✅ | shelf-model sortBooks；u:shelf-model「排序」；e2e shelf「…排序：书名 / 作者 / 导入时间 / 存储目录 / 最近阅读」 | — |
| LIB-009 | P0 | ✅ | shelf-model readStateOf/filterBooks；u:shelf-model「状态与类型过滤」 | — |
| LIB-010 | P0 | ✅ | shelf-model suggestFor；TopBar Suggest；e2e shelf「搜索：联想、回车后联想收起、无匹配提示」 | — |
| LIB-011 | P0 | ✅ | useSelection、book-menu；e2e shelf「多选：右键进入 → 批量标签、珍藏、改名收藏夹、阅读状态」 | — |
| LIB-012 | P0 | ✅ | lib/book-menu.tsx showBookMenu；e2e shelf「置顶 / 取消置顶；移出书架…」 | 桌面快捷方式按规格不做 |
| LIB-013 | P0 | ✅ | lib/BookInfo.tsx；e2e shelf「书籍信息：编辑系列/标签/珍藏并保存」 | — |
| LIB-014 | P0 | ✅ | actions setFavorite/renameFavorite；e2e shelf 同上与「多选…」 | — |
| LIB-015 | P1 | ✅ | actions addTags；BookInfo 系列+序号；u:moon-formats「标签+系列」 | — |
| LIB-016 | P1 | ✅ | actions setReadState；e2e shelf「多选：…阅读状态」 | — |
| LIB-017 | P1 | ✅ | actions setPinned；e2e shelf「置顶 / 取消置顶…」 | — |
| LIB-018 | P2 | ✅ | BookViews beginDrag；e2e extras「手动拖拽排序（LIB-018）…」 | 非书名排序时直接禁用拖动 |
| LIB-019 | P0/P1/P2 | ✅ | lib/covers.ts、CoverPicker；e2e shelf「改封面：上传图片 → 书架显示新封面 → 恢复」、extras「封面搜索限流…」；u:covers-search | 占位封面程序生成；Google Books 429 退避 + 冷却 + 友好提示（B4）；OPDS 封面有服务端时先走代理（本轮修复，避免控制台 CORS 报错） |
| LIB-020 | P1 | ✅ | theme.ts、useWoodImage、BookCover 进度；e2e shelf「夜间模式：抽屉里切换…」 | — |
| LIB-021 | P0 | ✅ | lib/import.ts（内容指纹去重）、ImportDialogs；e2e shelf「导入：文件选择器一次选多种格式」、extras「导入：拖放文件、ZIP（单本）、整个文件夹」 | — |
| LIB-022 | P1 | ✅ | ImportDialogs ImportSelect；e2e extras「…整个文件夹（先过滤再选择）」 | — |
| LIB-023 | P2 | ✅ | ImportDialogs NewBooksDialog；e2e shelf「导入：…」 | — |
| LIB-024 | P2 | ✅ | linked-dirs.ts；u:linked-dirs | 只 Chromium（File System Access） |
| LIB-025 | P1 | ✅ | open.ts → missing.tsx；e2e extras「失效书籍（LIB-025）…」 | 逐本重选文件 |
| LIB-026 | P0 | ✅ | book-menu removeFlow；e2e shelf「…移出书架（保留文件）与「同时删除文件」」 | — |
| LIB-027 | P2 | ✅ | ShelfPage 溢出菜单 randomBook | 无测试 |
| LIB-028 | P1 | ✅ | lib/files/*；e2e deploy「文件页：浏览 / 面包屑 / 排序 / 搜索 / 新建 / 上传 / 改名 / 删除 / ZIP 包内浏览」×4 形态、extras「文件页：格子布局、缩略图、拷贝/移动/粘贴、下载、未知类型提示、看图器、快速访问」 | — |
| LIB-029 | P2 | ✅ | files/FavFolders.tsx；e2e extras 同上 | — |
| LIB-030 | P0 | ✅ | NotesPage；e2e shelf「书签/标注汇总：徽章计数、过滤、颜色、搜索、单书列表、导出」 | — |
| LIB-031 | P0 | ✅ | settings/SettingsPage.tsx；e2e deploy「设置页「服务端」检测通过…」 | Android 专属项按规格去掉 |
| LIB-032 | P1 | ✅ | BookInfo 阅读速度/逐日明细；e2e shelf「统计页…单书统计…」 | — |
| LIB-033 | P2 | ✅ | lock.tsx（加盐迭代 SHA-256）；u:lock；e2e shelf「启动密码：设置、不一致提示、刷新后锁屏、错误/正确、直达阅读页也被拦、关闭」 | 指纹解锁不做 |
| LIB-034 | P1 | 🟡 | core/app-settings Lang；设置页语言下拉；e2e shelf「英文界面：…」 | 只有简体中文/英文（首次按浏览器语言选）；缺繁体中文与其他语言、显式「跟随系统」项 |
| LIB-035 | P1 | ✅ | formats detectFormat（像文本的未知文件按 TXT）；lib/import.ts UnsupportedFileError/asTextItem + ImportDialogs 询问「是否以纯文本模式打开？」（只有一本就直接打开）；FilesPage 服务端未知类型：纯文本/下载原文件；u:import；T/accept.reader.entries「类型不受支持的文件（LIB-035）…」 | 本轮补本机导入路径；内容里 NUL 超 5% 的纯二进制仍拒绝 |
| LIB-036 | P2 | ✅ | startup.ts（?open=、launchQueue）、pwa.ts、public/manifest.webmanifest；e2e pwa 5 条 | — |
| LIB-037 | P2 | ⛔ | book-menu shareBookFile（Web Share/下载） | 快捷方式/小部件规格标不做；「发送文件」已做 |
| LIB-038 | P2 | ✅ | lib/AboutPage.tsx | — |
| LIB-040 | P0 | ✅ | import.ts importFile/cleanDescription；formats 各解析器元数据 | — |
| LIB-041 | P0 | ✅ | st/db savePosition；st/sync 位置串；u:moon-formats「位置串」；e2e accept.reader.smoke「退出再进，进度恢复」 | bookId = 内容指纹 |
| LIB-042 | P0 | ✅ | st/db touchHistory/getHistory；e2e shelf「最近阅读…」 | 保留 1000 条 |
| LIB-043 | P0 | ✅ | st/db 软删除墓碑；moon-formats noteKey；u:moon-formats「墓碑…」 | — |
| LIB-044 | P1 | ✅ | BookRecord.onShelf=false（文件页直接打开服务端书） | — |
| LIB-045 | P2 | ✅ | 内容指纹 id，改名不影响进度/标注 | — |
| SYNC-001 | P1 | ✅ | settings/SyncSection.tsx；e2e deploy「WebDAV 同步：…」×4 形态 | Dropbox/GDrive 见下 |
| SYNC-002 | P1 | ✅ | st/sync uploadPosition/downloadPosition；u:sync | — |
| SYNC-003 | P1 | ✅ | st/sync uploadAnnotations/mergeRemoteAnnotations；u:sync「pullBook…墓碑」 | — |
| SYNC-004 | P2 | ✅ | st/sync uploadRecent/downloadRecent；e2e extras「最近阅读同步（SYNC-004/005）…」 | — |
| SYNC-005 | P2 | ✅ | st/sync uploadBookFile/downloadBookFile；e2e extras 同上 | 判重按同名同大小 |
| SYNC-006 | P1 | ✅ | lib/sync-service.ts（打开前预检、进入/离开阅读页、切后台上传、**阅读中回到前台重新拉取**、回书架读 recent.list）；u:sync-service（本轮新增） | 回到前台重拉是本轮补的（原 doSyncFromCloudOnResume）；断网不自动重试 |
| SYNC-007 | P1 | ✅ | st/sync remoteIsNewer/positionDiffers；u:sync | — |
| SYNC-008 | P1 | ✅ | st/webdav DavClient；srv/routes/dav.ts；u:webdav/dav | 内置 /dav：假 LOCK、Depth: infinity 按 1 处理（B5，只注明） |
| SYNC-009 | P1 | ⛔ | SyncSection 里 Dropbox 一行置灰，留 dropboxAppKey 接口 | 用户决定只留接口不实现（B6） |
| SYNC-010 | P2 | ⛔ | 同上（Google Drive） | 用户决定只留接口（B6） |
| SYNC-011 | P2 | ✅ | files/CloudImport.tsx；e2e extras「云端导入（SYNC-011）：浏览 WebDAV 目录，勾选书籍下载进书库」 | 只 WebDAV |
| SYNC-012 | P2 | ✅ | st/readwise；u:readwise；e2e extras「Readwise（SYNC-012）…」 | — |
| NET-001 | P1 | ✅ | catalogs.ts（内置站点、删除墓碑）、NetPage；u:catalogs（本轮新增）；e2e deploy「网络书库：真实 Gutenberg 搜索 → 详情 → 下载 → 入书架」×4 形态 | 本轮修复：删除内置站点刷新后又回来（墓碑写晚了，被并发的重新读取合并回去） |
| NET-002 | P1 | ✅ | opds.ts、NetPage 浏览栈；u:opds；e2e extras「网络书库（本地假 OPDS）：添加 → 浏览/分页 → 搜索 → 详情下载 → 编辑 → 置顶 → 删除」 | — |
| NET-003 | P1 | ✅ | opds-client searchFeed/discoverSearch；u:opds；e2e deploy/extras 搜索 | — |
| NET-004 | P1 | ✅ | net/NetBook.tsx；e2e deploy「…详情 → 下载 → 入书架」 | — |
| NET-005 | P1 | ✅ | net/CatalogDialogs.tsx；e2e extras「网络书库：需要登录的站点（401 → 登录对话框 → 记住账号）与 Calibre IP 入口」 | — |
| NET-006 | P2 | ⛔ | html 站点在新标签页打开 | 规格标不做 |
| NET-007 | P1 | ✅ | downloads.ts；u:opds-client「下载…」 | RAR 包不自动解出书 |
| NET-008 | P2 | ✅ | downloadFromLink；startup ?open=/?url=；e2e pwa「分享目标：…分享链接 → 走下载」 | — |
| NET-009 | P2 | ✅ | togglePinCatalog、搜索历史作用域；e2e extras NET 用例 | — |
| STAT-001 | P1 | ✅ | reader/ui ReadingTracker（含翻页数，A3）；st/db addReadingTime；u:reading-time、session-persist「翻页数统计」 | 本轮接上翻页数：统计卡片的页数不再恒为 0 |
| STAT-002 | P1 | ✅ | moon-formats parse/formatStatDates；u:moon-formats | — |
| STAT-003 | P1 | ✅ | lib/stats.ts computeStatCards；u:stats；e2e shelf「统计页与首页卡片：8 张卡片口径…」 | — |
| STAT-004 | P1 | ✅ | BookInfo、RecentPage、StatsPage | — |
| STAT-005 | P1 | ✅ | actions clearAllStatistics；e2e shelf「…清空统计」 | — |
| BAK-001 | P0/P1 | ✅ | st/backup createBackup/uploadCloudBackup；u:backup；e2e deploy「备份恢复：本地 .mrweb 备份（含书籍文件）…」 | 云端只 WebDAV |
| BAK-002 | P0/P1 | ✅ | st/backup parseBackup/restoreBackup；e2e deploy 同上、「…云端备份可在 B 恢复」；原版 .mrpro/.mrstd 导入：st/mrpro.ts + lib/mrpro-import.ts（sql.js 内联进单文件版）；u:mrpro、mrpro-import；e2e mrpro 3 条（托管版与 file:// 版各一） | .mrpro 导入是 B2，本轮完成 |
| BAK-003 | P1 | ✅ | notes-export toMrexpt、st/legacy；e2e extras「标注导出再导入（BAK-003）…」 | — |

## B 节核对

| 条目 | 结果 |
|---|---|
| B1 MISC-008 PWA | ✅ public/manifest.webmanifest（file_handlers、share_target、程序生成的 PNG/SVG 图标）、public/sw.js、index.html 引用、lib/pwa.ts（只在 http(s) 正式构建注册 SW；file:// 与 dev 跳过）。e2e pwa：manifest 无错误且可安装、SW 断网可开、分享目标、launchQueue、file:// 不注册且控制台无报错 |
| B2 .mrpro 导入 | ✅ 见 BAK-002 |
| B3 LIB-001 首次自动弹导入框 | ✅ 空书架首次进入自动弹（只弹一次），并补了冷启动回到上次标签页 |
| B4 封面搜索限流 | ✅ Google Books 429 按 Retry-After 退避一次、冷却 60 秒、提示「限流」而不是「失败」，自动换 Open Library |
| B5 带密码压缩包 422、/dav 假锁 | 注明：服务端对加密 RAR/ZIP 回 422（界面提示不支持）；内置 /dav 的 LOCK 是假锁、Depth: infinity 按 1 处理 |
| B6 Dropbox/Google Drive | ⛔ 用户决定只留接口 |
| B7 部署形态 | ✅ 见上文「部署形态」 |

## 服务端接口（shared/api.ts）

鉴权：设了 `MR_TOKEN` 时 `/api/*`、`/dav*` 要令牌（`Authorization: Bearer`、`Basic`（密码 = 令牌）、`?token=` 三种都认），`/api/health`、`/transfer` 页面、静态文件免令牌；没设时由 originGuard 放行无 Origin / `null` / 回环 / IP 字面量 / 与 Host 同名的来源，其余 403（非预检的 403 带 CORS 头，页面能读到说明——本轮修复）。`/api/proxy` 有 SSRF 防护。e2e server「MR_TOKEN：…」「originGuard（没设 MR_TOKEN）：…」、e2e origin 5 条。

| 接口 | 服务端实现 | 前端调用方 | 验证 | 备注 |
|---|---|---|---|---|
| `GET /api/health` | srv/index.ts | core/server checkServer；files-client checkLibrary；formats convert serverFeature | ✅ index.test 4 条；e2e server「GET /api/health 与前端托管」；deploy「设置页「服务端」检测通过」 | 免令牌，设置页另请求 `/api/translate/providers` 验令牌 |
| `ANY /api/proxy?url=` | srv/routes/proxy.ts | st/http proxyFetch/proxyUrl（OPDS、下载、自定义 WebDAV、封面） | ✅ proxy.test、abort.test；e2e server「/api/proxy：真实 Gutenberg OPDS、重定向最终地址、禁止地址」；deploy/extras 网络书库 | SSRF 字节级判定 IPv6 映射地址 |
| `POST /api/convert` | srv/routes/convert.ts | formats/lib/convert.ts convertViaServer | ✅ convert.test、chm.test；e2e server「/api/convert：CBR→CBZ、CHM→EPUB、DJVU→PDF、CB7→CBZ」；deploy「CHM / CBR / DJVU：…打开阅读页」×4 形态 | 无 7z 回 501 |
| `POST /api/archive/list` | srv/routes/convert.ts | formats/archive.ts | ✅ convert.test；e2e server「/api/archive/list 与 extract；带密码的 RAR 回 422」 | 加密包 422 |
| `POST /api/archive/extract` | srv/routes/convert.ts | formats/archive.ts | ✅ 同上 | 解包总量上限 |
| `/dav/*`（PROPFIND/PUT/GET(Range)/MKCOL/MOVE/COPY/DELETE/LOCK…） | srv/routes/dav.ts | st/webdav（同步、云端备份、云端导入、最近阅读） | ✅ dav.test；e2e server「/dav：…」；deploy「WebDAV 同步…」×4 形态 | 假 LOCK；Depth infinity 按 1 |
| `GET /api/tts/voices`、`POST /api/tts` | srv/routes/tts.ts | features/tts/engines.ts | ✅ tts.test；e2e server「/api/tts：声音列表与 espeak 离线合成」；features.tts-server（page.route 模拟） | Edge 非公开接口，espeak 兜底 |
| `POST /api/translate`、`GET /api/translate/providers` | srv/routes/translate.ts | features/dict/translate.ts；SettingsPage 验令牌 | ✅ translate.test；e2e server「/api/translate 与 /api/dict（外网）」；origin「令牌填错…」 | — |
| `GET /api/dict`、`/api/dict/sources`、`/api/dict/audio` | srv/routes/dict.ts | features/dict/LookupCard.tsx | ✅ dict.test；e2e server 同上 | audio 只允许白名单主机 |
| `GET /api/library/list`、`/search` | srv/routes/library.ts | lib/files/files-client.ts | ✅ library.test；e2e server「/api/library：list / file(Range) / search / 隐藏项 / 压缩包内浏览」「越界与符号链接逃逸被拒绝」；deploy 文件页 ×4 | 未配书库 503 |
| `GET /api/library/file`（Range）、`/thumb` | srv/routes/library.ts | files-client downloadServerFile/fileUrl/thumbUrl | ✅ library.test、abort.test；e2e server「/api/library/thumb：…」 | html/svg 强制下载 |
| `POST /api/library/upload`、`mkdir`/`rename`/`copy`/`move`/`delete` | srv/routes/library.ts | files-client；/transfer 页面 | ✅ library.test；e2e server「/api/library：upload / mkdir / rename / copy / move / delete」；extras 文件页 | 压缩包内只读 |
| `GET /transfer` | srv/routes/transfer.ts | （独立网页） | ✅ transfer.test；e2e server「/api/fonts 与 /transfer」；deploy「网页传书 /transfer：…」×4 | — |
| `GET /api/fonts`、`/api/fonts/file` | srv/routes/fonts.ts | reader/ui/services/fonts.ts | ✅ fonts.test；e2e server 同上；u:reader/ui fonts.test（.ttc 加载失败降级并提示，A6） | — |
