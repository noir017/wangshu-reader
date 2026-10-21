# 架构与模块接口

## 总体
```
浏览器（React 单页，hash 路由；可构建成单文件 html）
  App.tsx ── #/read/<bookId> → reader/ui ReaderPage
          └─ 其他路由        → library LibraryApp（书架、网络书库、统计、设置、关于…）

  阅读页内部：
    ReaderPage（reader/ui）
      ├─ formats.openBook(file) → Book（core/book.ts）
      ├─ engine.createReader(book) → ReaderController（core/reader.ts），挂到正文容器
      ├─ 顶栏/底栏/状态栏/设置面板/亮度/动作分发（reader/ui）
      └─ <ReaderSessionContext.Provider value={session}>
            <ReaderFeatures />（features：选择菜单、标注、目录面板、搜索、朗读、词典、脚注、看图）
         </ReaderSessionContext.Provider>
  数据：storage/db.ts（IndexedDB）  设置：core/settings.ts（localStorage）

服务端（Node + Hono，server/）：/api/*（代理、转换、朗读、词典翻译、书库、字体）、/dav（WebDAV）、/transfer（网页传书）、托管 dist
```

## 公共契约（src/core、shared，只有总控能改）
| 文件 | 内容 |
|---|---|
| `core/book.ts` | 统一书籍模型：`ReflowableBook`（章节 → 清洗后的 body HTML + 书内 CSS）/`FixedBook`（PDF、漫画按页渲染）、`Locator`、`TextRange`、`TocEntry`、`FormatParser` |
| `core/text.ts` | **偏移基准**：章节纯文本 = body 下文本节点按文档顺序拼接（跳过 script/style）。`Locator.offset`、`TextRange`、标注、搜索、朗读全部基于它。显示性改动（简繁、断字软连字符）必须保持文本节点长度不变 |
| `core/reader.ts` | `ReaderController`（引擎接口）、事件、装饰（高亮/搜索/朗读高亮共用 `setDecorations(layer, …)`） |
| `core/reader-session.ts` | 阅读会话 `ReaderSession` + 命令总线 `ReaderCommands`（reader/ui 发出、features 执行） |
| `core/library.ts` | IndexedDB 记录：`BookRecord`、`PositionRecord`、`AnnotationRecord`、`ReadingStatRecord`、`FontRecord` |
| `core/settings.ts` | `defineSettings(ns, defaults)`：各模块注册自己的设置命名空间，统一持久化/备份 |
| `core/i18n.ts` | `defineMessages({ zh, en })` |
| `core/server.ts` | 调服务端的唯一入口；`hasServer()`/`checkServer()` 决定是否置灰 |
| `core/router.ts` | hash 路由 `useRoute`/`navigate` |
| `reader/settings.ts` | **阅读设置契约**（排版、CSS、翻页、操控、屏幕、主题、状态栏、自动滚屏、固定版式），字段名/默认值照原 app 的 A.java；引擎订阅应用，UI 读写 |
| `shared/api.ts` | 服务端 HTTP 接口：路径、请求/响应类型 |
| `storage/db.ts` | IndexedDB 读写函数（总控写的初版，之后归 library 模块维护；改表结构必须升 `DB_VERSION`） |
| `ui/` | 通用组件：`Sheet`、`Row`、`Switch`、`Slider`、`Select`、`Segmented`、`ColorPicker`、`PrefSwitch/PrefSlider/PrefSelect/PrefColor`（直接绑设置）、`toast`、`confirmDialog`、`promptDialog`、`chooseDialog`、`popupMenu`、`openOverlay` |

## 模块入口（各模块必须保持这些导出签名）
| 文件 | 导出 |
|---|---|
| `formats/index.ts` | `openBook(file, opts)`、`probeBook(file, opts)`、`detectFormat(name, head?)`、`supportedExtensions()` |
| `reader/engine/index.ts` | `createReader(book): ReaderController` |
| `reader/ui/index.tsx` | `ReaderPage({ bookId })` |
| `features/index.tsx` | `ReaderFeatures()`（在会话上下文内渲染） |
| `library/index.tsx` | `LibraryApp({ route })`、`openBookInfo(bookId)`、`getAdjacentBook(bookId, dir)` |

## 职责边界（容易混的地方）
- **点击/按键 → 动作**：引擎只上报 `tap{x,y}`、`longPress`、`swipe`、`key` 等原始事件；reader/ui 按 `controlSettings` 判定点击区（spec 02 §4.5）并执行 `ReaderAction`。属于 features 的动作（搜索 4、书签 5、目录 11、选择 17、朗读 19）经 `session.bus` 发命令。
- **翻页动画、手指跟随拖拽、自动滚屏的滚动本身**：引擎。自动滚屏/速读的控制面板与速读（RSVP）界面：reader/ui。
- **简繁转换、首行缩进、去空行、断字**：引擎渲染时应用（读 `textSettings`），必须保持偏移不变。**TXT 编码检测、分章、段落切分**：formats。
- **标注的存储与渲染**：features 读写 `storage` 的 annotations，并调用 `controller.setDecorations('annotations', …)`；引擎只负责把装饰画出来。
- **脚注/图片/链接**：引擎派发 `link`（带 `footnoteHtml`）、`image` 事件；features 负责弹窗与看图器。
- **主题**：14 套内置主题的数据与主题管理界面在 reader/ui；背景纹理不用 apk 里的图片，用程序生成（SVG 噪点 + 暗角，按原图均色），用户可上传自己的背景图（存 kv）。
- **PDF/漫画**：渲染、缩放、平移、翻页在引擎（`FixedBook`）；PDF 选项面板在 reader/ui；PDF 文字选择/高亮复用 features（基于 `getPageText`）。
- **书籍信息、上一本/下一本**：library 提供 `openBookInfo`、`getAdjacentBook`。
- **云同步/备份**：library。协议只说 WebDAV：用户自己的 WebDAV 走 `/api/proxy`，没有就用服务端内置 `/dav`。Dropbox/Google Drive 只预留（需要用户自己的 OAuth 应用）。

## 关键决定
- 位置模型：`{section, offset}`（章内纯文本偏移），对应原 app 的 `lastChapter + lastPosition`；TXT 由 formats 切成章节后同样适用。标注额外存 `prefix/text/suffix` 以便偏移失效时重定位。
- 书的 id = 文件内容指纹（`storage/fingerprint.ts`，不依赖 crypto.subtle，http 局域网下也能用）。
- 浏览器做不到的走服务端，服务端不可用时功能置灰并提示，不能崩。
- 不复制 apk 里的图片和字体文件（版权）；颜色、参数、算法照搬。
