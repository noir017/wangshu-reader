# 验收表：阅读界面（02-reader-view）+ 内容（03-content）

阶段 4 整站验收，2026-10-22，基于最终工作区代码。状态：✅ 完成 / 🟡 部分 / ❌ 未做 / ⛔ 不做（用户已定或规格标 [不做]）。
路径缩写：`E/` = src/reader/engine/，`U/` = src/reader/ui/，`F/` = src/features/，`FM/` = src/formats/，`T/` = tests/e2e/。测试名写在「」里；`u:` = 源码旁单测。

**统计（178 条）**：02 阅读界面 86 条：✅ 64 · 🟡 21 · ❌ 1 · ⛔ 0；03 内容 92 条：✅ 71 · 🟡 17 · ❌ 4 · ⛔ 0。合计 ✅ 135 · 🟡 38 · ❌ 5。
**P0/P1 仍为 🟡 的**（缺的都是次要细节，主体功能已通，详见各行备注）：P0 — VIEW-012、TYPO-001/002/004/015/016/017、ANIM-003、CTRL-002、STATUS-001、FMT-002/004/008、TOC-002、ANNO-001；P1 — VIEW-014/015/023、TYPO-014、STATUS-002、AUTO-001、TTS-009、PDF-004（P1 部分已做）、COMIC-004、MISC-001。
❌ 全是 P2：TYPO-013 竖排、TOC-007 表格放大、TTS-012 Ruby 朗读、PDF-005 PDF 标注工具栏、PDF-009 原版 `#A*#` 标注串。

## 整站冒烟（任务 1）

真页面 + 真引擎 + 真 formats + 容器 `samples/books` 真样书，Playwright + 容器 chromium，手机 412×915 与桌面 1280×800 两种尺寸：

| 范围 | 路径 | 结果 | 证据 |
|---|---|---|---|
| 11 种文本格式（epub、txt、kf8.mobi、mobi、html、fb2、md、docx、odt、rtf、umd）× 2 尺寸 | 书架导入 → 打开 → 翻页（键盘、点击区、PageUp 精确退回）→ 目录跳转 → 悬浮「回退」回到原处 → 选字 → 高亮 → 笔记 → 书内搜索 → 朗读（Web Speech）→ 日夜切换 → 字号 → 退出再进进度恢复；全程无 pageerror/console.error | ✅ 22/22 | T/accept.reader.smoke「冒烟 phone/desktop › X：完整路径」；截图 project-scripts/moonreader-accept/reader-shots/ |
| PDF、加密 PDF（密码 abc）、CBZ、右到左 CBZ × 2 尺寸 | PDF 翻页/目录/拖选高亮/搜索/朗读/夜间反色/缩略图条/退出再进；密码框：错误密码提示、正确密码 + 保存密码后重进不再问、取消回书库；漫画翻页/退出再进、RTL 点击区与方向键镜像；PDF 文本重排 | ✅ 12/12 | T/accept.reader.fixed |
| 单文件构建 file://（`vite build --mode single`） | EPUB、TXT 完整路径；PDF 完整路径、文本重排、加密 PDF × 2 尺寸 | ✅ 10/10 | 同上两份 spec，`E2E_APP_URL=file:///…/index.html` |
| features 设置入口（A5） | ⋮→其它选项：TTS朗读设置 / 名字替换 / 自定义词典设置；朗读按钮长按菜单；朗读面板声音/更多选项；多本书压缩包选书；开书动画 | ✅ 4/4 | T/accept.reader.entries |

## A 节「集成没接完的」

| 条目 | 结果 | 证据 |
|---|---|---|
| A1 链接回退栈统一到 features | ✅ reader/ui 的栈已删；底栏 ↩ 与右下悬浮按钮读 `useLinkBack`，点击发 `linkback.back`，长按弹返回记录；返回键在栈非空时弹记录菜单（末项「退出」）；目录/标注列表跳转也压栈（本轮补，原版 PrefChapters.onGetChapter） | u:ops「回退栈只有 features 那一份」；T/features.links；T/accept.reader.smoke「回退到目录跳转前」 |
| A2 自动滚屏暂停用 `paused` 字段 | ✅ U/autoscroll.tsx onEngineAutoScroll；横拖停止后单击不再重新开始（复测通过） | u:autoscroll、input「引擎 autoScroll 事件同步界面状态：用 paused 字段…」；T/engine.reflow「自动滚屏：触摸暂停/继续与调速」 |
| A3 统计翻页数 | ✅ ReadingTracker.addPages、advancedByTurning（拖进度条/目录跳转不算）；速读按词数折页 | u:reading-time、session-persist「翻页数统计」；T/accept.library.shelf 统计卡片 |
| A4 右到左漫画点击区反转 | ✅ U/ops.ts isRtlComic；input.ts 点击区与 ←/→ 镜像 | u:input「右到左漫画…」；T/accept.reader.fixed「右到左漫画…」 |
| A5 features 设置入口 | ✅ 全部有入口 | T/accept.reader.entries「阅读页里 features 的设置入口都能打开」 |
| A6 .ttc 字体降级 | ✅ U/services/fonts.ts warnFontFailed：加载失败回退 serif、只提示一次、.ttc 给转换建议；预览时静默 | u:fonts「字体降级…」 |

## 02 阅读界面

| ID | 优先级 | 状态 | 证据 | 备注 |
|---|---|---|---|---|
| VIEW-001 | P0 | ✅ | E/lines.ts、controller pageStack；u:lines「整行翻页」；T/engine.basic | — |
| VIEW-002 | P0 | ✅ | U/components/Bars.tsx TopBar | 无「出版商格式预览」（Web 本就是 DOM 渲染） |
| VIEW-003 | P0 | ✅ | Bars BottomBar；u:ops「百分比」 | — |
| VIEW-004 | P1 | ✅ | ui-settings DEFAULT_TOOLBAR、ToolbarCustomizer | 排序用 ↑↓ 代替拖拽 |
| VIEW-005 | P1 | ✅ | tool-actions toolLongPress；T/accept.reader.entries（朗读长按菜单） | — |
| VIEW-006 | P0 | ✅ | Panels FontPanel；T/accept.reader.smoke 字号 | — |
| VIEW-007 | P1 | ✅ | services/brightness.ts、BrightnessPanel；u:brightness | 亮度>0 用遮罩 |
| VIEW-008 | P0 | ✅ | actions/host.tsx 选项/导航菜单；T/accept.reader.entries | — |
| VIEW-009 | P0 | ✅ | settings/open.tsx、Drawer | — |
| VIEW-010 | P0 | ✅ | 同 THEME-002；T/accept.reader.smoke 日夜切换 | — |
| VIEW-011 | P1 | ✅ | services/system.ts screen orientation lock | 浏览器不支持时提示 |
| VIEW-012 | P0 | 🟡 | system.ts enterFullscreen；触屏首次触摸进全屏 | 正文边距/状态栏未加 env(safe-area-inset-*)，刘海屏 viewport-fit=cover 下可能被挡 |
| VIEW-013 | P1 | ✅ | system.ts AwakeController（Wake Lock） | — |
| VIEW-014 | P1 | 🟡 | controller dual/dualTarget；T/engine.reflow「双页：…」 | 只在分页（有翻页动画）时生效；无双页章节名/书页背景 |
| VIEW-015 | P1 | 🟡 | F/annotations/BookmarkFlow.tsx BookmarkCorner；T/features.annotations「书签…角标…」 | 角标固定右上角，不随书签行；菜单栏显示时角标让位（本轮修：原先盖住 ⋮） |
| VIEW-016 | P1 | ✅ | E/extras.ts mr-imgonly；T/engine.reflow「…纯图章…」 | — |
| VIEW-017 | P1 | ✅ | Overlays LinkBackButton（长按记录）、Bars ↩；见 A1 | — |
| VIEW-018 | P2 | ✅ | gestures inEdgeBand、input inDeadEdge；T/engine.reflow「防边缘误触…」 | — |
| VIEW-019 | P2 | ✅ | session-persist remind1/2、RemindDialog | — |
| VIEW-020 | P1/P2 | ✅ | library/startup.ts openLastFile；开书动画见 ANIM-012 | — |
| VIEW-021 | P2 | ✅ | extras .mr-end；T/engine.reflow「…章末提示…」 | — |
| VIEW-022 | P1 | ✅ | 滚动模式相邻章首尾相接、scrollBy 跨章；T/engine.books「EPUB：滚动模式下连续滚动穿过章节」 | 等效实现：连续跨章，不需要过拉换章的进度环 |
| VIEW-023 | P1 | 🟡 | src/ui ColorPicker（预设 + 原生取色器 + HEX） | 无 HSV 面板/Alpha 滑条（透明度只能输 8 位 HEX） |
| VIEW-024 | P2 | 🟡 | 首次 ClickTip；自动滚屏首次提示 toast | 无提示图面板 |
| TYPO-001 | P0 | 🟡 | E/css.ts buildBaseCss；u:css；T/engine.reflow「…字体样式」 | 无「平滑 fontAnti」开关（浏览器自带抗锯齿） |
| TYPO-002 | P0/P1 | 🟡 | U/settings/FontPicker.tsx（通用族/导入/服务端字体/删除）；u:fonts | 不内置字体文件（AGENTS.md：不复制 apk 字体；可从服务端 /api/fonts 或导入）；字体不能改名 |
| TYPO-003 | P0 | ✅ | css lineHeightRatio、frame measureLhRatio；u:css | — |
| TYPO-004 | P0 | 🟡 | css paragraphGap；u:css「段间距…」 | TXT 空行在段距为 0 时仍占整行 |
| TYPO-005 | P1 | ✅ | css letter-spacing、fontScale；u:css | — |
| TYPO-006 | P0 | ✅ | 四边距；T/engine.reflow「…页边距生效」 | safe-area 见 VIEW-012 |
| TYPO-007 | P0 | ✅ | css text-align:justify；u:css | — |
| TYPO-008 | P0 | ✅ | css p{text-indent}、开缩进时隐藏 TXT 行首原有空白 `.mr-ind`；u:css「基础样式」 | 本轮修复：中文 TXT 默认配置下缩进两次 |
| TYPO-009 | P1 | ✅ | transforms hideBlankLines；u:transforms | — |
| TYPO-010 | P1 | ✅ | css hyphens + lang | 依赖浏览器断字词典 |
| TYPO-011 | P0 | ✅ | css line-break/text-spacing-trim；u:css「东亚排版」 | — |
| TYPO-012 | P2 | 🟡 | css textDense 近似 | 标点挤压规则未完全复刻 |
| TYPO-013 | P2 | ❌ | 只有 verticalAlignment 开关 | 竖排需改分页为横向流，P2 不做 |
| TYPO-014 | P1 | 🟡 | transforms getConverter(opencc-js)、convertKeepLength；u:transforms | 无「同时转换常见词汇」（词组长度会变，与偏移基准冲突） |
| TYPO-015 | P0/P1 | 🟡 | E/book-css.ts 8 分项；u:book-css；T/engine.reflow「书内 CSS…」 | 书内 CSS 覆盖用户设置时无提示；无 FB2 自定义 CSS |
| TYPO-016 | P0/P1 | 🟡 | iframe 原生渲染 ruby/表格/上下标；图片限宽高 | 宽表格无放大（TOC-007）；音视频用原生控件 |
| TYPO-017 | P0 | 🟡 | formats/txt.ts 编码探测+分章；VisualOptions textEncode（改了重开）；T/engine.books「TXT（红楼梦，GBK）…」 | `txtChapterSplit`（新章换页）开关无效果 |
| TYPO-018 | P2 | 🟡 | css 链接/已访问色、openLinkColorDialog | 脚注气泡不用「标注弹窗颜色」 |
| TYPO-019 | P1 | ✅ | effectiveFontSize(dualFontSizeAdd)；u:css | — |
| THEME-001 | P0 | ✅ | themes/builtin.ts 14 套；u:theme-manager | 背景纹理程序生成 |
| THEME-002 | P0 | ✅ | cycleThemes；u:theme-manager；T/accept.reader.smoke | — |
| THEME-003 | P1 | ✅ | settings/ThemeDialogs.tsx；u:theme-manager | — |
| THEME-004 | P1 | ✅ | autoThemeDecision、useThemeAutomation；u:theme-manager | — |
| THEME-005 | P1 | ✅ | session-system prefers-color-scheme | — |
| THEME-006 | P0/P1 | ✅ | E/textures.ts、BackgroundPicker；u:textures；T/engine.reflow「背景：…」 | — |
| THEME-007 | P0 | ✅ | 文字/界面夜间色；u:css | — |
| ANIM-001 | P0 | ✅ | FlipAnimation 0–7、flipSpeed、VisualOptions | — |
| ANIM-002 | P0 | ✅ | gestures scroll/fling；T/engine.reflow「触屏：…上下滑动滚动」 | — |
| ANIM-003 | P0 | 🟡 | E/curl.ts、curl-render（WebGL/2D）；u:curl；T/engine.anim「仿真翻页 1」 | 双页时整屏当一页卷（已知问题） |
| ANIM-004 | P2 | 🟡 | curl googleMesh；T/engine.anim「仿真翻页 2」 | 双页同上 |
| ANIM-005 | P0 | ✅ | animator case3；u:animator；T/engine.reflow | — |
| ANIM-006 | P1 | ✅ | animator case6；T/engine.anim | — |
| ANIM-007 | P1 | ✅ | animator case4；T/engine.reflow「竖滑翻页（动画 4）…」 | — |
| ANIM-008 | P2 | ✅ | animator case7；T/engine.anim | — |
| ANIM-009 | P1 | ✅ | animator case5；T/engine.anim | — |
| ANIM-010 | P1 | ✅ | horiFlingAnimation、shiftGesture；T/engine.reflow | — |
| ANIM-011 | P2 | ✅ | services/page-sound.ts；u:page-sound | 声音程序合成 |
| ANIM-012 | P2 | ✅ | U/components/OpenBookAnim.tsx（仿真翻页 + 竖屏 + 开关；时长 600−flipSpeed·10、ease-in）；T/accept.reader.entries「开书动画（ANIM-012）…」 | 本轮新做（之前开关是空的） |
| CTRL-001 | P0 | ✅ | actions/tap-zones.ts、input.tap；u:tap-zones、input（含右到左镜像、朗读中点中间 = 暂停/继续） | 朗读中两侧区照常翻页 |
| CTRL-002 | P0 | 🟡 | actions.ts performAction 26 项；u:actions | 24/25「滑动一行」用整页翻页代替（引擎无按行滚动接口） |
| CTRL-003 | P0 | ✅ | gestures.longPress；u:input「长按默认…」 | — |
| CTRL-004 | P2 | ✅ | gestures.maybeSwipe、input.swipe；u:input | — |
| CTRL-005 | P0 | ✅ | actions/keys.ts、keyMap；u:keys、input | — |
| CTRL-006 | P1 | ✅ | pinch；T/engine.reflow「双指缩放改字号…」 | — |
| CTRL-007 | P1 | ✅ | input.verticalDrag/edgeKindAt；gestures/fixed-input inSlideEdge + inSlideEdgeH；u:input「亮度边选「上边」…」；T/engine.reflow「亮度边选「上边」…」 | 本轮补上/下边沿（之前只支持左/右）；无首次使用提示 |
| CTRL-008 | P2 | ✅ | services/motion.ts；u:motion | — |
| CTRL-009 | P2 | ✅ | Media Session → keyMap | 页面有音频时才派发 |
| CTRL-010 | P1 | ✅ | StatusBar Seg 点击/长按 | — |
| CTRL-011 | P1 | ✅ | disableMove/allowScrollHorizontally/multTouch/disableEdgeTouch | — |
| CTRL-012 | P0 | ✅ | gestures 状态机；T/engine.reflow「触屏：点击上报…」 | 桌面鼠标双击/三击选词不再顺带翻页（前任修，本轮复测）；双击 CJK 字右半边不再选中空白（本轮修） |
| CTRL-013 | P2 | ✅ | settings/ClickTip.tsx | — |
| CTRL-014 | P0 | ✅ | ops.stepChapter/goToProgress；u:ops | — |
| STATUS-001 | P0 | 🟡 | StatusBar、lines.estimatePage；u:lines | 双页无两栏页码 |
| STATUS-002 | P1 | 🟡 | StatusSettingsDialog | 无「放刘海下面」/safe-area |
| STATUS-003 | P2 | ✅ | components/remaining.ts；u:remaining | — |
| STATUS-004 | P2 | ✅ | getBattery、formatClock | — |
| STATUS-005 | P1 | ✅ | Bars barTitle、seekValue；u:ops | — |
| AUTO-001 | P1 | 🟡 | U/autoscroll.tsx、E/autoscroll.ts；u:autoscroll；T/engine.reflow「自动滚屏…」 | 双指「暂停并移动页面」未做 |
| AUTO-002 | P1 | ✅ | autoscroll rollStart/rollPaint；T/engine.reflow「自动滚屏 0/1」 | — |
| AUTO-003 | P1 | ✅ | autoscroll 像素/整行/按页；u:autoscroll | — |
| AUTO-004 | P2 | ✅ | U/speedread；u:tokenize | 退出时计入统计（含页数） |
| AUTO-005 | 交叉 | 🟡 | 朗读中点中间暂停/继续（见 CTRL-001） | 两侧区不映射到朗读翻页；朗读时不禁用双页 |

## 03 内容

| ID | 优先级 | 状态 | 证据 | 备注 |
|---|---|---|---|---|
| FMT-001 | P0 | ✅ | FM/index.ts detectFormat；u:index「像文本的未知文件当 TXT…」 | — |
| FMT-002 | P0 | 🟡 | FM/encoding.ts；u:encoding；VisualOptions textEncode | 手动编码是全局设置，不按书记忆 |
| FMT-003 | P0 | ✅ | FM/txt-chapters.ts；u:txt-chapters | 自定义分章正则无界面 |
| FMT-004 | P0 | 🟡 | transforms hideBlankLines、css 缩进（行首空白已处理，见 TYPO-008） | 「删除多余空格」不合并硬折行/不压缩空格 |
| FMT-005 | P0 | ✅ | FM/txt.ts splitRange；T/engine.books「TXT（红楼梦，GBK/大文件）」 | — |
| FMT-006 | P1 | ✅ | FM/html.ts、lib/flow.ts；u:html | — |
| FMT-007 | P0 | ✅ | FM/epub.ts；u:epub | — |
| FMT-008 | P0 | 🟡 | E/extras.ts mr-imgonly、chapterEnd | 空章不显示居中章名；章末提示不带下一章名 |
| FMT-009 | P1 | ✅ | E/book-css.ts；T/engine.reflow「书内 CSS…」 | — |
| FMT-010 | P1 | ✅ | FM/lib/section.ts 资源改写；u:epub 字体混淆还原 | — |
| FMT-011 | P0 | ✅ | FM/mobi.ts；u:mobi；T/accept.reader.smoke mobi/kf8 | — |
| FMT-012 | P1 | ✅ | FM/fb2.ts；u:fb2；T/accept.reader.smoke fb2 | — |
| FMT-013 | P2 | ✅ | FM/umd.ts；u:umd；T/accept.reader.smoke umd | — |
| FMT-014 | P2 | ✅ | server-formats chm → 服务端 chmToEpub；T/accept.library.deploy「CHM / CBR / DJVU…」×4 形态 | 需要服务端 |
| FMT-015 | P1/P2 | ✅ | FM/docx.ts、odt.ts；u:docx/odt；T/accept.reader.smoke | — |
| FMT-016 | P2 | ✅ | FM/rtf.ts；u:rtf；T/accept.reader.smoke | — |
| FMT-017 | P1 | ✅ | FM/markdown.ts；u:markdown；T/accept.reader.smoke | — |
| FMT-018 | P0 | ✅ | FM/lib/text.ts metaFromFileName、各格式封面 | — |
| FMT-019 | P0 | ✅ | 交叉引用 PDF/COMIC | — |
| FMT-020 | P0/P1 | ✅ | FM/archive.ts selectEntry；U/session/load.ts ArchiveChoiceNeededError + index.tsx 选书框；u:load；T/accept.reader.entries「多本书的压缩包…」 | 本轮补选书界面（之前直接报错）；RAR 经服务端；加密包 422 不支持 |
| FMT-021 | P2 | 🟡 | remaining.ts、countWords | 书籍信息不显示全书/剩余字数 |
| FMT-022 | P2 | 🟡 | extractIsbn（epub/mobi） | ISBN 未存进书库记录 |
| TOC-001 | P0 | ✅ | F/toc/TocPanel.tsx；T/features.toc | — |
| TOC-002 | P0 | 🟡 | toc-utils cleanChapterTitle；u:toc-utils | PDF 目录不显示页码；目录标题不做简繁 |
| TOC-003 | P0 | ✅ | TocPanel go（跳转前压回退栈）；T/features.toc、T/accept.reader.smoke | — |
| TOC-004 | P1 | ✅ | F/footnote 气泡、页底注解；T/features.links「点脚注标记…」 | — |
| TOC-005 | P0/P1 | ✅ | 见 A1；外链确认；T/features.links | PDF 内链见 PDF-008 |
| TOC-006 | P2 | ✅ | F/toc/ImagesTab.tsx；T/features.toc | — |
| TOC-007 | P2 | ❌ | — | 表格放大/HTML 查看器未做，浏览器原生渲染表格 |
| TOC-008 | P2 | ✅ | sanitize 保留 audio/video | 原生控件 |
| ANNO-001 | P0 | 🟡 | gestures.longPress→selectWordAt；SelectionHandles；T/engine.reflow「触屏：…长按选词…」 | 放大镜只有开关；长按后不能直接拖动扩选（拖手柄可以） |
| ANNO-002 | P0/P1 | ✅ | F/annotations/SelectionToolbar.tsx；T/features.annotations | — |
| ANNO-003 | P0 | ✅ | clipboard、formatPdfCopyText；u:pdf-text | — |
| ANNO-004 | P0/P1 | ✅ | HighlightDialog、颜色模板；T/features.annotations、accept.reader.smoke | — |
| ANNO-005 | P0 | ✅ | AnnotationPopup；T/features.annotations | — |
| ANNO-006 | P0 | ✅ | NoteEditor；T/accept.reader.smoke 笔记 | — |
| ANNO-007 | P0 | ✅ | BookmarkFlow；T/features.annotations | — |
| ANNO-008 | P0 | ✅ | F/toc/AnnotTab.tsx；u:model；T/features.toc | — |
| ANNO-009 | P0 | ✅ | model.ts 按前后文重定位；u:model | — |
| ANNO-010 | P1/P2 | ✅ | F/export；T/features.toc「导出：…」 | — |
| ANNO-011 | P2 | ✅ | storage/readwise.ts；T/accept.library.extras「Readwise…」 | — |
| ANNO-012 | P1 | ✅ | lookup.ts openWebSearch；u:sources | — |
| ANNO-013 | 随 PDF | 🟡 | fixed.ts 文字层选择 + 装饰；T/accept.reader.fixed「PDF：…选字高亮…」 | PDF 标注为叠加层；DJVU 无文字层 |
| SRCH-001 | P0 | ✅ | F/search；u:engine；T/features.search、accept.reader.smoke | — |
| SRCH-002 | P0 | ✅ | SearchUi 导航面板；T/features.search | 只有一条结果时不显示上/下条导航（与原版一致） |
| SRCH-003 | P1 | ✅ | search/history.ts | — |
| SRCH-004 | P1 | ✅ | model matchKeyword；u:model | — |
| SRCH-005 | P1 | ✅ | SelectionToolbar → search.open；T/features.search | — |
| TTS-001 | P0 | ✅ | F/tts；T/features.tts、accept.reader.smoke | — |
| TTS-002 | P0 | ✅ | tts/split.ts；u:split | — |
| TTS-003 | P0 | ✅ | tts/runner.ts；u:runner；T/features.tts | — |
| TTS-004 | P0 | ✅ | tts/Panel.tsx；T/features.tts | — |
| TTS-005 | P0 | ✅ | tts/params.ts；u:params | — |
| TTS-006 | P1 | ✅ | runner setStopTimer；T/features.tts「定时停止…」 | — |
| TTS-007 | P1 | ✅ | runner intervalMs；u:runner | — |
| TTS-008 | P1 | ✅ | tts/filter.ts；u:filter | — |
| TTS-009 | P1 | 🟡 | split/filter | 无 Ruby 读音替换；PDF 行末连字符不合并 |
| TTS-010 | P1 | ✅ | ServerTtsEngine、Media Session；服务端 /api/tts；T/features.tts-server、accept.library.server「/api/tts…」 | 后台连续朗读需服务端引擎 |
| TTS-011 | P1 | ✅ | runner 按页取文本；T/accept.reader.fixed「PDF：…朗读…」 | — |
| TTS-012 | P2 | ❌ | — | Ruby 注音朗读未做 |
| TTS-013 | P2 | 🟡 | 朗读翻页经 relocate 计入字数/页数 | 不按句计字；朗读不在免空闲判定里 |
| TTS-014 | P0 | ✅ | tts/voices.ts；u:voices；T/features.tts-server | — |
| DICT-001 | P0 | ✅ | dict/lookup.ts；T/features.dict | — |
| DICT-002 | P0/P1 | ✅ | dict/sources.ts、LookupCard；服务端 /api/dict；T/features.dict、accept.library.server | — |
| DICT-003 | P1 | ✅ | dict/Dialogs.tsx；T/features.dict、accept.reader.entries | — |
| DICT-004 | P1 | ✅ | dict/translate.ts；服务端 /api/translate；T/features.dict | — |
| DICT-005 | P1 | ✅ | openWikipedia/openWebSearch；u:sources | — |
| DICT-006 | P1 | ✅ | dict/history.ts；u:history；T/features.dict「生词本…」 | — |
| DICT-007 | P1 | ✅ | placeNear；u:position | — |
| PDF-001 | P0 | ✅ | FM/pdf.ts；U/session/load.ts asPasswordError、password.tsx；u:load；T/accept.reader.fixed「加密 PDF…」 | 本轮修复：formats 抛的 PasswordRequiredError 没被认出，加密 PDF 直接「打开失败」不弹密码框 |
| PDF-002 | P0 | ✅ | settings/PdfOptions.tsx；T/engine.fixed | — |
| PDF-003 | P0 | ✅ | pdf.ts 目录；u:pdf | 只记页号 |
| PDF-004 | P1/P2 | 🟡 | fixed.ts 文字层 + 装饰；T/engine.fixed「文字层…装饰…」 | 叠加层 P1 已做；写回 PDF（P2）未做 |
| PDF-005 | P2 | ❌ | — | PDF 标注工具栏（便笺/手绘/形状）未做 |
| PDF-006 | P1 | ✅ | U/session/pdf-reflow.ts（一页一章、文本节点与页文字逐字相同 → 位置/标注不变）、Bars「文本重排」按钮、fixedSettings.textReflow；u:pdf-reflow 7 例；T/accept.reader.fixed「PDF 文本重排（PDF-006）…」（含 file://） | 本轮新做；按行几何（写满/行距/字高/两栏）复刻 formatPdfReflowText |
| PDF-007 | P1 | ✅ | fixed.ts applyColors；T/engine.fixed「夜间反色…」 | — |
| PDF-008 | P2 | 🟡 | pdf/ThumbStrip.tsx、pdfScrollLock | PDF 内链/外链不支持（FixedBook 无链接接口） |
| PDF-009 | P2 | ❌ | — | PDF 标注走普通标注同步，不兼容原版 `#A*#` 串 |
| PDF-010 | P2 | 🟡 | server-formats djvu → 服务端 ddjvu 转 PDF；T/accept.library.deploy「…DJVU…打开阅读页」 | 转出的 PDF 无文字层，不能选字/搜索/朗读 |
| COMIC-001 | P0 | ✅ | FM/cbz.ts、cbr/cb7 经服务端；u:cbz；T/engine.books、accept.reader.fixed | — |
| COMIC-002 | P1 | ✅ | readComicInfo；u:cbz | — |
| COMIC-003 | P0 | ✅ | fixed-layout、comicRtl/fitMode；T/engine.fixed、accept.reader.fixed | — |
| COMIC-004 | P1 | 🟡 | F/imageviewer；u:zoom-math；T/features.links「看图器…」 | 无亮度调节、无小状态栏；单击图片现为普通点击，长按才看图（原版 longTapImageFullScreen，前任修） |
| COMIC-005 | P0 | ✅ | 页级位置/书签；T/accept.reader.fixed「CBZ：…退出再进」 | — |
| MISC-001 | P1 | 🟡 | transforms 简繁（等长）；T/engine.reflow「显示性变换…」 | 只转正文；目录/书签名/搜索不转；无「常见词汇」 |
| MISC-002 | P2 | ✅ | replaceNames、NamesDialog；T/features.names | — |
| MISC-003 | P2 | 🟡 | FM/aozora.ts ruby | 青空文库插图注记未做 |
| MISC-004 | P2 | ✅ | 图片选项 | — |
| MISC-005 | — | ✅ | library/CoverPicker、BackgroundPicker | — |
| MISC-006 | — | 🟡 | library/BookInfo.tsx | 不显示页数/全书字数/剩余字数 |
| MISC-007 | — | ✅ | 见 AUTO-004 | — |
| MISC-008 | P2 | ✅ | public/manifest + sw.js、library/pwa.ts；T/accept.library.pwa 5 条 | — |

## 本轮修的阅读侧 bug（都有回归测试）

1. 加密 PDF 不弹密码框（PDF-001）。2. 双击 CJK 字右半边选中空白、选择条不出现（engine selection.ts / gestures.ts；T/accept.reader.smoke rtf/umd）。3. 目录/标注列表跳转不压回退栈（TOC-003/005）。4. 中文 TXT 默认缩进两次（TYPO-008）。5. 朗读中点击不暂停（CTRL-001）。6. 多本书压缩包打不开（FMT-020）。7. 开书动画开关是空的（ANIM-012）。8. 上/下边沿擦动无效（CTRL-007）。9. 桌面鼠标打不开看图器（前任把单击图片改成普通点击后，长按计时只对触屏启动；改为鼠标按在图片上也启动长按，文字上仍是原生拖选；T/engine.reflow「图片事件：长按图片…」）。另有前任已修、本轮复测：鼠标双击选词顺带翻页、单击图片误开看图器、书签角标盖住 ⋮。

## 已知问题（未修）

双页 + 仿真翻页整屏当一页卷；固定版式放大整页重渲染（封顶 2400 万像素）；鼠标在 PDF 文字上拖 = 选择不是平移（有意：桌面拖选文字）；`txtChapterSplit` 无效；动作 24/25 按整页翻；safe-area 未适配。
