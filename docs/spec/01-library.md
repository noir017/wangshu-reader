# 01 书架 / 书库 / 数据层 / 云同步 / 网络书库 / 统计 / 备份 —— 功能规格

> 调研对象：静读天下专业版 7.3（`com.flyersoft.moonreaderp`，应用名「静读天下专业版 / Moon+ Reader Pro」）。
> 本文件只覆盖「书架 + 数据层 + 同步 + 网络书库 + 统计 + 备份」，阅读界面排版翻页、格式解析、标注绘制、朗读不在此文，遇到只做交叉引用。
> 调研方法：读 jadx 反编译源码与 apktool 资源（只读）。引用格式：`缩写:行号`，缩写表见下。网络可达性 / CORS 一节为 2026-10-21 在调研机上实测（易变，落地前请复测）。

**源码缩写**（均在 `jadx/sources/com/flyersoft/` 下；`res:` 指 `apktool/res/`，`assets:` 指 `apktool/assets/`）

| 缩写 | 文件 |
|---|---|
| `AM` | `moonreaderp/ActivityMain.java`（书架主界面，15439 行） |
| `AT` | `moonreaderp/ActivityTxt.java`（阅读器，仅引用同步/统计相关段） |
| `A` | `books/A.java`（全局设置与静态状态） |
| `BD` | `books/BookDb.java`（SQLite 封装） |
| `PM` | `moonreaderp/PrefMisc.java`（「其它选项」，含云同步开关、备份/恢复实现） |
| `PS` | `moonreaderp/PrefShelf.java`（「设置选项」对话框） |
| `PSF` | `moonreaderp/PrefShelfFilter.java`（书架过滤/排序/视图对话框） |
| `PEB` | `moonreaderp/PrefEditBook.java`（书籍信息编辑） |
| `PSI` | `moonreaderp/PrefSelectImportBooks.java` |
| `NBI` | `moonreaderp/NetBookInfo.java` |
| `BDS` | `moonreaderp/BookDownloadService.java` |
| `MZ` | `components/compress/MyZip_Java.java`（备份 zip + 标注同步用的 zlib 压缩） |
| `WD/DB/GD` | `components/cloud/WebDavSync / DropboxSync / GdriveSync` 及对应 `*Task` |
| `OPDS` | `opds/*`（`N`、`OpdsEntries`、`OpdsEntry`、`OpdsSite`） |

---

## 1. 概览

原 App 的首页是单 Activity（`AM`）：左侧抽屉 + 顶部工具栏 + **五个循环滑动的标签页**（`MainPagerAdapter` 用 `i % 5`，`AM:2701`，可左右无限循环滑动）。当前页存于 `A.lastTab`（prefs 键 `lastDash`）：

| 序号 | 页面 | 抽屉文案 | 实际内容 |
|---|---|---|---|
| 0 | 首页 Dash | 最近阅读 | 6 行横向卡片（最近阅读/我的珍藏/我的文件/网上书库/书签/阅读统计）或「最近阅读」完整列表 |
| 1 | 书架 | 我的书架 | 书籍列表（列表/网格/封面流），可按 全部/珍藏/系列/作者/标签/存储目录 分组 |
| 2 | 文件 | 我的文件 | 设备文件浏览器，可集成 Dropbox/Google Drive/WebDAV 云盘浏览 |
| 3 | 网上书库 | 网上书库 | OPDS 书库浏览/搜索/下载 |
| 4 | 标注汇总 | **书签**（`AM:15270` 把抽屉第 5 项文字设为 `button_bookmarks`，而不是布局里的「阅读统计」） | 全库 书签/标注/高亮 汇总页 |

**数据层**：SQLite `mrbooks.db`（版本 7，5 张表：`books`、`notes`、`statistics`、`tmpbooks`、`covers2`）+ SharedPreferences（`options1002` 保存全部设置，`positions10` 保存**阅读进度**，`state_filter` 保存手动阅读状态…）+ 若干纯文本文件（`history.txt` 最近阅读等）+ 封面缓存文件（`{主目录}/.MoonReader/{文件名}_{1|2|3}.png`）。**阅读进度不在数据库里**。详见第 4 节。

**云同步**：Dropbox（API v2，OAuth2）/ Google Drive（Drive v3，Google 登录）/ WebDAV（Basic 认证），三选一（`A.syncType`：0 关、2 Dropbox、4 GDrive、6 WebDAV）。同步三类数据：**每本书的阅读进度 `.po`**、**每本书的标注 `.an`（zlib 压缩文本）**、**最近阅读单条记录 `recent.list`**，另可上传书籍文件本身与整库备份。**没有时间戳，最后上传者胜出**（见 SYNC-007）。

**网络书库**：自写 SAX 解析 OPDS/Atom（`OPDS/OpdsEntries`），内置站点只有 Project Gutenberg / Feedbooks / MobileRead wiki（实际可用性见 NET-001），用户可手工加 OPDS URL 或 Calibre IP，HTML 站点在内嵌 WebView 中打开并拦截下载。

**统计**：全局累计（页数/字数/时长/天数，存 prefs）+ 单书累计（`statistics` 表，含逐日明细）；展示在首页最后一行 8 张卡片与书籍信息/最近阅读条目中。

**备份**：整个应用数据目录 zip（`.mrpro`/`.mrstd`），可选带封面、带书籍文件，可存本地或上传 Dropbox/GDrive/WebDAV（`PM:331-640`、`MZ.ZipFolder`）。

**本包特殊情况**：`MrAd`（广告）与 `IAP`（内购）已被改成空实现（`components/MrAd.java`、`components/IAP.java`），无书架广告；`assets/` 中没有 `book/` 目录，所以「首次安装预置《爱丽丝》样书」逻辑（`A.createInitHistory`，`A:2532`）会因 IOException 被吞掉而不生效；`components/MrAd.java` 里内嵌了 Dropbox 应用 key（`dropbox_key`）和一对 `APP_KEY/APP_SECRET`（本文不抄录；Web 版需自己注册 Dropbox 应用，不要复用）。

**最意外的发现**（详见正文）：
1. 阅读进度/阅读状态（未读/在读/已读）都不在 DB，而是 `positions10` 里的字符串 `章@分段#位置:百分比%`，书架的三态过滤完全由其百分比派生（LIB-009、LIB-041）。
2. 抽屉第 5 项叫「书签」，不是「阅读统计」；真正的阅读统计是首页第 6 行 8 张卡片（LIB-001、STAT-003）。
3. 手动拖拽排序是把书名改写成 `前缀#@#书名` 来骗过 `ORDER BY book` 实现的（LIB-018）。
4. 标注同步的删除墓碑只存在内存里（`A.deletedNotes`，打开书时清空），所以跨设备删除标注可能「复活」（SYNC-003/007）。
5. `components/GoogleBook.java` 不是 Google Books 接口，而是 3D 翻页曲面网格（`NewCurl3D` 使用），属阅读器翻页（另一人负责）。
6. 备份不是逻辑导出，而是把整个 `/data/data/<包名>` 目录（含 prefs XML 与 DB）打 zip，文件名被改成 `N.tag`（见 BAK-001）。
7. 书库账号密码、启动密码用「反转+位移」的可逆混淆保存（`T.mySimpleEncript`，`books/T.java:2649`），Web 版不应照搬。

---

## 2. 功能清单

> 条目标题格式：`ID 名称 · 优先级 · 可行性`。可行性：`[浏览器]` 纯前端可做；`[服务端]` 需 HTTP 服务端代办；`[不做: 原因]`。
> 「Web 建议」中的 IndexedDB 存储名对应第 4.8 节建议模型。

### 2.1 书架 / 首页 / 框架（LIB）

### LIB-001 五标签主框架与导航 · P0 · [浏览器]
- **界面**：标签 = 首页「静读天下专业版」(Dash) / 我的书架 (My Shelf) / 本地文件 (Local Files) / 网上书库 (Net Library) / 书签 (Bookmarks)。顶栏下方的 `filterLay` 显示当前书架分类名或文件夹面包屑；`subTitle` 显示子标题（如作者名、路径、搜索关键词）。
- **行为**：
  - 标签间左右滑动（循环，5 页）；抽屉点击切换（`setTabType`，`AM:14472`）；切换时退出多选态、隐藏联网指示、刷新菜单（`updateTabTypeInfo`，`AM:15423`）。
  - 点击顶栏或分类条 = 当前页「滚到顶/底」切换（`AM:13637-13700`）：书架封面流则在首/末本间切；首页在第 1 行与最后之间滚动。
  - 返回键层级（`AM:13832-13955`）：抽屉 > 多选态 > 文件页上一级目录/云目录 > 网上书库后退 > 书架「书→分组→全部」> 标注汇总「单书→总表→清过滤」> 再退出 App。
  - 启动：恢复 `A.lastTab`；`openLastFile`（默认 关，「自动打开上次阅读文件」）开则直接进阅读器；首次安装自动打开抽屉；有「导入中断」记录（`failedScanBook`）则提示继续导入（`AM:6590-6664`）。
  - 首次进入书架（`firstTimeShowShelf` 默认 true）会自动弹「导入书籍」对话框（`AM:11329`）。
- **出处**：`AM:2701`、`AM:6590`、`AM:13637`、`AM:13832`、`AM:15423`；设置 `lastDash`、`openLastFile`。
- **Web 建议**：用 hash 路由 `#/recent #/shelf #/files #/net #/notes`，浏览器后退键映射上述返回层级（History API）；是否做循环滑动手势为可选（移动端 swipe）；`lastTab`、`lastDashItem` 存 `settings`。

### LIB-002 左侧抽屉菜单 · P0 · [浏览器]
- **文案**：最近阅读 / 我的书架（右侧小箭头可展开「收藏夹」子列表，`favoriteOnDrawer`） / 我的文件 / 网上书库 / 书签 / （去广告：本包无意义，不做）／ 继续阅读 / 设置选项 / 软件说明 / 晚上模式（夜间时显示「白天模式」）/ 退出（`AM:15270` `updateDrawerButtonText`，`res:layout/drawer_left.xml`）。
- **行为**：「继续阅读」= `openFile(A.lastFile)`；**长按「继续阅读」弹出最近 100 本的快速切换列表**（`favLongTap`，`AM:479`）；「晚上模式」切换主界面夜间主题（`A.mainNightTheme`，只影响书架界面，不是阅读主题）；「设置选项」打开 PS；「软件说明」打开 PrefAbout（LIB-039）；「退出」`exitProgram`。展开箭头切换 `favoriteOnDrawer`；点击收藏夹子项 = 进入书架并选中该收藏夹（`AM:8292`）。
- **Web 建议**：左侧可折叠侧栏；「退出」不做（`[不做: 浏览器无退出进程概念]`）；长按「继续阅读」改为悬浮/右键菜单显示最近 N 本。

### LIB-003 首页 Dash（6 行横向卡片）· P1 · [浏览器]
- **行为**（`DashRvAdapter` `AM:1537-1670`、`RecentRvAdapter` `AM:3425`，共 6 项，`getDashItemCount` 返回 6，`AM:7095`）：
  1. **最近阅读**：`A.getHistory()` 顺序的封面横滚；行首「更多」→ 展开完整最近阅读列表（LIB-004）。封面高度 `recentCoverHeight(60)`。
  2. **我的珍藏 (My Favorites)**：显示收藏夹 `A.recent_fav_name`（默认 `default_fav`）中的书；行首图标 → 单选框选择要显示哪个收藏夹（标题「我的珍藏」，`AM:AnonymousClass100`）；「更多」→ 进入书架并定位该收藏夹。该行无书时只隐藏卡片条（行标题仍显示）。
  3. **我的文件**：文件夹快速访问列表（`A.getFavFolders()`，前面可插入 `[Dropbox] [Gdrive] [WebDav]` 入口，由 `show*InLocalFiles` 控制，`generateFavFolderList` `AM:6905`）；行首图标 → 收藏夹管理对话框（LIB-029）；点击 = 进入文件页该目录。空则只隐藏卡片条。
  4. **网上书库**：已配置的 OPDS 站点图标（`N.getLibraries()`），点击 = 进入网上书库并直接打开该站点。
  5. **书签 (Bookmarks)**：有标注的书的封面（`getAnnotBooksList(0,null)`），点击 = 进入标注汇总并打开该书的标注列表。无书时只隐藏卡片条。
  6. **阅读统计**：8 张数字卡片（STAT-003）；行首图标 → 菜单「清空全部阅读统计」。
  - （原有第 7 行为捐赠面板 `main_dash_encourage`，`[不做: 捐赠/内购]`。）
  - 当滚动超过第 1 行时显示 FAB（LIB-005）；滚动位置存 `lastDashItem`。
- **相关设置**：`simpleRecentList`（「使用最近阅读作为开始页」，开则首页直接是完整最近阅读列表而不是 6 行卡片）、`recentCoverSize2`、`recent_fav_name`。
- **Web 建议**：做成 `Dash` 页：每行 = 标题 + 「更多」+ 横向滚动卡片；空行隐藏。数据全部来自本地库，无外部依赖。

### LIB-004 最近阅读（完整列表）· P0 · [浏览器]
- **数据**：`history.txt`（见 LIB-042）顺序，最新在前，**无上限**（`A.addHistory` 只去重并插到首位，`A:1796`）。仅 `isSupportedFile` 类型进入历史。
- **条目显示**（`RecentListAdapter.fillItemData` `AM:3007-3420`）：封面、书名（`getBookName2`：无书名时用文件名；PDF 且书名≠文件名时追加灰色小字「(文件名.pdf)」，`AM:7039`）、作者、阅读进度 `N%` + 进度条（来自 `positions10`，无记录则 0%）、三行描述：「X 小时, N 字/分」+ 阅读日期范围 + 「#简介」。
- **交互**：点击 = 打开书；长按 = 进入多选（工具栏：书籍信息(仅 1 本)、导入/加入珍藏、删除=从最近阅读移除，可勾选「删除文件」）；条目溢出菜单（`AM:onRecentItemOverflowClick`）：书籍信息 / 加入我的珍藏 / 发送文件 / 〔Pro〕创建桌面快捷方式 / 下载书籍封面 / 从最近阅读里移除本书。
- **云端条目**：若同步开启且云端 `recent.list` 指向另一设备最近读的书，会在列表首位插入一条带云盘图标的「远程书」，点击后先从云盘下载该书再打开（`AM:1682` `DownloadCloudRecentAsync`、`openRemoteRecentCloudItem` `AM:14199`，见 SYNC-004）。
- **搜索**：顶栏搜索框（仅在该列表可见时）按 书名/作者/简介/文件名 过滤；联想仅在历史 <200 条时计算（`AM:14719`）。
- **布局**：列数同 `getListColumn`（`AM:7141`）：手机/平板竖屏 1 列、横屏 2 列、大平板 2/3 列；封面宽度随 `recentCoverSize2`（默认 90）。
- **相关设置**：`simpleRecentList`；Web 版没有「清空最近阅读」独立入口，仅「清空全部阅读统计」对话框里有「同时清空最近阅读列表」复选框（`AM:5317`，会清空 `history.txt` 与整个 `positions10`，即**同时清掉所有阅读进度**）。
- **Web 建议**：`history` store 保存 `{bookId, lastOpenedAt}` 有序列表；封面用 `covers`；进度从 `positions` 取。

### LIB-005 「继续阅读」浮动按钮 FAB · P1 · [浏览器]
- 全局圆形按钮（`fav_read`），点击 `doContinueReading` = 打开 `A.lastFile`，若有云端远程最近项则先清除远程项并刷新列表（`AM:5985`）。
- 状态 `fabButtonType2`：-1 未设（首次点击弹提示「全局浮动按键将打开最后阅读的书籍, 你可以在设置窗口里隐藏它.」并置 0）、0 显示、1 隐藏。「设置选项→应用→显示继续阅读浮动按键」勾选控制（`PS:saveSettings`）。首页滚离第一行、以及书架/文件/网上书库页显示；标注汇总页隐藏（`forceFavVisible`）。
- **Web 建议**：右下角 FAB；可选。

### LIB-006 书架分类与下钻 · P0 · [浏览器]
- **文案**：书架顶栏下的分类名可点击，弹出菜单（`showShelfCategory` `AM:11416`）：全部书籍 / 我的珍藏 / 书籍系列 / 书籍作者 / 书籍标签 / 存储目录；若已有命名收藏夹，再追加一条分隔线 `-` 与每个收藏夹名。
- **行为**（`updateShelf` `AM:15358`、`filter_shelf_collection` `AM:6784`、`setShelfTypeText` `AM:10962`）：状态 = `shelf_category2`(0..5) + `shelf_sub_collection`（编码见 4.2）+ `shelf_sub_author`。
  | category | 名称 | 一级列表（collections） | 点进去 |
  |---|---|---|---|
  | 0 | 全部书籍 | 无，直接出全部书 | — |
  | 1 | 我的珍藏 | `SELECT DISTINCT favorite`（`default_fav` 显示为「(默认分类)」排最前）；**若只有默认分类则不显示分组，直接平铺** | 该收藏夹的书 |
  | 2 | 书籍系列 | 所有系列名（`category` 里 `<系列名>` 的 token）；若是从「作者」点进来则是该作者的系列 + 「全部书籍 (n)」 | 该系列的书，**先按系列序号再按当前排序** |
  | 3 | 书籍作者 | `SELECT DISTINCT author`；作者名下若有系列则自动转到「系列」视图（`shelf_sub_author`） | 该作者的书 |
  | 4 | 书籍标签 | 所有普通标签（忽略以 `#` 开头、长度 0 或 >100 的 token） | 含该标签的书 |
  | 5 | 存储目录 | 书所在目录（`filename` 的父路径去重） | 该目录的书（标题显示目录名，副标题显示上级路径） |
  - 分组列表行：图标 + 名称 + 灰色「(n)」计数；系列行用 calibre 样式图标；**收藏夹行右侧有「改名」(Rename) 按钮**（对该收藏夹所有书批量改 `favorite`，`ShelfBookCollectionAdapter` `AM:3869`）。分组列表排序：系列(`<…>`)在前，其余按不区分大小写字母序。
  - 返回键：书列表→分组列表→全部（`doShelfBack` `AM:6378`）。
- **出处**：`BD.getDistinctValues` `BD:953`（`i=0` 取整值、`i=1` 只取普通标签、`i=2` 只取系列）、`BD.getFolderValues` `BD:1040`、`BD.getCategoriesFromBooks` `BD:904`。
- **Web 建议**：同样用 `books` 内存聚合；系列/标签建议拆成独立字段（见 4.8），不再用文本拼接。

### LIB-007 书架视图：列表 / 网格 / 封面流 · P0(列表、网格) P2(封面流) · [浏览器]
- **选择**：书架「过滤」对话框顶部三图标 列表 / 网格 / 封面流（`shelfStyle`：0/1/2，默认 **1 网格**，`PSF:onClick`）。「列表」也可通过菜单「使用格子布局」（`shelf_grid_layout`）在文件/网上书库页切换（各自 `fileUseGrid`、`libraryUseGrid`，默认 false）。
- **网格**（`ShelfBookListAdapter` `AM:3956`）：封面宽高比固定 **70:100**（`measureCoverRatio` `AM:7975`）；列数 = `round(容器宽 / (封面尺寸 × 1.10[手机]|1.36[平板]|1.38[大平板]))`，最少 2；封面下方小字书名（字号 `shelfFontSize-4`）；右上 ⋮ 溢出按钮；置顶书左上角显示图钉；底部/封面内进度（见 LIB-020）；选中态覆盖半透明蒙层。
- **列表**：左封面（高 = `shelfCoverSize × 1.55[手机]|1.95[平板]`，宽 = 高×0.70）；右侧：书名（粗体可选）、作者（`author` 内换行显示为 " & "；按作者排序时作者带下划线）、系列文字「系列名 [序号]」、收藏夹「★分类名」、简介（≤4 行，平板）、阅读进度 `N%` + 进度条；当读状态过滤不是「全部」时，简介前面插入阅读日期范围。列数：手机竖屏 1/横屏 2；平板竖屏 1/横屏 2；大平板 2/3。
- **封面流**（`show_coverflow` `AM:14860`，`components/CoverFlow.java`）：横向 3D 画廊，最大旋转 60°、最大缩放 -120、间距 -10；下方显示「第 i/N 本」与「书名 - 作者」；点击中间项打开，点击非中间项仅选中；长按进多选；点击详情文字弹书籍菜单；位置存 `shelf_last_item`。
- **出处**：`AM:3956-4458`、`components/CoverFlow.java`、`components/ShelfImageView.java`（夜间/木纹主题给封面画阴影与书脊）。
- **Web 建议**：网格与列表用 CSS grid；封面流用 CSS 3D transform（`rotateY(±60deg) translateZ(...)`）+ scroll-snap，P2。

### LIB-008 书架排序 · P0 · [浏览器]
- **文案**：排序 (Sort By)：书名 / 作者 / 导入时间 / 存储目录 / 最近阅读（`shelf_sort_by` 数组前四项 + `recent_list`）。入口：书架过滤对话框 `radioGroup2`（`PSF`）。
- **行为**（`BD.getSortField` `BD:1301`）：0 `book COLLATE NOCASE`；1 `author COLLATE NOCASE`；2 `addTime desc`（**addTime 是文本，按字符串比较，靠毫秒数位数相同才对**）；3 `filename COLLATE NOCASE`；4 取默认(书名)序后在内存按 `history.txt` 下标重排，不在历史里的排最后并保持相对序（`sortBooksByRecentList` `AM:11567`）。SQLite NOCASE 只折叠 ASCII 大小写，中文按码点序，**不做拼音排序**。
- **置顶**（LIB-017）在排序之后再做一次稳定排序提前。系列视图固定先按系列序号。
- **默认**：`shelf_sort_by2 = 0`。
- **Web 建议**：用 `Intl.Collator('und',{sensitivity:'base',numeric:true})`；可额外提供拼音序（P2）；addTime 存数字。

### LIB-009 阅读状态过滤与文件类型过滤 · P0 · [浏览器]
- **文案**：阅读过滤 (Read Filter)：未读 / 正在阅读 / 已读（三个复选，默认全选）；文件类型 (File Type)：全部 / EPUB / PDF/DJVU / MOBI/AZW3/PRC / FB2 / CHM/UMD / DOCX/ODT/RTF / TXT / HTML/MD / CBZ/CBR（选「全部」则隐藏其余；默认 `filterAll=true`、`filterEpub=true`，其余 false）。位于 PSF 对话框，工具栏漏斗图标（`mmB1`，`AM:10491`）打开。
- **阅读状态判定**（`getListShelfBooks` `AM:7160`、`getManualReadFilter` `AM:7208`、`getReadProgress` `AM:7289`）：
  1. 若 `state_filter` prefs 里有该书（键 = 完整路径）的手动值：1→未读、2→在读(50)、3→已读(100)。
  2. 否则看 `positions10[路径小写]`：无记录→**未读**(-1)；有记录取冒号后百分比整数部分，`<100`→**在读**，`=100`→**已读**。（所以「打开过但在 0%」也算在读；「读完」要求阅读器记录到 `100%`，TXT 用 `isEndOfBook` 才写 100%。）
- **类型映射**：EPUB=`.epub/.epub3`；PDF/DJVU=`.pdf/.djvu`；MOBI=`.mobi/.azw/.azw3/.prc`；FB2=`.fb2/.fb2.zip`；CHM/UMD=`.chm/.umd`；DOCX/ODT/RTF=`.docx/.odt/.rtf`；HTML/MD=`.md/.htm/.html`；TXT=`.txt`；CBZ/CBR=`.cbz/.cbr`（原代码优先级 bug：勾了任意类型后 `.cbr` 总是通过）。若三个状态全选且类型为「全部」则不过滤。
- **关闭对话框时**若三个状态全没勾，自动恢复全选（`PSF.dismiss`）。
- **Web 建议**：进度表独立 `positions` store；过滤对象在内存计算；类型用扩展名/`format` 字段。

### LIB-010 书架搜索与联想 · P0 · [浏览器]
- **行为**：顶栏放大镜（各标签独立）；提交后 `doSearch`（`AM:12513`）；书架页用 `showShelfBookList(key)` 在**当前书列表内**过滤（`bookHasKey` `AM:5236`）：书名 / 作者 / 文件名(不含扩展名) 子串匹配（不区分大小写）；**关键字长度 >1 时再匹配简介**。分组列表可见时只联想分组名、不执行搜索。
- **联想**（`showSearchSuggestions` `AM:14719`）：① 该标签的历史搜索词（子串过滤）；② 书架：匹配的书（显示书名 + 作者或简介片段）、匹配的作者（`@@作者`，点击后转到「系列」视图）；③ 空输入时显示历史词 + 「清空」。历史词按标签分别存文件：`dash_search / shelf_search / files_search / net_search / annot_search`（`getKeyXmlFile` `AM:7122`），**仅在提交时记录**（`saveSearckKey`）。
- **Web 建议**：顶栏单一搜索框，按当前路由切换作用域；历史词存 `settings.searchKeys[scope]`（≤50 条即可）。

### LIB-011 多选模式与批量操作 · P0 · [浏览器]
- **进入**：长按书（所有标签页通用，`show_select_state(true)`）；标题栏变为「已选数量」；再次点按切换勾选；返回键退出。
- **工具栏**（`setActionItemsVisible` `AM:10491-10670`，`doSelectStateItem` `AM:12582`）：
  - 书架·选 1 本：`B1`=编辑书籍信息（详情图标）、`B2`=加入我的珍藏（心形）；
  - 书架·选多本：`B1`=加入我的珍藏、`B2`=标签 (Tags)（批量加标签）；
  - 删除（垃圾桶）= 从书架移除（收藏夹视图下为「从我的珍藏里移除」），带复选框「删除文件」；
  - 溢出菜单：阅读过滤 → 自动 / 未读 / 正在阅读 / 已读（批量设手动阅读状态，LIB-016）；全选；
  - 恰选 1 本且排序为「书名」时，继续长按拖动可手动排序（LIB-018）。
- **最近阅读页**多选：`B1`=书籍信息(仅 1 本)、`B2`=导入(加入珍藏)、删除=从最近阅读移除。**文件页**多选：见 LIB-028。
- **Web 建议**：勾选框模式 + 顶部上下文工具栏（与 Gmail/相册一致）；shift/ctrl 多选。

### LIB-012 单书溢出菜单（⋮ / 封面流点详情）· P0 · [浏览器]
- **书架条目菜单**（`doShelfItemOverflowClick` `AM:6399`）：书籍信息 / 加入我的珍藏 / 发送文件 / 〔Pro〕创建桌面快捷方式 / 下载书籍封面 / ───── / 置顶 (Put on top)（已置顶则「取消置顶」）/ 从我的书架里移除（收藏夹视图下为「从我的珍藏里移除」）。
- **最近阅读条目菜单**：书籍信息 / 加入我的珍藏 / 发送文件 / 〔Pro〕桌面快捷方式 / 下载书籍封面 / 从最近阅读里移除本书（若条目来自「我的珍藏」行则为「从我的珍藏里移除」）。
- **Web 建议**：「发送文件」→ Web Share API 或直接下载原文件；「桌面快捷方式」`[不做: Android 启动器快捷方式；PWA 安装由浏览器负责]`。

### LIB-013 书籍信息 / 编辑对话框 · P0 · [浏览器]
- **文案**（`res:layout/shelf_book_info.xml`、`PEB`）：标题「书籍信息」（从非编辑入口进入时标题为「加入我的珍藏 (我的书架)」）；字段：封面预览（有自定义封面时带「恢复」(Restore) 按钮）、**书名** (Book Title)、**作者** (Book Author)、**封面文字(可选)** (Cover Text (Optional))、按钮「选择封面...」、「下载...」/「下载书籍封面」、**简介** (Description)、**加入珍藏** (Favorite) 复选 + 「分类名(可选)」输入 + 选择按钮、**书籍系列** (Series) 名称 + 序号两个输入框、**标签** (Tags) 多行输入 + 选择按钮、**阅读过滤** (Read Filter) 下拉（自动/未读/正在阅读/已读）、文件路径行（附日期与大小；点击 →「打开文件夹 "<路径>"?」跳到文件页）。有统计时追加：阅读速度 (字/分钟)、阅读小时数、阅读日期历史。
- **保存**（`PEB.onClick` 首个分支）：更新 `books` 行（作者、简介、tags/系列合成 `category`、`favorite`）；书名保留原手动排序前缀（`getSortTag`）；封面文字 / 选定封面写入 `{文件名}_3.png`（编辑封面）或 `covers2`；读状态写 `state_filter`。
- **规则**：未勾「加入珍藏」则 `favorite=''`，勾选但名称为空则 `default_fav`；系列仅在系列名非空时写入 `<系列>\n#序号#\n`（序号 <0 取 0）；标签里连续空行合并，末尾补换行。
- **Web 建议**：做成对话框/抽屉；标签/系列拆字段存；「封面文字」可用 canvas 生成文字封面。

### LIB-014 我的珍藏（收藏夹）· P0 · [浏览器]
- 每本书只有**一个** `favorite` 字符串（''=不在任何收藏夹；`default_fav`=默认分类；其他=用户命名）。同一本书不能同属多个收藏夹。
- 添加（`updateBookFavorites` `AM:11660`）：对话框「加入珍藏」复选 + 分类名输入（预填所选书里已有的那个非默认名）+ 选择按钮（单选已有名，排除默认；若没有已有名则提示「提示: 没有预存分类名, 可留空或输入新的分类名称.」）。批量对所选书写入同一值。
- 改名：分组列表行「改名」→ 复用同一对话框，对该收藏夹所有书改名。移除：见 LIB-011（`favorite=''`，书仍在书架）。
- 文件页/最近阅读里「加入我的珍藏」= 若书不在书架则**先导入再加收藏**（`importSingleBook(path, true)`，`AM:13425`），`fileImportWithFav`（默认 true）决定导入时复选框默认值。
- 抽屉与首页第 2 行都会显示收藏夹。
- **Web 建议**：`books.favorite` 字符串即可（保持与原库互通）；或升级为多收藏夹数组（需在导出时降级）。

### LIB-015 标签与系列 · P1 · [浏览器]
- `books.category` 是多行文本（4.2），一本书的标签 = 各行（`#` 开头与超 100 字的忽略）；系列 = 形如 `<系列名>` 的行，紧跟 `#序号#` 行。TXT 书导入时自带标签 `(TXT)`，PDF 带 `PDF` + 关键字，DJVU 带 `DJVU`，EPUB 取 `dc:subject`（`BD.createBookInfoFromFile` `BD:311`）。
- 批量加标签（`updateBookTags` `AM:11770`）：对话框「标签」多行输入 + 选择按钮（多选已有标签）；**只增不删**（新增的行插到现有前面）。单书编辑（LIB-013）则整体替换。
- `createSerialText`（`BD:487`）把 `<系列>` + 序号格式化成「系列名 [序号]」（`.0` 去掉）供列表显示。
- **Web 建议**：`tags: string[]`、`series: {name, index}`；导入原库时按上述规则解析。

### LIB-016 手动阅读状态 · P1 · [浏览器]
- 单书编辑里的「阅读过滤」下拉与批量菜单：自动(删除手动值) / 未读(1) / 正在阅读(2) / 已读(3)，存 prefs `state_filter`（键=完整路径，值=1|2|3，`AM:11714`、`AM:12595-12612`）。手动值优先于由进度派生的状态（LIB-009）。若当前过滤不是全选，设置后刷新书架。
- **Web 建议**：`readStates` store，键 bookId。

### LIB-017 置顶 · P1 · [浏览器]
- 文案：置顶 / 取消置顶（`put_on_top`/`remove_from_top`）。顺序存文件 `shelf_top_books`（一行一个路径，最新置顶在最前，`A.addToShelfTop` `A:1907`）。列表在排序后再按 topId 稳定提前（`sortBooksByTop` `AM:11595`）。网上书库的站点也有同样的置顶（`lib_top_items`，`A.addToLibraryTop`）。
- 与手动拖拽的关系：若已有置顶，把一本书拖到最前 = 置顶（LIB-018）。
- **Web 建议**：`books.pinnedAt` 数值字段；站点同理。

### LIB-018 手动拖拽排序 · P2 · [浏览器]
- 条件：`shelf_sort_by == 0`（书名排序）且只选中 1 本，长按拖动（`initDragView` `AM:7547` 仅 sort==0 生效；`dragTouchEvent` `AM:12955`；`updateBookOrder` `AM:15154`）。其它排序下松手会提示「自定义书籍位置只支持按书名排序, 不支持当前选择的排序方式」。
- **实现机制（不要照搬）**：把拖动书的 `book`(标题) 字段改写为 `「前一本的排序键」+"#@#"+原标题`（`MANUAL_SORT_TAG="#@#"`，`BD:34`），利用 `ORDER BY book` 的字典序把它挤到目标位置；读出时 `removeSortTag` 取最后一个 `#@#` 之后的真标题，`getSortTag` 取前缀；若后一本也带 `#@#` 前缀则连带改写。拖到最前且已有置顶书时 = 加入置顶。
- **Web 建议**：使用独立 `books.manualOrder`（浮点/分数索引）字段，原库导入时把 `#@#` 前缀还原为序号并清理标题。

### LIB-019 封面体系 · P0(显示与占位) P1(重建/默认封面) P2(在线搜图) · [浏览器]
- **封面文件**（均在 `{主目录}/.MoonReader/`，`A.initPathParameters` `A:8506`）：`{书文件名}_1.png`=书架缩略图(THUMB)、`_2.png`=原尺寸封面(COVER)、`_3.png`=用户编辑封面(EDITCOVER)、`{书文件名}.png`=网上书库下载时保存的封面(NETCOVER)。**书架封面查找优先级**（`A.getShelfCoverFile` `A:6162`）：`_3` > `_1` > `_2` > `.png`（文件需 ≥10 字节）> `covers2` 表里为该书记录的内置封面名 > 默认封面。
- **内置默认封面**：6 张 `cover100..cover105.jpg`，默认 `cover104`（prefs `coverImage`）；可在「设置缺省封面」里选内置或外部目录图片（`PrefImageBrowser1`，目录记 `outerImagesFolder`）。每本书可在书籍信息里单独指定内置封面（写 `covers2(filename小写, 封面名)`）。无真实封面（或使用默认封面）时，封面下方叠加显示书名文字（`drawBookView` `AM:6759`：`myBookName2` 可见性取决于封面是否为真实文件且≠默认）。
- **生成**：导入时由各格式解析器顺带生成（EPUB/MOBI/FB2/DOCX…构造函数传 `true`）；PDF/DJVU 渲染第 0 页；CBZ/CBR 取第一张图。缩略图宽 = `shelfCoverSize × density × {0.667|0.75|1.0}`（`A.generateBookCovers` `A:3777`）。
- **重新创建书籍封面**（书架菜单项，`rebuildCover` `AM:8179`）：对话框「重新创建书籍封面」，输入大小 (Size)，限 40..600，默认当前 `shelfCoverSize`；遍历当前书架列表重生成（可取消）。
- **下载书籍封面**（`PrefDownloadCover`）：内嵌 WebView 打开图片搜索（`cover_search_engine`：-1 自动[中国大陆=搜狗，否则=Google]、0 Google、1 Bing、2 Yahoo、3 搜狗），关键字 = 「书名 作者」去掉 `_`/`-`/`(TXT)`/`(HTML)` 等；长度<8 时附加「 封面」/「 book cover」；**长按图片**即选中并保存为 `_3.png`（提示「提示: 长按一个图片可下载该图片」）。
- **封面质量** `cover_quality`（0 正常/1 低，Android<5 默认 1）。
- **Web 建议**：封面在导入时由解析器产出 Blob 存 `covers`（kind: thumb/cover/edit/net）；优先级同上；「下载封面」改为 `[浏览器]` 上传图片/粘贴 URL，或 Open Library `search.json`（CORS `*` 已实测可用，`covers.openlibrary.org` 图片可 `<img>` 使用）；P2。**不做** WebView 搜图（`[不做: 需爬搜索引擎页面]`）。

### LIB-020 书架外观：夜间 / 木纹 / 封面进度 / 字体 · P1 · [浏览器]
- 夜间主题 `mainNightTheme`（抽屉「晚上模式/白天模式」切换；`sysDarkModeFollow`「跟随系统深色模式」，仅 Android 10+ 可用，默认 false；`sysDarkNever` 默认 true）。夜间时封面画深色阴影与书脊（`ShelfImageView`）。
- **木纹书架背景** `woody`（默认 **true**，「书架使用木纹背景」）：日/夜各一套资源编号 `woodyResDay/woodyResNight`（0..5，**5=用户自选图片**，存 `custSelfDay/custSelfNight` 路径）。启用木纹时网格书架强制为网格样式（`PS` dismiss 回调里 `shelfStyle=1`，`AM:14632-14700`），列表样式则整个列表画木纹背景。
- **封面上显示阅读进度** `coverWithProgress`（默认 false，「在封面上显示阅读进度」）：网格封面（及首页卡片）右下角显示圆形进度仪表 `N%`（`ProgressGaugeTV`），需有进度记录。
- 尺寸与字体（「设置选项→书架→封面(大小)」`PS:coverB`，**仅 Pro 可改**）：最近阅读封面 `recentCoverSize2`(默认 90)、书架封面 `shelfCoverSize6`(默认 110，小屏手机 100)、文件封面 `fileCoverSize5`(48)、网上书库封面 `netCoverSize5`(48)，均最小 30；文字大小 `shelfFontSize5`(手机 16/平板 17，最小 10)；字体加粗 `shelfBoldFont`。
- **Web 建议**：CSS 变量 + 主题；木纹背景可用资源图或 CSS 渐变（P2）；Pro 限制取消。

### LIB-021 导入书籍（添加到书架）· P0 · [浏览器]
- **原行为**（`doShelfImport` `AM:12720`）：对话框「导入书籍」(Import Books)：**路径** (Path，点击弹文件夹选择)；**文件类型**复选 EPUB / PDF/DJVU / FB2 / MOBI/AZW3/PRC / CHM/UMD / DOCX/ODT/RTF / HTML/MD / TXT / CBZ/CBR（默认全选）；**文件大小 >** `[20]` KB（`importFileSize`，用于跳过小文件/封面图）；展开「更多」：**加入珍藏**复选 + 分类名（`scanFav`）。确定 → 递归扫描该目录（`scanForNewBooksThread` `AM:14297`，可取消的进度框「正在扫描电子书」）→ LIB-022 选择 → 导入（`scanForNewBooksFinal` `AM:8603`）。
- **导入处理**：对每个文件：先 `scanAcceptableFileSize`（FB2/UMD/MOBI 大于 `maxMemory/2` 的跳过）；记录「正在处理的文件」到 `failedScanBook`（崩溃后下次启动提示继续并把崩溃文件标记为损坏 `import_failed_list`）；用对应解析器提取 书名/作者/简介/标签/封面；**去重**：若路径已在库中 → 重新解析并合并标签、按 `scanFav` 覆盖或沿用原收藏夹后再 `insertBook`（反编译对「未变化文件是否直接跳过」的判断丢失了，存疑）；若不在库中 → 用 `BD.hasSameBook(书名, 路径)` 判断「同书名且文件大小相同」的旧记录，有则不重复插入（同时顺带删除文件已不存在的同名行，`BD:1316`）；每 5 本提交一次事务；`insertBook(info)` 默认把 `addTime` 写成当前毫秒。
- **单文件导入**：文件页/最近阅读/外部打开时 `importSingleBook`（`AM:13425`）直接弹 PEB（LIB-013）。外部 `VIEW` 意图或 HTTP 链接：直接打开/下载（`AM:6590`，LIB-038）。
- **Web 建议（核心）**：入口 = 「导入」按钮（`<input type=file multiple accept=…>`）+ 拖放 + （Chromium）`showDirectoryPicker` 递归目录；类型复选与最小大小(默认 20 KB)保留；重复判定用「内容哈希」或「书名+大小」；导入时在 Worker 里提取元数据与封面；进度条可取消；完成后弹「新书列表」（LIB-023）。文件 Blob 存 `files`（OPFS 或 IndexedDB）。需请求 `navigator.storage.persist()`。

### LIB-022 导入前的选择列表 · P1 · [浏览器]
- 全屏对话框「导入书籍」（`PSI`，`res:layout/import_files_select`）：顶部排序切换 **按时间排序**(默认) / **位置** / **文件名**；分组头：时间视图分 今天/一周/月/全部；位置视图按所在目录分组；文件名视图按首字母（A–Z、`#`、或该汉字）；每行：复选框 + 文件名 + 灰色「(已导入)」或「(不支持此文件)」（损坏） + 日期 + 大小；已导入的默认不选，损坏的不可选；按钮：全选/全部取消、「导入 (n)」、设置图标（返回上一对话框修改条件）。
- **Web 建议**：对「文件夹导入」模式才需要；多文件直接导入可跳过此步。

### LIB-023 导入完成后的新书列表 · P2 · [浏览器]
- 导入结束若有新书，弹全屏列表（`PrefNewEBookList`），点哪本即打开阅读；关闭后刷新书架。没有新书则提示「导入: 0」。
- **Web 建议**：Toast + 「查看新书」链接即可。

### LIB-024 自动导入新书 · P2 · [浏览器]（仅 Chromium 已授权目录）
- 选项「自动把主目录的新书籍导入到书架」`auto_import`（默认 false）+「导入目录」列表（`auto_import_folders` 文件，默认=主目录；`PS` 目录增删行）。进入书架页时（距上次 ≥1 分钟）后台线程（最低优先级）扫描这些目录里**修改时间晚于 `auto_import_time`** 且符合导入类型/大小条件的新文件（已入库的 PDF 跳过；`err*.txt` 跳过），**无需确认直接导入**（`importNewBooks` → `addBatchBooksToShelf(列表, 不加收藏夹)`，显示可取消进度框，结束后弹新书列表 LIB-023；`autoImportNewBooksHandler` `AM:12232`），并更新 `auto_import_time`。
- **Web 建议**：仅对「已链接目录」(File System Access) 在页面获得焦点时做；其它浏览器 `[不做]`。

### LIB-025 失效书籍处理 · P1 · [浏览器]
- 点击一本文件已不存在的书（`verifyShelfBook` `AM:12032`）：对话框（标题「错误」）「"书名" 不存在 从我的书架移除?」+ 文件名 + 复选「从我的书架移除所有失效书籍」；按钮 是 / 否 / **位置**：选择新目录，把库里原目录下的书按**同名文件**重新链接到新目录（`BD.moveBooksToNewPath` `BD:1596`，会同时改 `books/notes/statistics` 的 filename 并 `A.renameHisotry` 改历史与进度键），结果提示「共有%d本书链接到新目录」，没有同名则「当前目录没有同名书籍文件」。
- 「设置选项→书架→清空书架」(`emptyDatabase` `BD:609`)：确认后删光 `books` 表，并删除缓存目录里所有 `.png/.jpg` 文件（因 `_1/_2/_3.png` 都以 `.png` 结尾，**用户自定义封面 `_3.png` 也会被一并删掉**）；不删 `notes/statistics/tmpbooks/进度/历史`。
- **Web 建议**：书文件存浏览器内（OPFS/IDB）时基本不会失效；若采用「链接外部文件句柄」模式，则失效 = 句柄权限丢失 → 提示「重新授权/重新选择文件」。

### LIB-026 从书架移除 / 删除文件 · P0 · [浏览器]
- 「从我的书架里移除」(`removeBooksFromShelf` `AM:8374`)：对话框带复选「删除文件」(Delete file)；确认后：收藏夹视图→只清 `favorite`；否则删封面缩略图 + 删 `books` 行（**不删** notes/statistics/进度）；勾选则同时删除原文件与封面缓存 `_1/_2/.png`（`deleteSingeBook` `AM:5864`）。最近阅读页「从最近阅读里移除」同理（`removeBooksFromHistory` `AM:8340`，先 `A.deleteHistory`）。
- **Web 建议**：区分「移出书架（保留进度/标注）」与「彻底删除（含文件）」，彻底删除时询问是否同时删标注/进度/统计。

### LIB-027 打开随机书籍 · P2 · [浏览器]
- 书架溢出菜单「打开一本随机书籍」(`open_random_book`) = 在当前过滤后的列表里随机挑一本打开（`doOpenRandomBook` `AM:6245`）。

### LIB-028 文件页（本地文件浏览器）· P2 · [不做: 浏览器无法浏览设备文件系统；改为 LIB-021 的文件选择/拖放；Chromium 可选「已链接目录」]
- 原功能（`AM:1877` `FilesAdapter`、`createFileList` `AM:5653`、`showFileList` `AM:14559`）：面包屑路径条；目录在前文件在后（支持格式的在前，其他在后），隐藏目录由 `showHiddenFiles` 控制；排序 6 种（按名称/大小/时间 升/降，`files_sort_by`）；列表/网格切换 `fileUseGrid`；EPUB 缩略图；菜单：新建目录、使用格子布局、排序、全选；多选：拷贝(|下载)、移动、改名、删除、书籍信息、导入(加入珍藏)；粘贴条（粘贴/新建目录/取消）；文件名关键字递归搜索（`do_local_search2` 进度框，结果列表标题「搜索结果: n」）；**ZIP/RAR 路径浏览**（路径里带 `?` 表示压缩包内路径，`isZipPath/showZipFileList`）；点击不受支持的文件时弹「该文件类型不受支持，是否以纯文本模式打开或用其它应用打开?」（`unknow_book_hint`，`AM:14130`）；图片文件进图库。
- **Web 建议**：不做通用文件浏览；若实现「已链接目录」，仅提供目录树 + 点击导入/打开，其余（拷贝/移动/改名/删除设备文件）不做。

### LIB-029 文件夹快速访问列表 · P2 · [不做: 依赖设备文件系统]
- `favfolders6` 文件（一行一个路径；默认含 SD 卡/`/sdcard`/主目录），文件页分类条的下拉与首页第 3 行使用；对话框「文件夹快速访问列表」(Favorites list) 有三个云盘开关 `[Dropbox] [Gdrive] [WebDav]`（`showDropboxInLocalFiles` 等，默认 true）+ 已存目录勾选（`showFavFolderSelector` `AM:11096`）。
- **Web 建议**：若做「已链接目录」，可复用为「已链接目录列表」；云盘入口见 SYNC-011。

### LIB-030 书签/标注汇总页（第 4 标签「书签」）· P0 · [浏览器]
- **总表页**（`initStatisticsAnnotLv` `AM:7747`、`showTotalAnnotsCount` `AM:11456`）：顶部三个可点击计数徽章：**书签 (n)** / **标注 (n)** / **高亮 (n)**（点击 = 只看该类，再点取消），旁边「颜色」按钮（按高亮色过滤，弹出该范围内出现过的颜色列表）；列表 = 有此类标注的书（`getAnnotBooksList` `AM:6919`，按 `time` 排序）；点书进入该书标注列表（`showOneBookAnnots` `AM:11364`）。
  - 定义：书签 = `notes.bookmark<>''`；标注(笔记) = `bookmark='' and note<>''`；高亮 = `bookmark='' and note=''`。
  - 关键字搜索：对书签名、笔记、原文 `LIKE %key%`（联想显示书名与匹配片段）。空时显示提示「尚无书签」。
- **单书页**：该书全部标注列表（`StatisticsOneBookAnnotsAdapter`），多选后可删除/分享（`PrefChapters.doShare`）；右上「导出」分享图标；返回键回总表并刷新。
- 导出/分享/导入标注的文本格式属于阅读器标注模块（另一调研员），此处仅引用；与云同步格式 `.an` 的关系见 4.4。
- **Web 建议**：路由 `#/notes` 与 `#/notes/:bookId`；表 `notes` 带索引 (bookId, time)；全文搜索用内存过滤。

### LIB-031 设置选项对话框（书架/文件/应用/备份）· P0 · [浏览器]
- 全屏对话框「选项」(`PS`，`res:layout/pref_shelf.xml`)，退出时一次性保存（`saveSettings`）。分区与项：
  - **我的书架 (My Shelf)**：书架使用木纹背景（带 日/夜 资源选择，`woody`）；在封面上显示阅读进度 `coverWithProgress`；自动把主目录的新书籍导入到书架 `auto_import`（+ 导入目录列表）；主目录 (Main Folder) `default_book_folder`；导入书籍 (Import Books)；清空书架 (Empty Shelf)；封面(大小) (Book Cover (Size))。
  - **我的文件 (My Files)**：显示隐藏文件和文件夹；显示电子书的封面缩略图（隐藏）；在本地文件里集成 Dropbox/Google Drive 云存储功能。
  - **应用 (App)**：显示书籍打开时的动画(Pro, Android 5+)；跟随系统深色模式(Android 10+)；使用最近阅读作为开始页；显示继续阅读浮动按键；设置阅读器保护密码 (Pro；Pro+指纹)；界面语言 (Language)；
  - **备份 / 恢复** 两个按钮（BAK-001/002）。
- 「其它选项」(`PM`，阅读器内) 里与本文相关的还有：**自动打开上次阅读文件** `openLastFile`、三个云同步复选框与各自设置按钮（SYNC-001）、Readwise。
- **Web 建议**：设置页分区同上；去掉 Android 专属项（主目录、隐藏文件、打开动画、指纹、桌面快捷方式）。

### LIB-032 书籍详情中的统计 · P1 · [浏览器]
- 书籍信息里文件行：路径 + 修改日期 + 大小；有 `usedTime>0 && readWords>0` 时追加：**阅读速度: N（字/分钟）**、**阅读小时数: x.xx**、**阅读日期:** 每行 `日期  时长 速度`（`BD.getReadDate2` `BD:1227`）。见 STAT-004。

### LIB-033 启动密码保护 · P2 · [浏览器]（弱保护；指纹 `[不做: 依赖 Android 生物识别]`）
- 「设置阅读器保护密码」(Pro)：对话框两次输入（「请输入密码」「再次输入」，`password_input1/2`），不一致提示「password_notpair」，成功提示 `password_ok`；密码存 `loginPassword`（可逆混淆）。启动时如开启则先弹「密码」输入框，错误提示「密码错误」后 `shutdown`（`doTextPasswordCheck` `AM:6466`）；若 `fingerPrint` 且已录入指纹则改用系统指纹（`doFingerPrintCheck` `AM:6044`）。
- **Web 建议**：可选「界面锁」：用 PBKDF2 存口令哈希；明确告知这只是界面遮挡，不是加密（数据仍在 IndexedDB）。P2。

### LIB-034 界面语言 · P1 · [浏览器]
- 设置里「界面语言」下拉（`languageID2`，0=跟随系统；`A.setLanguageList`、`R.array.languages`，约 40 种），选后提示 `app_language_change_tip`，退出重启生效。Web 用 i18n 资源 + 运行时切换；中文简/繁并存。

### LIB-035 外部打开 / 未知类型处理 · P1 · [浏览器]
- `openFile`（`AM:14130`）：先 `A.getOpenFilename`（处理 zip 缓存路径）；文件不存在 → 错误框「文件名 "x" 不存在」；`isSupportedFile`（`txt htm html epub epub3 mobi azw azw3 prc zip rar fb2 fb2.zip cbz cbr umd chm pdf djvu docx odt rtf md` 等，`A:8893`）→ 进阅读器；图片 → 图库；其他 → 弹「该文件类型不受支持，是否以纯文本模式打开？」(纯文本格式 / 其它应用)；已知系统 MIME → 交给系统应用。
- **Web 建议**：导入时按扩展名/魔数识别；不支持的类型提示「以纯文本打开」或「下载原文件」。

### LIB-036 外部链接 / 文件关联 · P2 · [浏览器]
- 原 App 通过 Android `VIEW` 意图打开本地文件或 `http` 链接（链接则走下载，`A.downloadFileFromBrowser`，`AM:6590`）、桌面小部件跳转（`fromWidget`）。
- **Web 建议**：PWA `file_handlers` 与 `share_target` 清单声明（Chromium）可选；`?open=<url>` 参数走 NET-008 的服务端下载代理。

### LIB-037 发送文件 / 创建桌面快捷方式 / 桌面小部件 · P2 / [不做]
- 发送文件 `A.sendFile` → Web：Web Share API（支持文件的浏览器）或直接下载。
- 创建桌面快捷方式 `AM.do_add_desktop`、`PrefShelf.createAppShortcut`：`[不做: Android 启动器 API；PWA 安装替代]`。
- **桌面小部件** `components/WidgetProvider|WidgetFactory|WidgetOptionActivity|WidgetService`（显示「最近阅读」或某个收藏夹的书列表，点击打开；配置存 prefs `widget`）：`[不做: Android AppWidget]`。
- 去广告/内购/捐赠 `MrAd`、`IAP`、`removeAdButton`、`main_dash_encourage`、`PrefAbout.DonateAdapter`：`[不做: 商业化与 Google Play 计费；本包已是空桩]`。
- 崩溃处理 `components/CrashHandler`、`CrashTipActivity`：`[不做: Android 进程崩溃捕获；Web 用 window.onerror 日志即可]`。

### LIB-038 关于对话框 · P2 · [浏览器]
- 全屏对话框，标题「静读天下专业版 <版本>」(`A.getVerionName`)，正文按语言读 `assets:readme/{cn|en|…}.htm`（功能列表、Pro 增强列表、翻译人员名单）；购买/评价按钮本包隐藏；`assets:!whatisnew` 是更新记录（v7.3: 木纹书架自定义图片、PDF 手写粗细、折叠屏双页字号、「我的珍藏」改名、txt 编码检测优化、TTS 点击中间暂停…）。
- **Web 建议**：做一个简洁「关于」页；功能列表可复用 `readme/CN.htm` 文案提炼。

### LIB-040 书籍记录建立与元数据提取规则 · P0 · [浏览器]
- `BD.createBookInfoFromFile(收藏夹, 路径, 是否入库)`（`BD:311`）：
  | 格式 | 书名 | 作者 | 简介 | 标签(`category`) |
  |---|---|---|---|---|
  | EPUB/MOBI/AZW/PRC/FB2/UMD/CHM/DOCX/ODT/RTF/MD | 解析器 `getBookName()` | `getAuthor()`（多作者以换行分隔） | `A.doTrimBlankSpace(A.trimHtml(description))` | `categories` 每个一行 |
  | PDF | `Title` 元数据（通过 `validatedPdfMetaTitle`）否则文件名(无扩展名) | `Author`，否则 `(PDF)` | `Subject`(≠标题) | `PDF\n` + `Keywords`(以 `, ` 拆成行) |
  | DJVU | 文件名 | `(DJVU)` | 空 | `DJVU\n` |
  | CBZ/CBR | `ComicInfo` 标题或文件名 | `ComicInfo` 作者，否则 `(CBZ)` | `ComicInfo` 描述 | `ComicInfo` 类别 |
  | TXT/HTML 等 | 文件名(无扩展名) | `(TXT)` / `(HTML)`… | 空 | `(TXT)\n` |
  - 简介超 2000 字截断为前 2000 + `...`（`BookInfo` 构造，`BD:108`）。
  - `downloadUrl` 字段：文件位于下载目录（`{主目录}/MoonReader` 或 `/sdcard/Books/MoonReader`）时写 `UNKNOW`（`A.isDownloadFile` `A:8602`），否则空；`rate/bak1/bak2` 全库无读写，保留字段。
  - 文件名里的 `?` 表示「压缩包内的文件」：路径形如 `a.zip?/内部文件.epub`（`checkBooksAvailable` 取 `?` 前判断存在，`BD:261`）。
- **Web 建议**：格式解析由「格式解析」模块提供 `{title,author,description,subjects,cover}`；记录以 4.8 的 `books` 结构保存。

### LIB-041 阅读进度记录（positions10）· P0 · [浏览器]
- 存 prefs 文件 `positions10`：键 = 书完整路径**小写**；值 = 位置串，语法 `[章]@[分段]#位置[:百分比]`（见 4.2）。`AT.saveLastPostion` 在翻页/暂停/退出时写；HTML 书另写 `键+"2"` = `lastWebY`（int）；PDF 另写 `键+"pdf"`（缩放#x:y@锁定*页）；CBZ 写 `当前图片文件:百分比`。读时若精确键不存在，会按「文件名」后缀模糊匹配别的路径下的同名书（`AT.getReadingPosition` `AT:7223`）——这就是换目录后进度还在的原因。
- 百分比：TXT 用两位小数（`0.00%`，到末尾为 `100%`），其它用一位小数（`T.getPercentStr`）。书架读取时 `T.string2Int` 取整数部分（`AM:7289`）。
- 位置语义（章/分段/字符偏移）由阅读器负责，本模块只保存/传输字符串并解析出 3 个整数（`A.getLastPositionAndChapterFromString` `A:5731`）。
- **Web 建议**：`positions` store：`{bookId, chapter, splitIndex, position, percent, webY?, pdf?, updatedAt, deviceId}`，同步时才序列化回原字符串。

### LIB-042 最近阅读历史（history.txt）· P0 · [浏览器]
- 文本文件，每行一个**完整路径**，最新在前（`T.stringList2Text` = 每行以 `\n` 结尾，`A.saveHistory` `A:9590`）。读取时逐行校验：若主目录存在则剔除文件已不存在的行，并把 zip 内路径等规范化（`A.getHistory` `A:5131`）。写入时机：每次打开书 `addHistory`（异步线程，`AT.addHistory`）。无数量上限。重命名/迁移 `A.renameHisotry`（同步改 `positions10` 键，`A:9523`）。

### LIB-043 标注表（notes）语义与去重 · P0 · [浏览器]
- 书签、高亮、笔记**共用一张 `notes` 表**（DDL 见 4.1）：
  - 书签：`bookmark<>''`（书签名/摘要文字），`highlightLength` 列此时存**书签颜色**，`highlightColor` 存默认高亮色（`bookmarkToNote` `BD:233`）。
  - 高亮：`bookmark=''` 且 `note=''`；`highlightLength`=高亮字符数(>0)、`highlightColor`=ARGB 整数、`underline/strikethrough` 为 0/1，`bak='1'` 表示波浪线 (squiggly)。
  - 笔记：`bookmark=''` 且 `note<>''`（`original` 存被标注原文）。
  - 位置键：(`章 lastChapter`、`分段 lastSplitIndex`、`字符偏移 lastPosition`)；PDF 的 `lastPosition` 为页码语义（细节另有文档）。
- 读取高亮时的**合并/清理**（`BD.getNotesHighlights` `BD:1075-1190`）：同章/分段/长度/颜色且 `original` 相同、偏移相差 <10（原文长 ≤6）/<25（>6）/<50（>10）的无笔记高亮视为重复并删除后重写。
- 删除：`removeBookmark/removeNote/deleteNotes/clearBookmarks`，均以 `lowerFilename`+位置匹配。
- 路径兜底：当库中该书路径下无标注而 `A.lastFile` 同名时，会按文件名后缀 `%/xxx.epub` 找到别的路径下的旧标注并迁移（`BD.getBookmarks` `BD:761`）。
- **Web 建议**：`notes` store，bookId + (chapter,split,position) 为逻辑唯一键；同步时需要墓碑（见 SYNC-007 改进）。

### LIB-044 临时书籍记录（tmpbooks）· P1 · [浏览器]
- 书**未导入书架**而直接被打开（例如从文件页点开）时，阅读器会把解析出的书名/作者/简介/标签写入 `tmpbooks`（`AT:15040-15068`、`BD.insertBookToTemp` `BD:1504`），使「最近阅读」能显示书名与作者而无需入库；读取时 `getBookFromAll` 先查 `books` 再查 `tmpbooks`（`BD:743`）。
- **Web 建议**：不必分表，用 `books.onShelf=false` 区分。

### LIB-045 路径变更与重命名 · P2 · [浏览器]（仅文件名变更）
- `BD.changeBookFile(旧,新)` 同时更新 `books/notes/statistics` 的 `filename(+lowerFilename)`（`BD:237`），`A.renameHisotry` 更新历史与 `positions10`。文件页「文件改名」(`renameBookFile` `AM:8412`) 使用。
- **Web 建议**：以稳定 `bookId`（内容哈希）为主键，改名只改 `filename` 字段，避免全表联动。

### 2.2 云同步 / Readwise（SYNC）

### SYNC-001 同步总开关、账号与路径 · P1 · [浏览器] / WebDAV [服务端]
- **入口**：阅读器「其它选项」(PM) 内三个互斥复选框——「通过 Dropbox 在手机平板间同步阅读进度」(Dropbox)、同文案的 Google Drive 版、WebDAV 版（文案里的 Dropbox 字样被替换成对应云盘名，`A.getWebDavTitle/getGdriveTitle`），每个右侧有设置按钮（`pmSetDropbox/pmSetGdrive/pmSetWebDav`）。互斥逻辑在 `PM.onSyncCheck`（`PM:264-320`）：选中一个会取消另两个并把 `syncType` 设为 6/2/4；勾选时若未登录则走登录流程，成功后**立即下载一次阅读进度**。
- **各云设置对话框**（`PM.showCloudOptions` `PM:~2000-2150`、`WD.showLogin`）：
  - 文案：显示同步信息 (Show sync working message) `showSyncMsg`(默认 true)；仅通过阅读器工具栏上的云按钮手动同步 `syncManually`(false)；自动备份到 Dropbox 的 /Apps/Books 目录（备份书籍文件）`syncReadingBook`(false)；只在 WIFI 网络下备份 `syncBookInWiFiOnly`(false)；自动更新最近阅读列表 `syncRecentList`(false)（后两项仅在「备份书籍文件」勾选后可见）；路径 (Path) `{Dropbox|Gdrive|WebDav}tag + 书籍根路径`（默认 `/Apps/Books`，改变后立即重新下载进度）；「取消授权」按钮（Dropbox 显示账户信息 `GetDropboxInfoAsync`；GDrive 显示邮箱）。
  - WebDAV 额外：WebDav Url、用户名、登录密码，示例 `[BOX]https://dav.box.com/dav`、`[JIANGUO]https://dav.jianguoyun.com/dav`、`[OwnCloud]http://a.com/remote.php/webdav`；确定后「正在连接网络, 请稍候...」→ `verifyWebDav`（对 URL 发 PROPFIND 存在性检查，`WD:verifyWebDav`）→「登录成功/登录失败」；成功还会从收藏目录里清掉旧 `[WebDav]` 条目。
- **存储**：Dropbox token → prefs `dropbox`(`access-token`,`user-id`)；GDrive → prefs `gdrive`；WebDAV → prefs `webdav`(`url,user,pass(混淆),ok`)。设备标识 `deviceRandomID2`（首次运行的毫秒时间戳字符串，**恢复备份时会重置**，`PM.restoreProc_over2` `PM:1392+`）。
- **Web 建议**：账号信息存 IndexedDB `syncAccounts`（Dropbox 用 OAuth2 PKCE，只存 refresh/access token；WebDAV 口令建议只存于服务端或用 WebCrypto 派生密钥加密，**不要用原混淆算法**）；每设备生成随机 `deviceId`。

### SYNC-002 阅读进度同步（`.po`）· P1 · [浏览器]
- **文件**：`{书籍根路径}/.Moon+/Cache/{书文件名(含扩展名)}.po`，UTF-8 纯文本，一行：`{deviceId}*{位置串}[|{webY}]`，例 `1698000000000*3@0#12345:45.67%|1200`。（`A.uploadCloudPositionFile` `A:10714`、`A.getXxxPositionFilename` `A:4670/8415`）
  - 键只用**文件名**（无目录），两本不同路径同名书会互相覆盖。
- **上传**（读者暂停 `AT.onPause`，且距 onResume >1.5s、非手动模式、非「点 Home」标志）：读 `positions10[lastFile小写]` 及 `+2`；若 **5 分钟内**且 `lastFile+位置串` 与上次相同则**不上传位置**（仅继续传标注）；Dropbox 用 `WriteMode.OVERWRITE`；成功后接着传标注 `.an`（SYNC-003）→ 最近阅读 `recent.list`（SYNC-004）。
- **下载**（`A.downloadCloudPositionFile` `A:3091`）：触发时机见 SYNC-006；解析 `deviceId*…`：**若 deviceId ≠ 本机 `deviceRandomID`** 则把位置串**无条件写入本机** `positions10`（及 `+2`），并通知阅读器（消息 801）；若与本机相同则忽略（自己传的）。下载成功后接着下载标注 `.an`。
- **用户确认**（`AT.showHintForCloudPositionSync` `AT:22975`）：当远端位置与当前不同——TXT 偏移差 >80 字符，或章/分段不同；HTML 书 `webY` 不同；PDF 页码不同——弹出对话框（标题=云盘名，正文「Dropbox上有本书新的阅读进度, 是否进行同步?」[确定/取消]）。确定 → 重载书到远端位置；取消 → 恢复本地位置（并且之后上传时会覆盖云端）。
- **开关**：`syncType≠0` 且 `!syncManually` 才自动；`showSyncMsg` 控制「从云端同步... / 同步到云端...」提示。
- **Web 建议（互通优先）**：实现读写**完全相同的 `.po` 文本**，即可与手机版 App 互通；同时在自家存储里额外存 `updatedAt` 以便本机做「新旧比较」而不是盲目覆盖（见 SYNC-007 改进）。位置串解析/生成函数见 4.2。

### SYNC-003 标注同步（`.an`）· P1 · [浏览器]
- **文件**：`…/.Moon+/Cache/{书文件名}.an`，**zlib（Java `DeflaterOutputStream` 默认=RFC1950 zlib 头 `78 9C`）压缩的 UTF-8 文本**（`MZ.compress/decompress` `MZ:191/210`）。内容格式见 4.4。
- **上传**（`A.uploadCloudNoteFile` `A:10672`）：仅当 `hasNewNoteForUpload`（添加/修改/删除标注、书签时置位，`AM`/`PrefChapters`/`AT` 多处）；导出本书**全部**标注（`BD.exportNotesToText` `BD:654`）+ 本会话累积的删除墓碑（`A.deletedNotes` → `deletedNotesToText`），文本长度 >10 才上传。PDF 书走 PDF 引擎自己的导出（`PDFcreateTextFromNotes`/`PDFcreateNotesFromCloud`，格式未读，存疑）。
- **下载合并**（`A.dealDownloadedCloudNote` `A:2750` → `extractSyncNotes` `A:3311` → `BD.importNotesFromText` `BD:1349`）：
  1. 首行=对端书文件字节数，与本机该书大小差 **>100000 字节**则拒绝（返回 -2，认为不是同一版本）；
  2. 每条按 (lowerFilename, 章, 分段, 偏移) [书签再加 `bookmark<>''`] 匹配本地：**不存在** → 若内存里也确认不存在则插入；**存在且内容不同（`differentNote`：书签名、笔记、颜色、波浪/删除线/下划线、偏移、长度任一不同）** → **远端覆盖本地**（先删后插）；**远端为 `*DELETED*`** → 删除本地；
  3. 至少插入/删除一条 → 返回 1 → 阅读器重载书签与高亮。
- **Web 建议**：同样格式互通；本机内部另存 `updatedAt/deleted` 以支持持久墓碑。

### SYNC-004 最近阅读同步（`recent.list`）· P2 · [浏览器]
- **文件**：`…/.Moon+/Cache/recent.list`，单行：`{云端书路径}??1{书名}??2{毫秒时间}??3{本机文件字节数}??4{本机文件路径}??5{deviceId}*{位置串}`（`A.createCloudRecentList` `A:2465`、`CloudRecentItem` `A:902`）。**只记录「最近读的一本书」**，每次覆盖。
- **上传条件**：`syncRecentList` 开启且当前书已在云端书籍根目录有副本（`cloudHasCurrentBook`，即已开启「备份书籍文件」）。
- **下载**（`AM.downloadCloudRecentList` `AM:6683`，`AM.onResume` 时触发，需 `syncReadingBook && syncRecentList` 且联网）：若远端 `deviceId` ≠ 本机且 App 在前台 → `validateRemoteRecentItem`：在历史里按文件名找、再试 `filenameInUploadedDevice` 本机路径、再按「同名且同大小」在上次目录/下载目录搜；找到则把它提到历史首位，找不到则在最近阅读列表顶部加一条「云端远程书」。Toast「最近阅读列表已加入从云端(%s)检测到的新书: 《书名》, 进度%」。
- **Web 建议**：Web 端本地已有完整历史，可只实现「读取并在最近阅读顶部显示一条建议卡片」，写出也保持原格式以免影响手机端。

### SYNC-005 书籍文件同步 · P2 · [浏览器]（大文件上传；WebDAV [服务端]）
- 开关「自动备份书籍文件」`syncReadingBook`（默认 false）+ `syncBookInWiFiOnly`。打开一本书后（`AT:20005-20030`）`A.backupReadingBookToCloud`：若书在云缓存目录则只检查是否存在；否则上传到 `{书籍根路径}/{文件名}`（Dropbox/GDrive/WebDAV 各自 `*Task(op=2)`）；上传前 `exists` 检查：**云端已存在且大小相同（或 `uploadIgnoreNewerFile` 且本地更旧）则跳过**（`WebDavTask` 约 :488）。文件名含 `?`（压缩包内）的不传。
- **云端打开**：文件页浏览云盘（SYNC-011）或「远程最近」条目 → 下载到 `{主目录}/.MoonReader/cloud`（`cloud_cache_path`，比较大小避免重复下载；映射关系存 prefs `webdav_cache/dropbox_cache/gdrive_cache`：本地缓存路径→云路径）。
- **Web 建议**：上传用 Blob；Dropbox 单次上传 ≤150MB，更大需 upload session；WebDAV 需代理。

### SYNC-006 触发时机汇总 · P1 · [浏览器]
| 动作 | 触发 | 出处 |
|---|---|---|
| 勾选云盘同步 | 登录成功后立即下载 `.po` | `PM:onSyncCheck` |
| 打开书（阅读器创建完成） | 后台线程：重算高亮、**下载 `.po`**（非手动）；若开启备份书籍则上传书 | `AT:20005-20030` |
| 阅读器回到前台 | `doSyncFromCloudOnResume`（无网络时每秒重试，最长 8s） | `AT:4931`、`AT:17322` |
| 阅读器暂停/退出 | **上传 `.po` → `.an`(如有改动) → `recent.list`** | `AT:20577` |
| 手动模式 | 阅读器底栏第 18/19 号按钮「同步到云端 / 从云端同步」（`ReaderBar.setCloudButtons`，勾选手动同步会自动把这两个按钮加入底栏）；若 `syncType=0` 点击会提示「Dropbox连接状态: 未连接」并跳转设置 | `AT:4948-4975`、`DragSort/ReaderBar:289` |
| 书架页回到前台 | 下载 `recent.list`（需开启） | `AM:14097` |
| 改书籍根路径 | 立即重新下载进度 | `PM:2116` |
- 网络判断用 `T.isNetworkConnecting`；Web 对应 `navigator.onLine` + 请求失败重试。

### SYNC-007 冲突策略（总结）· P1 · 设计要点
| 数据 | 原策略 | 缺陷 | Web 建议 |
|---|---|---|---|
| 位置 `.po` | 一书一文件，**最后上传者胜出**；下载时仅按 `deviceId` 区分是否自己传的，无时间戳比较；用户可在对话框取消 | 两台设备各自改动后先后上传会丢一份；旧设备重新联网上传会回退进度 | 本地存 `updatedAt`，只在「远端更新」时提示；仍写原格式并在同目录另写一个 `.po.json`（含 `updatedAt`）供自家 Web 端比较 |
| 标注 `.an` | 全量快照；按 (章,分段,偏移) 合并，**不同内容远端覆盖本地**；删除靠 `*DELETED*` 墓碑 | 墓碑只存于内存（`A.deletedNotes`，打开书时清空，`AT:8566`），**换会话后被删标注可能从另一端复活**；无 per-note 时间戳 | `notes.updatedAt/deletedAt` 持久化；合并取较新者 |
| 最近阅读 | 单条、覆盖 | 只反映最后一本 | 可选 |
| 书籍文件 | 云端有同名同大小就不传 | 内容相同但大小相同的不同版本被误判 | 用哈希 |

### SYNC-008 WebDAV 实现细节 · P1 · [服务端]
- 协议（`WD/webdav/WebDavFile.java`，OkHttp + `WAuth`）：`PROPFIND`（`Depth: 1`；服务器对目录返回 400 时自动改用带尾部 `/` 的 URL 重试（`fixDir400`）；请求体 `<a:propfind xmlns:a="DAV:">` 含 displayname/resourcetype/getcontentlength/creationdate/getlastmodified；`exists()` 也用它，并靠响应里有无 `:collection` 判断是否目录）、`GET`、`PUT`、`MKCOL`（`makeDirs`，上传前对父路径逐级创建并缓存 `initedPaths`）、`DELETE`（失败再试带 `/` 路径）、`MOVE`、`COPY`；认证 = HTTP Basic（`WAuth.setAuth(user, pass)`）。
- **浏览器直连不可行**：常见 WebDAV 服务（坚果云等）不返回 CORS 头——实测 `https://dav.jianguoyun.com/dav/` 的 `OPTIONS`/`GET` 均只返回 401 且无 `Access-Control-*`（2026-10-21）。
- **服务端需提供**：`/api/webdav/<op>` 代理（把 method/path/depth/body 透传到用户配置的 WebDAV 基址，鉴权用服务端保管的凭据或每次请求携带，需支持 `PROPFIND/MKCOL/MOVE/COPY/PUT/GET/DELETE`，流式转发大文件，限制目标主机防 SSRF）。

### SYNC-009 Dropbox 实现细节 · P1 · [浏览器]
- 原实现：官方 Android SDK `DbxClientV2`，`Auth.startOAuth2Authentication(appKey)`（需要安装 Dropbox App 授权），token 存 prefs；使用的 API：`files().download/uploadBuilder(OVERWRITE)/listFolder/search/copyV2/moveV2/deleteV2`，文件夹不存在时 `isFolderNotExistError`（错误文本含 404/`not_found`）被当作「云端没有」；路径形如 `/Apps/Books/.Moon+/Cache/…`。
- CORS 实测：`api.dropboxapi.com` 与 `content.dropboxapi.com` 的预检请求返回 `Access-Control-Allow-Origin: <来源>`，允许 `Authorization, Dropbox-API-Arg, Content-Type` 头 → **浏览器可直连**（用 OAuth2 PKCE，无需 secret）。
- 注意：需自行注册 Dropbox 应用；若要与手机端路径 `/Apps/Books/...` 互通，应用须是「完整 Dropbox」权限而非「应用文件夹」（原 App 的权限类型未能从源码确认，存疑）。

### SYNC-010 Google Drive 实现细节 · P2 · [浏览器]
- 原实现（`GdriveSync`）：Google 登录请求 scope `https://www.googleapis.com/auth/drive`（**完整 Drive 权限**）；Drive 没有路径概念，类里用 `ids/ids_time` 缓存与 `getGdriveFile(path)` 逐级按名称找文件夹/文件（`files.list q="'<parentId>' in parents and trashed=false"`），不存在则 `files.create`（`application/vnd.google-apps.folder`），上传用 `files.update/create`，下载 `executeMediaAsInputStream`；文件元数据字段 `id,name,size,createdTime,modifiedTime,starred,mimeType`。
- CORS 实测：`www.googleapis.com/drive/v3/files` 预检返回允许来源与 `authorization,content-type` → 浏览器可直连（Google Identity Services 取 access token）。
- **限制**：`drive` 是受限 scope，Web 应用需通过 Google 验证；用 `drive.file`/`appDataFolder` 则**看不到手机端创建的文件**，无法互通。建议 P2，互通场景优先 Dropbox/WebDAV。

### SYNC-011 文件页里的云盘浏览（Dropbox / Google Drive / WebDAV）· P2 · [浏览器]/WebDAV [服务端]
- 在「我的文件」页（`A.files_from`：0 本地，2 Dropbox，4 GDrive，6 WebDAV；搜索对应 3/5/7）。操作码（`A:CLOUD_*`）：0 列目录、1 下载、2 上传、3 搜索、4 移动、5 复制、6 删除、7 改名、8 判存在（`*Task`）。云目录路径条、新建目录、粘贴条（复制/移动/下载）、多选下载/删除、搜索（Dropbox `files().search`）。点击云端书籍 → 下载到 `cloud_cache_path` 后打开；禁止云间互拷（`cannot_copy_between_clouds`）。登录态过期（Dropbox 需重新授权，提示 `dropbox_sync_again`）。
- **Web 建议**：做成「云端导入」对话框：选云盘 → 浏览目录 → 勾选书籍 → 下载进 `files` 并导入；其余文件管理操作不做（P2）。

### SYNC-012 Readwise 高亮同步 · P2 · [浏览器]
- **配置**（`Readwise.showOption`，阅读器「标注列表」里「分享到 Readwise」）：对话框两个输入——`Token:`（`readWiseToken`）、`Url:`（默认 `https://readwise.io/api/v2/highlights/`，`readWiseUrl`）；token 改变时发送测试高亮 `{title:"test",author:"moonreader",text:"test highlight",note:"test note"}`，成功则打钩（`syncReadWise`）。选项「自动分享新的高亮和标注到 Readwise」`syncReadWise`（默认 false）。
- **上传**（`Readwise.addHighlights`）：`POST`，`Content-Type: application/json;charset=UTF-8`，`Authorization: Token <token>`，body `{"highlights":[{title,text,author,note?,chapter?}]}`；`title`=书名、`text`=被标注原文(`original`)、`note`=笔记、`chapter`=章名（仅 `shareWithChapter` 默认 true 且是电子书）；200 为成功，失败 Toast「Readwise Error: code | message」。新建高亮/笔记时（`A.addNote(noteInfo, 是否新建)` `A:1884-1890`：仅当 `syncReadWise` 为真且 `original` 非空）自动单条上传；也可在标注列表手动对某条上传（`PrefChapters:213-218`，无 token 时先弹配置框）。
- CORS 实测：`readwise.io/api/v2/highlights/` 预检返回允许来源/`authorization,content-type`、方法含 POST → **浏览器可直连**，无需服务端。
- 标注的创建/列表属阅读器模块，仅在此交叉引用。

### 2.3 网络书库（NET）

### NET-001 书库列表（网上书库首页）· P1 · [浏览器] 但内容抓取 [服务端]
- **UI**：标签页 3，列表（或格子，`libraryUseGrid`）每项：站点图标 + 名称 + 简介；点击 = 打开；右侧 ⋮/长按菜单：打开 / 编辑 / 删除 / 置顶（`catalog_popup_menu` + 置顶，`LibraryAdapter` `AM:2436`）。顶栏菜单：「增加新书库」(Add new catalog)、「使用格子布局」。
- **内置站点**（`assets:netcatalog.txt` 顺序：gutenberg、feedbooks、mobileread、moonreader；每项一个 XML，被释放为 prefs 文件 `network2_*.xml`，按 `version` 升级；用户删除过的记入 `delete_catalogs` 不再恢复；`version=-1` 的文件会被删除，`N.extractLibrariesFromAssets` `OPDS/N.java`）：
  | 站点 | main URL | 搜索 | 备注 |
  |---|---|---|---|
  | Project Gutenberg（古腾堡） | `https://m.gutenberg.org/ebooks.opds/` | `http://m.gutenberg.org/ebooks/search.opds/?query={searchTerms}` | UA `Stanza Android MoonReader`；v8 |
  | Feedbooks | `https://www.feedbooks.com/catalog.atom` | 动态发现 | v4 |
  | 「More books in your language」(MobileRead) | `http://wiki.mobileread.com/wiki/OPDS`（`html=true`，作为网页打开） | — | 指向 OPDS WIKI 页面找更多站点 |
  | Moon+ Catalogs (`moondownload.com/catalog.xml`) | — | — | `version=-1`：**默认被移除**；该文件现仍可访问（2026-10-21），内含用户投稿站点（Prestigio、德/俄/中文 OPDS、ebooksgratuits、青空文庫…） |
  - `assets:network_deleted/` 里是历史站点（Archive.org、BookBoon、LibGenesis、PdfDrive、ManyBooks、Smashwords、Standard Ebooks、WebNovel 等，均已下架或 HTML 站点）。
- **站点属性**（`OpdsSite`，存 prefs）：`title/title_cn`、`summary/summary_cn`、`main`、`baseUrl`、`search`(含 `{searchTerms}` 与 `{startPage?}`)、`signIn/signOut`、`username/password`(混淆)、`image`(assets:network/ 下图标)、`useragent`(默认 `OPDS/Stanza iPhone/Aldiko/Moon+ Reader(Android)`)、`cn_only`(非中文环境隐藏)、`html`(作为网页)、`lock_search_url`。
- **可用性实测（2026-10-21，调研机）**：
  - `https://www.gutenberg.org/ebooks/search.opds/` 与 `…/ebooks.opds/` 的 GET 响应带 `Access-Control-Allow-Origin: *` → **可浏览器直连**；但 `m.gutenberg.org/ebooks.opds/`（内置 URL）会 301 到 `www.gutenberg.org`，301 本身无 CORS 头，浏览器 fetch 会失败 → Web 版应把内置 URL 更新为 `https://www.gutenberg.org/ebooks.opds/`。
  - **书籍文件下载无 CORS**：`https://www.gutenberg.org/ebooks/1342.epub3.images` 302 到 `…/cache/epub/1342/pg1342-images-3.epub`，响应无 `Access-Control-Allow-Origin` → 浏览器不能 `fetch` 取字节，**必须服务端代取**（见 NET-007）。
  - `https://www.feedbooks.com/catalog.atom` 对 curl（含原 App UA）返回 **403**，疑似反爬，**当前可能不可用**。
  - `wiki.mobileread.com` 本次请求超时无响应。
  - `standardebooks.org/feeds/opds` 返回 401（需认证）。
- **Web 建议**：内置站点列表做成可配置 JSON；默认只放 Gutenberg（www 域名）；其余通过「增加新书库」由用户添加。**所有站点请求统一走服务端代理**，原因：多数 OPDS 服务无 CORS、书籍直链常 302 且无 CORS、Calibre 内容服务器在用户局域网（HTTP，且 HTTPS 页面禁止混合内容）。

### NET-002 OPDS 浏览、分页与导航 · P1 · [服务端]
- **流程**（`openLibrary` `AM:8133`→`doDownloadHandler` `AM:12429`→`downloadHandler` `AM:733`→`OpdsEntries`）：GET 站点 `main`（UA 用站点 `useragent`，信任所有 HTTPS 证书 `T.trustHttpsUrlConnection`）→ 若 401 → 登录对话框（NET-005）→ 解析为条目列表 → 列表页。
- **解析要点**（`OPDS/OpdsEntries.java` SAX，见 4.6）：条目类型三分（`OpdsEntry.itemType`）：有下载链接 = 书(0)；`linkType` 含 `atom` = 子目录(2)；其它 = 网页(1)。点击子目录 = 以其 `linkHref` 为 baseUrl 递归；点击网页 = 内嵌 WebView（NET-006）；点击书 = 详情页（NET-004）。
- **导航**：顶部工具栏（`mHome/mPrior/mNext/favorite2/outer2` + 页码 `mPageEdit/mPageText`）：主页（回站点列表）、上一页/下一页（**优先用已缓存的前/后页栈 `savedPriorBookList/savedNextBookList`，否则用 `rel=next` 链接；上一页在 `totalResults/itemsPerPage` 已知时可计算页 URL**）、页码输入（「请输入页码: (1-N)」，仅当 `nextUrl` 且 `itemsPerPage>0 && totalResults>0`）、收藏当前（网页站点）、外部浏览器打开。后退键 `doNetBack`：弹出 `bookListHistory` 栈，保留滚动位置 `lastScrollY`。
- **空/错误**：解析不出条目时若有 `errorMsg` 则在 WebView 对话框里展示错误 HTML（会提示 Calibre 用户在 URL 末尾加 `/opds`）；否则「没有找到相关列表,请稍后重试.」。
- **Web 建议**：服务端 `GET /api/opds/fetch?url=&ua=` 返回原始 XML 或已解析 JSON；前端自己维护历史栈与分页。

### NET-003 OPDS 搜索 · P1 · [服务端]
- 站点 `search` 模板（含 `{searchTerms}`，及可选 `{startPage?}`）；顶栏搜索框（网上书库页）提交时把关键词 URL 编码替换后请求（`do_netLibrary_search2` `AM:6583`）。若站点没有 `search`，解析 feed 的 `<link rel="search">`：模板含 `{searchTerms}` 直接用；否则当作 OpenSearch 描述文档再抓取并取其中 `application/atom+xml` 的 `{searchTerms}` 模板（`XmlHandler.getSearchUrl`，Feedbooks 特殊处理）。`lock_search_url` 为真则不覆盖。
- **Web 建议**：同 NET-002。

### NET-004 书籍详情与下载 · P1 · [服务端]
- 详情页（`NBI`，`res:layout/net_book_info.xml`）：标题栏=站点名；封面（`thumbnail`/`cover`）、书名、作者、HTML 简介（`content` 或 `summary`）、「可下载格式: epub (1.2 MB), pdf…」（后台逐个 `HEAD`/GET 取文件大小 `T.getUrlFileSize`）；按钮「下载」「阅读」（已下载才可点）。多格式时点「下载」弹菜单「下载 1: epub (大小)」…；默认选 epub，否则第一个。
- **格式识别**：`link type` 以 `application` 开头时按类型/扩展名判定 epub、pdf、mobi 类（`azw/azw3/mobi/prc`）、txt、fb2、cbz、cbr、djvu、azw3（`djvu` 且类型含 `+zip` 标记 `isZip`）；`rel` 为 `…/thumbnail`、`…/cover`、`image/thumbnail` 的链接取封面（`data:image` 则 base64）；`rel=related` 收集相关链接。
- **保存路径与名称**：`{主目录}/MoonReader/{书名 - 作者(去特殊字符，>100 截断+随机数)}.{扩展名}`（`getDownloadTo`；`fb2.zip` 保留）。下载完成保存封面到 `{缓存}/{文件名}.png`（NETCOVER）；点「阅读」直接打开（CBZ/CBR 进图库）。
- **Web 建议**：「下载」= 服务端取字节 → 回传给浏览器写入 `files` 并按 LIB-021 入库（`downloadUrl` 记 `UNKNOW` 或来源 URL）。

### NET-005 添加 / 编辑 / 删除书库，账号 · P1 · [浏览器]（验证请求走服务端）
- **添加**（`addNewCatalog` `AM:5116`）：对话框「增加新书库」：书库名(可选)、书库网址(默认上次 `last_catalog_url`，长度<10 不处理)；中立按钮「Calibre IP」→ 输入 IP 四段 + 端口(默认 8080)，拼成 `http://a.b.c.d:端口/opds`（`AM:5157`）。确定 → `addNewCatalog2` 请求该 URL（10s 超时）：**可解析为 OPDS 条目 → 保存为 OPDS 书库**（名=输入或 feed 标题，简介=feed `subtitle`，`search`=feed 里发现的搜索模板，文件名 `network2_<URL去特殊字符>`），然后**重启 App** 加载；**否则当作网页书库**（`html=true`，名=输入或 `<title>`）直接加到列表末尾。401 → 要求用户名密码。
- **编辑**（`openLibraryEditDialog` `AM:8146`）：名称、网址、用户名、密码（用户名为空则隐藏登录行）；确定后刷新列表。**删除**：确认「请确认是否删除书库: 名称」→ 写入 `delete_catalogs`（防止内置站点被恢复）并删除其 prefs 文件。
- **登录**（`doUnauthorizedDownload` `AM:12816`）：401 时若站点已存凭据则直接重试，否则弹「登录」对话框（用户名、登录密码、「记住我」→ 保存到站点 prefs，密码混淆存储）；重试用 `BasicHttpParams` + 凭据（遇到 SSL 握手异常回退到手写 `Authorization: Basic`）。
- **Web 建议**：书库配置存 `catalogs`（口令只存服务端或加密后存）；添加时由服务端验证并探测搜索模板；删除内置站点要记墓碑。

### NET-006 HTML 网页书库（WebView）· P2 / [不做: 浏览器 iframe 被 X-Frame-Options 阻止且无法拦截下载]
- 站点 `html=true`（如 MobileRead wiki）或 OPDS 条目类型为网页时，用内嵌 WebView 打开（`showHtmlLibrary` `AM:14602`）：自定义 UA，可后退/前进/刷新、收藏当前页为新书库、外部浏览器打开；**拦截 WebView 下载**（`DownloadListener` → `downloadable(url)`：带 Cookie 对链接发 HEAD 读 `Location`/`Content-Disposition` 取最终 URL 与文件名 → 弹 `downloadBook2` 确认下载）。
- **Web 建议**：用「在新标签页打开」+ 让用户把下载链接粘贴到 NET-008；不做内嵌浏览。

### NET-007 下载服务 · P1 · [服务端]
- `BDS`（前台 Service）+ `BookDownloadCancelAct`：通知栏进度（下载中/完成/失败）、可取消；先写 `{目标}.mr` 临时文件，完成后按**文件头魔数**纠正扩展名（`T.getFileTypeFromBinary`），`.zip/.rar` 自动解压取第一本书（`getBookFromZip`），`.fb2` 实为 zip 则改名 `.fb2.zip`；支持 Cookie、Basic 认证（401 时发广播 `need_password`→ 提示输入）、自定义 UA；完成后广播通知书架刷新（`BookDb.hasNewDownload`）。
- **Web 建议**：服务端 `GET /api/download?url=&ua=&auth=`（流式转发、SSRF 防护、大小上限、`Content-Disposition` 透传）；前端用 `fetch(...).body` 读流显示进度，支持 `AbortController` 取消；完成后做魔数识别（zip/epub/pdf）。

### NET-008 从链接下载书 · P2 · [服务端]
- 对应原 App 接收浏览器「下载」意图（`A.downloadFileFromBrowser`，LIB-036）。Web 提供「从 URL 导入」输入框 → 走 NET-007。

### NET-009 书库作用域的搜索历史与置顶 · P2 · [浏览器]
- 站点置顶 `lib_top_items`；网上书库页搜索历史 `net_search`（见 LIB-010）。

### 2.4 阅读统计（STAT）

### STAT-001 统计采集 · P1 · [浏览器]
- **全局**（prefs，`A`）：`statistics_pages`（翻过的页数）、`statistics_words`（读过的字数）、`statistics_time`（毫秒）、`statistics_days`（阅读天数，≥1）、`statistics_last_day`（最后记录日=自 epoch 起的天数）。`A.incReadDays`（`A:8493`）：当天数 > last_day 则 `days++`。
- **单书**（`statistics` 表）：`usedTime`(ms)、`readWords`、`dates`（逐日明细，STAT-002）。
- **采集点**（阅读器内）：**仅前进翻页**（`pageDirection==1`）或自动滚屏时 `statistics_add`（与上次计数间隔 >1s 才计，同一滚动位置+同章不重复计，双页模式 +2；滚动阅读模式每滚过一个页高计一次 `saveMoveReadingStatistics`）并 `addStatisticsWords(本页文字)`（`T.getWordsCount(文本, 是否亚洲语言)`）；`saveStatisticsInfo`（`AT:15111`）在暂停/退出/定时等点结算：距上次 >2s 且读字数>0 才记入，`usedTime += 本段毫秒`、`readWords += 字数`、全局 `statistics_time += 本段`；用户空闲 >10 分钟时（`recordUserActiveTime`）把起点回退到「1 分钟前」，**朗读/自动滚屏期间不计空闲**；PDF 以去重页集合计页并取该页文本计字。
- **Web 建议**：阅读器暴露事件 `pageTurned(words)`/`sessionTick`，统计模块按上述规则累计；`statistics` 同时记 `updatedAt`。

### STAT-002 单书逐日明细格式 · P1 · [浏览器]
- `statistics.dates`：多行文本，每行一天：`{dayNumber}|{毫秒}@{字数}`（旧版仅 `{dayNumber}`）。`dayNumber = (本地当天 0 点毫秒 + 时区 rawOffset) / 86400000`（`T.getTodayNumber`，`books/T.java:2032`，使用当前时区 `getRawOffset`，不含夏令时）。跨午夜的一段会按比例拆到前一天/当天（`AT.recordDateReadTime` `AT:14568`）；同一天累加（`addDateReadTime`）。读取时 `getReadDate`：取首行与末行日期显示为「起 - 止」；`getReadDate2`：每行 `本地化日期 + 时长(T.formatInterval) + 速度(字数/分钟)` 以 `<br>` 连接。
- **Web 建议**：结构化存储 `{day: number, ms, words}[]`，导入/导出时转回该文本。

### STAT-003 首页统计卡片（8 张）· P1 · [浏览器]
| 卡片 | 文案(英) | 计算 |
|---|---|---|
| 0 | 书架书籍总数 (Books On Shelf) | `COUNT(books)`；点击→书架页 |
| 1 | 已读书籍总数 (Read Books) | `positions10` 条目数；点击→完整最近阅读列表 |
| 2 | 阅读小时数 (Reading Hours) | `statistics_time/3600000`，`0.0` |
| 3 | 总共阅读页数 (Turn Pages) | `statistics_pages` |
| 4 | 每天阅读小时 (Reading Hours Per Day) | 小时 / `statistics_days`，`0.0` |
| 5 | 每页阅读时间(秒) (Reading Time(s) Per Page) | `(statistics_time/1000)/statistics_pages`，无页则 0 |
| 6 | 每小时翻页 (Turn Pages Per Hour) | `pages / hours`（hours 为 0 时用 0.1），`0` |
| 7 | 每分钟阅读字数 (Read Words Per Minute) | `words / minutes`（minutes 为 0 时用 0.1），`0` |
- 出处 `AM:3425-3520 fillStatisticsInfo`；卡片尺寸平板数字字号 30。
- 「已读书籍总数」口径宽（任何有进度记录的书都算，含 0%）；清除统计时勾选「清空最近阅读列表」会把它也清零（LIB-004）。

### STAT-004 单书统计展示位置 · P1 · [浏览器]
- 书籍信息（LIB-032）、最近阅读条目（描述行：`x.xx 小时, N 字/分钟` + 日期）、阅读器内 `getReadWordsPerMinute`（`AT:7249-7258`：优先单书速度，否则全局）。速度单位文案来自 `read_speed`「阅读速度(字/分钟)」括号内（英文 `w/m`）。

### STAT-005 清空统计 · P1 · [浏览器]
- 首页统计行图标或「标注汇总页」菜单：「清空全部阅读统计?」，复选「清空 "最近阅读"」；确定：全局五项归零（`days=1`）、`deleteAllStatistics`（清 `statistics` 表）、可选同时清历史与 `positions10`（`AM:5317`）。

### 2.5 备份与恢复（BAK）

### BAK-001 备份 · P0(本地 JSON/ZIP) P1(云端) · [浏览器] / WebDAV [服务端]
- **入口**：设置选项→「备份」按钮→菜单「备份到:」(本地 / Dropbox / Google Drive / WebDAV，`PM.doBackup` `PM:951`；云项只在对应云已登录时有效，`validCloud`)。
- **对话框**（`res:layout/backup_saveto.xml`，`PM.backupProc` `PM:331`）：标题「备份到: "<备份目录>"」（本地）；输入框=文件名（默认今日 `yyyy-MM-dd`，扩展名自动加 `.mrpro`(Pro)/`.mrstd`）；复选「包含书籍封面」「包含书籍文件」（勾选时显示估算体积）；说明「（范围：书架上的所有书籍和最近列表中的前20本书）」；中立按钮「目录」(Folders) 修改备份目录 `backup_folder`（默认 `{主目录}/MoonReader/Backup`）。
- **云端备份**：文件名 `"{输入} ({设备型号}).mrpro"`，先在本地生成 `{备份目录}/cloud.backup`，再上传到 `{书籍根路径}/.Moon+/Backup/{文件名}`；封面+书籍总体积 >50MB 时先提示「备份文件太大无法上传到云端，请备份到本地存储，然后手动通过云App上传到云端。您还想尝试直接备份到云端吗？」。
- **备份文件内容**（`MZ.ZipFolder(A.appDataPath, 目标, true, 带封面, 带书籍, handler)`，`MZ:78-137`；条目改名 `createNumFilename`、`_names.list` 写入 `saveNumFilenames` `MZ:291`；忽略规则 `isIgnoreFile` `MZ:282`；还原 `unZipFile` `MZ:328`）：
  - 标准 zip（Java `ZipOutputStream`）。把**整个应用私有数据目录**（`/data/data/<包名>/`）递归打包——包含 `databases/mrbooks.db`、`shared_prefs/*.xml`（`options1002.xml`、`positions10.xml`、`history.txt` 等全部设置与文本）；但跳过 `isIgnoreFile` 命中的路径（含 `/cache`、`/google_`、`webview`、`/files/`、`/prefs.xml`、dropbox 账号 xml、`/lib`、`/app_`、`.licensing.`、`/code_`、`.so`）。
  - **条目名被替换为 `<根目录名>/<序号>.tag`**，真实路径写入同 zip 内 `<根目录名>/_names.list`（每行一个原相对路径；书籍与封面行以 `?`+绝对路径(内部存储) 或 `*`+绝对路径(外置 SD) 为前缀）。`带封面`：先打包最近阅读前 20 本再打包其余书的封面（`getBookCoverFile`）；`带书籍文件`：同样先前 20 本再其余（`addOuterFile`）。
  - 备份范围**不包含**：Dropbox 账号 prefs（`dropbox.xml`）、`prefs.xml`、`/cache`、`/files/` 等（`isIgnoreFile`）。**注意**：`webdav.xml`（含混淆口令）与 `gdrive.xml` 不在忽略列表里，会被打进备份——Web 版导出时应默认剔除账号令牌/口令。
- **Web 建议（P0）**：「导出数据」= 生成 ZIP（或单个 JSON + blobs）：`manifest.json`（版本、导出时间、浏览器/设备）、各 store 的 JSON（books/notes/positions/stats/history/settings/catalogs…）、可选 `covers/`、可选 `books/`；下载为 `YYYY-MM-DD.mrweb`。云端备份（P1）= 同文件传到 Dropbox/WebDAV `.Moon+/Backup/`。如需**读取手机端 `.mrpro`**（P2）：解 zip、读 `_names.list`、解析 `mrbooks.db`（需 sql.js/WASM）与 `shared_prefs/*.xml`，转换进 IndexedDB。

### BAK-002 恢复 · P0(本地) P1(云端) · [浏览器]
- **入口**：设置选项→「恢复」→「恢复自:」→（本地/云）→ 列出备份目录里 `*.mrpro`（标 `(pro)`）、`*.mrstd`（标 `(std)`）文件；云端则列 `…/.Moon+/Backup/` 下同类文件（Dropbox `listFolder`、GDrive 列父目录、WebDAV `PROPFIND`）。没有则提示「没有找到备份文件, 请先点击备份建立新的程序备份」。选中后确认「恢复 "xxx"?」（`PM.restoreProc` `PM:1250`、`restoreProc_final/over/over2` `PM:1356-1480`）。
- **流程**：`MZ.unZipFile(备份, 数据目录上级, …)` 把条目按 `_names.list` 还原到原路径（旧包名 `.moonreader/.moonreaderp/.moonreaderpj/.seekbooks` 会被映射为当前包名；书与封面按记录的绝对路径还原）；还原后对 `options1002.xml` 做文本修补：`isFoldablePhone=false`、`cutoutScreen3=0`、`fitCutout3=0`、强制重启标志（回阅读器/回主页）、`auto_import_time=现在`、`deviceRandomID2=现在`（**重置设备标识，避免与同步冲突**），若屏幕尺寸与备份时不同则按当前设备重置状态栏/书架字号与封面大小（`sameScreenSize` 比较 `screensize` 键）；清理备份里没有的多余 prefs 文件；成功后提示「恢复成功」并重启；失败提示「恢复失败: …」；若出现异常中断，下次启动问「导入书籍操作失效, 是否继续?」（`restore_failed_function`）。
- **Web 建议**：「导入数据」：先校验 `manifest.version`，让用户选择「合并 / 覆盖」；覆盖前自动导出一份当前数据；恢复后重置 `deviceId`。

### BAK-003 标注导出/导入文件（`.an` 本地版）· P1 · [浏览器]
- 阅读器标注列表里的「导出到文件 / 从文件导入 / 分享高亮与备注...」（`R.array.notes_import_export`）使用同一套 `exportNotesToText/importNotesFromText`（`BD:654/1349`，导出可限定所选标注 `AnnotItem`），本地导出为**未压缩**纯文本（云同步的 `.an` 是 zlib 压缩后的同一文本）。分享文本格式属于阅读器模块。
- **Web 建议**：与 SYNC-003 共用实现。

---

## 3. 设置项总表（本调研范围）

> prefs 文件 `options1002`（键即 SharedPreferences 键，`A.loadOptions` 读取 `A:1243-1735`，`SaveOptions` 写 `A:1733`）。默认值取自 `A` 加载代码；「UI」列为原界面位置。阅读器排版/翻页/朗读设置不在此表。

| 键 (字段) | 默认 | 取值/范围 | 含义 | UI 位置 |
|---|---|---|---|---|
| **框架** | | | | |
| `lastDash` (`lastTab`) | 0 | 0..4 | 当前标签页 | 切换即存 |
| `lastDashItem` | 0 | 0..5 | 首页滚动到第几行（>0 显示 FAB） | — |
| `fabButtonType2` | -1 | -1 未设/0 显示/1 隐藏 | 继续阅读浮动按钮 | 选项→应用→显示继续阅读浮动按键 |
| `simpleRecentList` | false | | 首页直接用「最近阅读」完整列表 | 选项→应用→使用最近阅读作为开始页 |
| `openLastFile` | false | | 启动自动打开上次阅读文件 | 其它选项→自动打开上次阅读文件 |
| `favoriteOnDrawer` | false | | 抽屉里展开收藏夹子列表 | 抽屉「我的书架」右侧箭头 |
| `mainNightTheme` | false | | 书架界面夜间主题 | 抽屉→晚上模式/白天模式 |
| `sysDarkModeFollow` / `sysDarkNever` / `sysDarkModeTip` | false / true / true | | 跟随系统深色模式（Android 10+）及相关提示 | 选项→应用 |
| `languageID2` | 0 | 0=系统，其它为语言序号 | 界面语言 | 选项→应用→界面语言 |
| `needPasswordProtect` / `fingerPrint` / `loginPassword` | false / false / "" | | 启动密码/指纹/混淆后的密码 | 选项→应用（Pro） |
| `openBookAnim` | false | Pro 且 Android≥5 才生效 | 打开书动画 | 选项→应用 |
| `lastFile` / `lastPosition` / `lastChapter` / `lastSplitIndex` | "" / 0 / 0 / 0 | | 最后阅读的书及位置（继续阅读用；位置语义属阅读器） | — |
| **书架外观** | | | | |
| `woody` | **true** | | 木纹书架背景 | 选项→我的书架 |
| `woodyResDay` / `woodyResNight` | 0 / 0 | 0..5（5=自定义图片） | 木纹资源 | 木纹选择面板 |
| `coverWithProgress` | false | | 封面上显示进度圆环 | 选项→我的书架 |
| `shelfStyle` | 1 | 0 列表/1 网格/2 封面流 | 书架视图 | 书架过滤对话框 |
| `shelfFontSize5` | 手机16/平板17 | ≥10 | 书架字号 | 选项→封面(大小)（Pro） |
| `shelfBoldFont` | false | | 书名加粗 | 同上 |
| `shelfCoverSize6` | 110（小屏 100） | ≥30 | 书架封面尺寸(dp) | 同上 |
| `recentCoverSize2` / `fileCoverSize5` / `netCoverSize5` | 90 / 48 / 48 | ≥30 | 最近阅读/文件页/网上书库封面尺寸 | 同上 |
| `cover_quality` | 0（Android<5 为 1） | 0 正常/1 低 | 封面生成质量 | — |
| `coverImage` (`defaultCover`) | `cover104` | cover100..105 或外部路径 | 缺省封面 | 书架菜单→设置缺省封面 |
| `defaultCoverTip` | 0 | 0..10 | 更改缺省封面提示次数 | — |
| `outerImagesFolder` | — | 路径 | 选封面时的外部图片目录 | — |
| `cover_search_engine` | -1 | -1 自动/0 Google/1 Bing/2 Yahoo/3 搜狗 | 下载封面所用搜索引擎 | 下载封面对话框 |
| **书架数据视图** | | | | |
| `shelf_category2` | 0 | 0..5 | 书架分类 | 分类条下拉 |
| `shelf_sub_collection` | "" | 编码串（见 4.2） | 当前分组值 | — |
| `shelf_sub_author` | "" | | 系列视图所属作者 | — |
| `shelf_sort_by2` | 0 | 0 书名/1 作者/2 导入时间/3 目录/4 最近阅读 | 排序 | 书架过滤对话框 |
| `shelf_last_item` | -1 | | 书架/封面流最后位置 | — |
| `filterUnread` / `filterReading` / `filterFinished` | true ×3 | | 阅读状态过滤 | 书架过滤对话框 |
| `filterAll` | true | | 文件类型过滤：全部 | 同上 |
| `filterEpub` | true | | 类型过滤 EPUB | 同上 |
| `filterPdf` `filterMobi` `filterFb2` `filterChm`(CHM/UMD) `filterUmd`(DOCX/ODT/RTF) `filterTxt` `filterHtml` `filterCbz` | false ×8 | | 其它类型过滤 | 同上 |
| `recent_fav_name` | "" (→`default_fav`) | | 首页「我的珍藏」行显示的收藏夹 | 首页该行图标 |
| **文件页 / 导入** | | | | |
| `files_sort_by` | 0 | 0..5 | 文件页排序 | 文件页菜单→排序 |
| `fileUseGrid` / `libraryUseGrid` | false / false | | 文件页 / 网上书库用格子布局 | 对应页菜单→使用格子布局 |
| `showHiddenFiles` | false | | 文件页显示隐藏目录 | 选项→我的文件 |
| `showFileDetail` | true（强制） | | 文件页显示详情 | — |
| `lastPath` / `lastPathItem` | SD 根 / -1 | | 文件页最后目录与位置 | — |
| `default_book_folder` | `/sdcard/Books` | | 主目录（其下 `MoonReader/` 下载、`.MoonReader/` 缓存） | 选项→主目录 |
| `scanPath` | = 主目录 | | 导入扫描路径 | 导入对话框 |
| `scanFav` | "" | | 导入时加入的收藏夹名（`default_fav`=默认） | 导入对话框 |
| `importEpub/Fb2/Chm/Mobi/Cbz/Umd(DOCX..)/Txt/Pdf/Html` | true ×9 | | 导入时的文件类型 | 导入对话框 |
| `importFileSize` | 20 | KB，≤0 不限 | 导入忽略小于此大小的文件 | 导入对话框 |
| `fileImportWithFav` | true | | 文件页「导入(加入珍藏)」默认勾选 | 该对话框 |
| `auto_import` / `auto_import_time` | false / 0 | | 自动导入开关 / 上次扫描时间 | 选项→我的书架 |
| `failedScanBook` | "" | | 导入崩溃保护：正在处理的文件 | — |
| `showWebDavInLocalFiles` / `showDropboxInLocalFiles` / `showGdriveInLocalFiles` | true ×3 | | 文件页/首页集成云盘入口 | 选项→我的文件 / 文件夹快速访问对话框 |
| `lastWebDavPath` / `lastDropboxPath` / `lastGdrivePath` | "/" ×3 | | 云盘文件页最后目录 | — |
| **云同步** | | | | |
| `syncType` | 0 | 0 关/2 Dropbox/4 GDrive/6 WebDAV | 当前同步云 | 其它选项→同步复选框 |
| `showSyncMsg` | true | | 显示同步信息 | 各云设置对话框 |
| `syncManually` | false | | 仅手动同步 | 同上 |
| `syncReadingBook` | false | | 自动备份书籍文件到云 | 同上 |
| `syncBookInWiFiOnly` | false | | 仅 Wi-Fi 上传书籍 | 同上 |
| `syncRecentList` | false | | 同步最近阅读(`recent.list`) | 同上 |
| `webDavBookPath` / `dropboxBookPath` / `gdriveBookPath` | `/Apps/Books` ×3 | | 云端书籍根路径（`.Moon+/` 放在其下） | 同上「路径」 |
| `deviceRandomID2` | 首次运行毫秒时间戳 | | 设备标识（`.po` 区分来源；恢复备份时重置） | — |
| prefs `webdav`: `url`(默认 `https://`) `user` `pass` `ok` | | | WebDAV 账号 | WebDAV 设置对话框 |
| prefs `dropbox`: `access-token` `user-id`；`gdrive` | | | 账号令牌 | — |
| `syncReadWise` | false | | 自动分享新高亮/笔记到 Readwise | 标注列表→Readwise |
| `readWiseToken` / `readWiseUrl` | "" / `https://readwise.io/api/v2/highlights/` | | Readwise 令牌与接口 | Readwise 对话框 |
| `shareWithChapter` | true | | 分享/Readwise 附带章节名 | 标注分享（阅读器） |
| **统计** | | | | |
| `statistics_pages` / `_words` / `_time` | 0 | 累计 | 页数/字数/毫秒 | — |
| `statistics_days` | 1 | ≥1 | 阅读天数 | — |
| `statistics_last_day` | 0 | 自 epoch 天数 | 最后记录日 | — |
| `lastStatisticsPage` | 0（每次启动重置） | 0 | 旧版统计页索引，7.3 恒 0 | — |
| **网上书库 / 备份** | | | | |
| `last_catalog_url` | `http://` | | 上次添加书库的 URL | 增加新书库对话框 |
| `backup_folder` | `{主目录}/MoonReader/Backup` | | 本地备份目录 | 备份对话框「目录」 |
| `lastSearchKey` | — | | 最近搜索词 | — |

其它独立 prefs：`positions10`（阅读进度，4.2）、`state_filter`（手动阅读状态）、`import_failed_list`（导入失败文件→时间）、`network2_*`（每个 OPDS 站点一个）、`delete_catalogs`（被用户删除的内置站点→时间）、`file_encoding`（文本编码，属阅读器）、`widget`（小部件）、`webdav_cache/dropbox_cache/gdrive_cache`（云缓存映射）。

---

## 4. 数据结构与文件格式

### 4.1 SQLite 数据库 `mrbooks.db`（版本 7，`BD:28-62`）

```sql
create table books (
  _id integer primary key autoincrement,
  book text,          -- 书名；手动排序时形如 "前缀#@#真书名"
  filename text,      -- 完整路径（含 "a.zip?/内部名"）
  lowerFilename text, -- filename 小写；所有查询/更新的键
  author text,        -- 多作者以换行分隔；非 PDF/EPUB 为 "(TXT)" 等占位
  description text,   -- ≤2000 字，超出截断加 "..."
  category text,      -- 标签+系列多行文本，见 4.2
  thumbFile text,     -- 缩略图路径(_1.png)，可空
  coverFile text,     -- 封面路径(_2.png)，可空
  addTime text,       -- 毫秒时间戳（文本！）
  favorite text,      -- ''=无；'default_fav'；其它=收藏夹名
  downloadUrl text,   -- 'UNKNOW'=位于下载目录；否则 ''
  rate text, bak1 text, bak2 text  -- 未使用
);
create table notes (
  _id integer primary key autoincrement,
  book text,            -- 书文件名(含扩展名)
  filename text,        -- 完整路径
  lowerFilename text,
  lastChapter NUMERIC,  -- 章号
  lastSplitIndex NUMERIC, -- 章内分段号（大章节被切分时）
  lastPosition NUMERIC, -- 字符偏移（PDF=页相关）
  highlightLength NUMERIC, -- 高亮字符数；书签行则为书签颜色
  highlightColor NUMERIC,  -- ARGB 整数
  time NUMERIC,         -- 毫秒时间戳
  bookmark text,        -- 非空=书签；内容为书签名
  note text,            -- 笔记文本
  original text,        -- 被标注原文
  underline NUMERIC, strikethrough NUMERIC, -- 0/1
  bak text              -- '1'=波浪线(squiggly)，同步删除墓碑用 '*DELETED*'
);
create table statistics (
  _id integer primary key autoincrement,
  filename text,        -- 完整路径（区分大小写，与 books 不同）
  usedTime NUMERIC,     -- 毫秒
  readWords NUMERIC,
  dates text            -- 逐日明细，见 4.2
);
create table tmpbooks (...同 books 全部字段...);   -- 未入库但被打开过的书
create table covers2 (
  _id integer primary key autoincrement,
  filename text,        -- 书文件名(无目录)小写
  cover text            -- 内置封面名(cover100..105)或外部图片路径
);
```
- 升级：`onUpgrade` 只会补建缺失的表（v<2 建 notes，v<4 statistics，v<6 covers2，v<7 tmpbooks）。无索引、无外键、无唯一约束；`insertBook` 用「先 UPDATE WHERE lowerFilename=? 失败再 INSERT」实现 upsert。
- 书的唯一键 = **文件完整路径（小写）**；notes/statistics 都用路径关联书。Web 需要稳定 `bookId`，导入原库时把路径映射成新 id。

### 4.2 文本编码约定（几乎所有「列表/复合值」都是换行分隔文本）

| 名称 | 格式 |
|---|---|
| 列表文本 | `T.stringList2Text`：每项后加 `\n`；`T.text2StringList`：去 `\r`，按 `\n` 切，末尾无换行的尾段也算一项 |
| `category`（标签+系列） | `[<系列名>\n#序号#\n]标签1\n标签2\n…`；系列行以 `<` 开头，序号行形如 `#1.5#`（浮点，`getSeriesIndex` 用正则 `\n#.*?#\n`）；展示用 `createSerialText` =「系列名 [序号]」（`.0` 去掉）；以 `#` 开头或空或 >100 字的行不算标签 |
| `favorite` | 单个字符串；`default_fav` 显示为「(默认分类)」 |
| 书名排序前缀 | `前缀#@#真标题`（可嵌套多个 `#@#`，取最后一个之后为真标题，`removeSortTag`） |
| 分组编码（`shelf_sub_collection`） | `字段名\n##值\n**1` 或 `**0`（最后 `1`=该字段是多值字段如 category），`encodeCollection/decodeCollection` `BD:623/507` |
| 位置串（`positions10` 值、`.po` 内容） | `[章][@分段]#位置[:百分比]`；例 `3@0#12345:45.67%`、`3#12345`、PDF/CBZ `12:45.6%`；解析：`#` 前取章（若含 `@` 则 `@` 前为章、`@`~`#` 为分段）、`#`~`:` 为位置；无 `#` 则 `:` 前整体为位置（`A:5677-5731`）；百分比 TXT 两位小数 `0.00%`（满 `100%`），其它一位 `0.0%` |
| 位置辅助键 | `键+"2"`=`lastWebY` int（HTML 书滚动）；`键+"pdf"`=`缩放#x:y@锁定*页` |
| `statistics.dates` | 每行 `dayNumber\|毫秒@字数`；旧版 `dayNumber` 单列 |
| 阅读过滤手动值 | prefs `state_filter`：路径→1(未读)/2(在读)/3(已读) |

### 4.3 非数据库持久化清单（Android 下均在 `shared_prefs/`）

| 名称 | 类型 | 内容 |
|---|---|---|
| `options1002` | prefs XML | 全部设置（第 3 节） |
| `positions10` | prefs XML | 阅读进度（4.2） |
| `history.txt` | 文本 | 最近阅读，一行一路径，最新在前 |
| `favfolders6` | 文本 | 文件夹快速访问 |
| `shelf_top_books` | 文本 | 置顶书路径，最新置顶在前 |
| `lib_top_items` | 文本 | 置顶书库（`network2_*` 名） |
| `auto_import_folders` | 文本 | 自动导入目录 |
| `dash_search shelf_search files_search net_search annot_search` | 文本 | 各标签搜索历史 |
| `reader_bar_icons` `select_bar` `tts_filter` `theme_*.xml` | — | 阅读器工具栏/选字栏/朗读过滤/主题（阅读器模块） |
| `network2_<站点>.xml` | prefs XML | 一个 OPDS 站点 |
| 封面缓存 | 文件 | `{主目录}/.MoonReader/{书文件名}_1.png`（缩略）`_2.png`（原图）`_3.png`（编辑封面）`{书文件名}.png`（网络封面）；云缓存 `…/.MoonReader/cloud/` |

### 4.4 云同步文件格式

**目录**（以书籍根路径 `R`，默认 `/Apps/Books`）
```
R/.Moon+/Cache/{书文件名}.po        阅读进度（单行文本）
R/.Moon+/Cache/{书文件名}.an        标注（zlib 压缩文本）
R/.Moon+/Cache/recent.list          最近阅读（单行文本）
R/.Moon+/Backup/{名称}.mrpro|.mrstd 整库备份 zip
R/{书文件名}                        书籍文件本身（开启「备份书籍文件」时）
```
WebDAV 路径相对于用户填的 WebDAV URL；Google Drive 用同名文件夹层级模拟。

**`.po`**（UTF-8，无换行）
```
1698000000000*3@0#12345:45.67%|1200
└deviceId     └位置串            └webY(可省)
```

**`.an`**：`zlib.deflate(UTF-8 文本)`；文本结构（`exportNotesToText`，`BD:654-700`）：
```
{书文件字节数}\n
indent:{true|false}\n          # 首行缩进设置（A.indentParagraph）
trim:{true|false}\n            # 裁剪空白设置（A.trimBlankSpace）
#\n                            # 每条标注：一个 "#" 行 + 16 个字段行（notes 表全部列，顺序如下）
{_id}\n{book}\n{filename}\n{lowerFilename}\n{lastChapter}\n{lastSplitIndex}\n{lastPosition}\n
{highlightLength}\n{highlightColor}\n{time}\n{bookmark}\n{note}\n{original}\n{underline}\n{strikethrough}\n{bak}\n
#\n ...
```
- 字段内的换行替换为 `<BR>`（导入时还原）。导入时第 `i` 行为 `#` 且后面至少还有 15 行才算一条，字段偏移 +5=章 +6=分段 +7=偏移 +8=长度 +9=颜色 +10=时间 +11=书签 +12=笔记 +13=原文 +14=下划线 +15=删除线 +16=bak（`_id/book/filename/lowerFilename` 被忽略，导入时用本机书的值）。
- **删除墓碑**：导出末尾追加（`deletedNotesToText`）：`#\n0\n0\n0\n0\n{章}\n{分段}\n{偏移}\n0\n0\n{time}\n{bookmark}\n{note}\n0\n0\n0\n*DELETED*\n`，即第 16 字段为 `*DELETED*`。
- **合并伪代码**（`importNotesFromText`）：
```
if abs(len(localBookFile) - header.size) > 100000: reject
for each note n in remote:
    local = find(lowerFilename, n.chapter, n.split, n.position, [bookmark<>'' if n是书签])
    if local exists:
        if n.deleted or differs(n, local): delete local; if n.deleted: changed = true
        else: continue
    if not n.deleted and not (in-memory duplicate): insert n(time=n.time); changed = true
```

**`recent.list`**（单行）
```
{云端书路径}??1{书名}??2{毫秒时间}??3{文件字节数}??4{本机文件路径}??5{deviceId}*{位置串}
```
解析按固定标记 `??1…??5` 与其后第一个 `*`；进度取末个 `:` 之后到倒数第二字符（去掉 `%`）的浮点。

### 4.5 备份文件格式（`.mrpro` / `.mrstd`）

```
{名称}.mrpro  (zip)
└── {应用数据目录名}/
    ├── {1..n}.tag      # 真实内容文件（数据库、prefs XML、文本、封面、书籍）
    └── _names.list     # 第 i 行对应 {i}.tag 的原路径：
                        #   应用数据内文件 → 相对路径（如 databases/mrbooks.db、shared_prefs/options1002.xml）
                        #   ?<绝对路径>    → 位于内部存储的封面/书籍
                        #   *<绝对路径>    → 位于外置 SD 的封面/书籍（还原到 {下载目录}/{文件名}）
```
- 恢复时如 `_names.list` 缺失则按条目原名还原。含 `options1002.xml` 的敏感/设备相关键见 BAK-002 的修补列表。

### 4.6 OPDS 处理要点（`opds/OpdsEntries.java`、`OpdsEntry.java`、`N.java`）

- **请求**：UA 默认 `OPDS/Stanza iPhone/Aldiko/Moon+ Reader(Android)`（站点可覆盖）；信任所有证书；10s 连接超时；响应文本中若 `<?xml ` 之前有垃圾字符会被截掉再解析（`resetInputStream`）。
- **feed 级**：`<feed xml:base>`（以 `http` 开头才采用）→ `baseUrl`；否则用 `<link rel="self" href>`（需 `isValidateUrl`：http(s)、域名含 `.` 且长度>3；屏蔽个别站点）；`<link rel="search">` 含 `{searchTerms}` → 站点 `searchUrl`（除非 `lock_search_url`），否则作为 OpenSearch 描述文档异步抓取；`<link rel="next" href>` → `nextUrl`；`<title>`/`<subtitle>` → 站点名/简介；`opensearch:totalResults`、`opensearch:itemsPerPage` → 分页。
- **entry 级**：`title`（可跨多个文本块拼接并 trim）、`id`、`updated`、`author/name`、`content`（`type="text"` 则 `\n→<br>`；HTML 内容保留标签与 `<a href>`；`content` 太短(<10)且有 `summary` 时用 summary）、`<link>`：
  - 下载：`type` 以 `application` 开头且匹配 epub/pdf/mobi 系(`.mobi .azw .azw3 .prc`)/txt/fb2/cbz/cbr/djvu/azw3 → `BookUrl{type, href, isZip, file_size}`（`getExt()` 对 zip 返回 `.zip`）；
  - 封面/缩略图：`rel` ∈ `http://opds-spec.org/{cover|thumbnail|image/thumbnail|opds-cover-image-thumbnail…}`，`data:image…` 前缀 22 字符之后为 base64；
  - 子目录/导航：`rel` 为空、`subsection` 或 `http://opds-spec.org/sort/*` → `linkType/linkHref`；
  - `rel=related` → `relatedList`。
  - 相对链接用 `T.mergeHref(base, href)` 合成；`linkHref` 经 `T.UrlEncode`。
  - 默认下载格式 = epub，否则第一个。
- **条目→UI 类型**：有下载链接=书；`linkType` 含 `atom`=目录；否则网页。图标按首选格式选（epub/mobi/azw3/fb2/cbr/cbz/pdf/txt/djvu/unknown）。
- **站点 XML**（`assets:network/*.xml`，Android `<map>` 格式）：`<string name="site|title|title_cn|summary|summary_cn|main|baseUrl|search|signIn|signOut|image|useragent|username|password">`、`<boolean name="html|cn_only|lock_search_url">`、`<int name="version">`。升级规则：assets 版本 > 本地版本 且用户没删过才覆盖；assets `version=-1` 则删除本地同名文件。

### 4.7 Readwise 请求格式

```http
POST https://readwise.io/api/v2/highlights/
Authorization: Token <token>
Content-Type: application/json;charset=UTF-8
{"highlights":[{"title":"书名","text":"原文","author":"作者","note":"笔记(可选)","chapter":"章名(可选)"}]}
```

### 4.8 建议的 IndexedDB 数据模型（Web）

| store | 主键 | 字段（✱=索引） | 说明 |
|---|---|---|---|
| `books` | `id`（内容 SHA-256 前 16 字节 hex） | `filename`✱ `lowerFilename`✱ `title` `author` `description` `tags[]`✱ `series{name,index}` `favorite`✱ `format` `size` `addedAt`✱ `pinnedAt?` `manualOrder?` `onShelf` `downloadUrl?` `source?` `coverKinds[]` | 对应 SQL `books`+`tmpbooks`（`onShelf` 区分）；`lowerFilename` 用于与原库/云同步按文件名互通 |
| `files` | `bookId` | `blob` `mime` | 书籍原文件（或改存 OPFS，这里只存引用） |
| `covers` | `[bookId, kind]` | `blob` `w` `h` | kind=`thumb` / `cover` / `edit` / `net` / `preset`（`preset` 存内置封面名） |
| `positions` | `bookId` | `chapter` `splitIndex` `position` `percent` `webY?` `pdf?` `updatedAt` `deviceId` | 对应 `positions10` |
| `notes` | `id`（uuid） | `bookId`✱ `chapter` `splitIndex` `position` `highlightLength` `highlightColor` `time` `bookmark` `note` `original` `underline` `strikethrough` `squiggly` `updatedAt` `deletedAt?` | 对应 `notes`；`[bookId,chapter,splitIndex,position]` 做唯一 |
| `stats` | `bookId` | `usedTime` `readWords` `days{[dayNumber]:{ms,words}}` | 对应 `statistics` |
| `history` | 单记录 | `items:[{bookId,lastOpenedAt}]` | 对应 `history.txt` |
| `readStates` | `bookId` | `state: 1 / 2 / 3` | 对应 `state_filter` |
| `catalogs` | `id` | OPDS 站点字段（4.6） | 对应 `network2_*`；`deletedBuiltin[]` |
| `settings` | `key` | `value` | 对应 `options1002` + 全局统计计数器 |
| `syncAccounts` | `provider` | `tokens`（加密） `basePath` `options` | |
| `syncState` | `[provider,bookId]` | `lastRemoteDeviceId` `lastUploadedHash` `lastSyncAt` | 避免重复上传（原 5 分钟去重逻辑） |
| `linkedDirs`（可选） | `id` | `handle`(FileSystemDirectoryHandle) `name` | 「已链接目录」 |

- 导入原库映射：`books.filename`→`filename/lowerFilename`；`books.category`→`tags+series`（4.2 规则）；`books.book` 去 `#@#` 前缀并把前缀序转为 `manualOrder`；`notes.*` 一一对应（`bak='1'`→`squiggly`）；`statistics.dates` 逐行解析；`positions10` 按路径小写对应书。
- 稳定 id：同一内容不同文件名也视为同书（提示用户）；`filename` 仍保留用于 `.po/.an` 互通（注意冲突：同名不同书，可在 `.po` 旁附加哈希字段由 Web 端校验）。

---

## 5. 界面结构（菜单 / 对话框层级）

```
主界面（顶栏 + 分类条 + 5 标签 + FAB「继续阅读」）
├─ 抽屉
│   ├─ 最近阅读 / 我的书架(▸ 收藏夹子列表) / 我的文件 / 网上书库 / 书签
│   ├─ 继续阅读（长按 → 最近 100 本快速切换）
│   ├─ 设置选项 → 〔选项〕对话框（LIB-031）
│   ├─ 软件说明 → 〔关于〕
│   ├─ 晚上模式/白天模式
│   └─ 退出
├─ 首页 Dash（工具栏 ⋮：继续阅读 / 软件说明；列表态：使用最近阅读作为开始页 ✔ / 全选；搜索图标仅列表态）
│   ├─ 最近阅读 ──更多→ 最近阅读列表 ─长按→ 多选（书籍信息 / 导入(加入珍藏) / 删除[从最近阅读移除，☐删除文件]）
│   ├─ 我的珍藏 ──图标→ 〔我的珍藏〕单选收藏夹；更多→书架
│   ├─ 我的文件 ──图标→ 〔文件夹快速访问列表〕(☑Dropbox ☑Gdrive ☑WebDav + 目录勾选)
│   ├─ 网上书库 ──→ 站点
│   ├─ 书签 ──→ 单书标注页
│   └─ 阅读统计（8 卡片；图标→「清空全部阅读统计」）
├─ 我的书架
│   ├─ 分类条（点击）→ 全部书籍 / 我的珍藏 / 书籍系列 / 书籍作者 / 书籍标签 / 存储目录 / ── / 各收藏夹
│   ├─ 工具栏：🔍搜索  ⛃漏斗→〔书架过滤对话框〕
│   │      ├─ 视图：列表 | 格子 | 封面流；排序：书名/作者/导入时间/存储目录/最近阅读
│   │      ├─ 阅读过滤：☑未读 ☑正在阅读 ☑已读
│   │      ├─ 书架类型 / 文件类型：☑全部 ☐EPUB ☐PDF/DJVU ☐MOBI/AZW3/PRC ☐FB2 ☐CHM/UMD ☐DOCX/ODT/RTF ☐TXT ☐HTML/MD ☐CBZ/CBR
│   │      └─ 设置图标→〔选项〕
│   ├─ ⋮：导入书籍 / 设置缺省封面 / 重新创建书籍封面 / 打开一本随机书籍 / 全选
│   ├─ 书条目 ⋮：书籍信息 / 加入我的珍藏 / 发送文件 / (桌面快捷方式) / 下载书籍封面 / ── / 置顶|取消置顶 / 从我的书架里移除(|从我的珍藏里移除)
│   ├─ 长按 → 多选：[编辑书籍信息|加入珍藏] [加入珍藏|标签] [删除] ⋮(阅读过滤→自动/未读/正在阅读/已读；全选)
│   └─ 分组列表（珍藏分组行含「改名」）
├─ 我的文件（P2/不做）：路径条 | 新建目录 / 使用格子布局 / 排序▸ / 全选 | 多选：拷贝(|下载)/移动/改名/书籍信息/导入/删除 | 粘贴条
├─ 网上书库
│   ├─ 站点列表 ⋮：增加新书库(Calibre IP) / 使用格子布局；条目菜单：打开 编辑 删除 置顶
│   ├─ 工具栏：主页 ◀ ▶ 页码 ★ ↗；搜索框
│   ├─ 条目列表（书 / 目录 / 网页） → 〔书籍详情〕下载 / 阅读
│   └─ 对话框：增加新书库 / Calibre IP / 编辑书库 / 登录 / 删除确认
├─ 书签（标注汇总）
│   ├─ 徽章：书签(n) 标注(n) 高亮(n)；「颜色」过滤；搜索
│   └─ 单书标注列表：多选→删除；分享/导出
└─ 对话框
    ├─ 〔导入书籍〕路径 / 文件类型 / 文件大小> / 更多(加入珍藏) → 〔选择列表〕(按时间|位置|文件名) → 〔新书列表〕
    ├─ 〔书籍信息〕封面/书名/作者/封面文字/简介/珍藏/系列/标签/阅读过滤/文件路径/统计
    ├─ 〔加入珍藏〕〔标签〕〔重新创建书籍封面〕〔封面(大小)〕
    ├─ 〔备份到:〕〔恢复自:〕〔恢复 "xxx"?〕
    ├─ 云：〔Dropbox/Google Drive 设置〕〔WebDAV 设置〕〔同步确认〕〔Readwise〕
    └─ 〔关于〕
```

阅读器侧与同步/统计相关的入口（交叉引用）：底栏第 18/19 号按钮（同步到云端/从云端同步）、「其它选项」里的同步复选框与 `openLastFile`、标注列表里的 Readwise 与导入导出。

---

## 6. 存疑与未确认点

1. **PDF 标注同步格式**：PDF 书的 `.an` 内容由 PDF 引擎 `PDFcreateTextFromNotes / PDFcreateNotesFromCloud` 生成/解析（`BD.exportNotesToText:654`、`BD.importNotesFromText:1349` 对 `.pdf` 走分支），格式未读，归「PDF/标注」调研员。
2. **`isPro()` 判定与 Pro 限制范围**：书架封面尺寸/字体、启动密码、打开书动画、桌面快捷方式标注为 Pro；本包是 Pro 包，但 `A.isPro()` 实现未读，是否恒为真未确认。统计功能在 `assets:readme` 里被列为 Pro 增强，但源码里首页统计卡片未见 Pro 判断。
3. **Dropbox 权限类型**：原 App 路径形如 `/Apps/Books/.Moon+/…`，暗示「完整 Dropbox」权限；若是「应用文件夹」权限则实际路径会再嵌套一层。未能从源码确认。
4. **内置书库当前可用性**为 2026-10-21 在调研机上实测（Gutenberg 的 www 域名可用且带 CORS；Feedbooks 返回 403，可能因 UA/IP 反爬；MobileRead wiki 超时）；上线前必须复测，并考虑把 `m.gutenberg.org` 改为 `www.gutenberg.org`。
5. **`positions10` 之外的进度来源**：CBZ/CBR 进度（`PicGalleryShow:1371`，值形如 `当前图片文件:百分比`）、PDF 附加键 `…pdf`、HTML `…2` 的完整语义属于阅读器/PDF 模块，这里只保证原样存取与同步。
6. **`getNotesHighlights` 的合并规则**（偏移阈值 10/25/50）只读了主干，未逐分支验证所有边界。
7. **`A.restoreProc_over2` 的后续清理**（强制重启标志、`deleteUnusedShare_PrefFiles` 的完整范围）只读到前半，未覆盖全部修补的键。
8. **GDrive `.an` 上传的第三个参数**（`new String(MyZip_Java.compress(...))`）用途未确认（可能是内容缓存比较用字符串），实际上传流为 `T.Byte2InputStream(压缩字节)`。
9. **`recent.list` 的位置串末尾 `|webY`** 在 `CloudRecentItem` 解析进度（`lastIndexOf(":")` 取到末尾前一字符）时可能把 `|数字` 当作百分比的一部分，原代码对此是否有容错未确认（只影响 Toast 里的显示）。
10. **文件页中「复制到云/云间互拷」**等细节（`cannot_copy_between_clouds`、`updateFilesCloudIndicator`）只读到入口，未全读 `DropboxTask/GdriveTask` 内部分支；对 Web 版属 P2，不影响主线。
11. **启动流程中的授权/许可/广告**（`doLicenseAndNewVersionCheck`、`MyLicensingServiceCallback`、Android 11 存储授权对话框）均为 Android/商业逻辑，未细读，视为不做。
12. **阅读器底栏 20 个按钮与选字栏自定义**（`components/DragSort/ReaderBar|SelectBar`，拖拽排序 + 勾选的通用列表 `DragSortListAdapter`）属阅读器 UI，只在 SYNC-006 引用了第 18/19 号「同步」按钮，其余留给阅读器调研员（按钮序号 0–19：屏幕方向、日夜、朗读、自动滚屏、章节、书签、亮度、字号、搜索、倾斜翻页、可视选项、控制选项、其它选项、配色方案、选项、关闭、双页、自定义底栏、同步到云端、从云端同步）。
