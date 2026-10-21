# 02 阅读界面规格：排版、主题、翻页、操控、状态显示

> 调研对象：静读天下 Pro 7.3（`com.flyersoft.moonreaderp`）的阅读器 `ActivityTxt` 及其依赖。只读调研，未运行 apk。
> 源码根 `jadx/sources/com/flyersoft/`；缩写：`AT` = `moonreaderp/ActivityTxt.java`，`A` = `books/A.java`，`NC3D` = `components/NewCurl3D.java`，`SHSL` = `staticlayout/SoftHyphenStaticLayout.java`。行号为 jadx 产物行号，仅作定位。
> 资源：`apktool/res/values*/strings.xml`、`arrays.xml`、`layout/*.xml`、`apktool/assets/{themes,background,fonts,hyphenation}`。
> 优先级：P0 核心必做 / P1 / P2；可行性：`[浏览器]` 纯前端，`[服务端]` 需要服务端配合，`[不做: 原因]`。
> 范围边界：格式解析、文字选择后的标注/笔记/朗读/词典/搜索、书架与同步不在本文，遇到只交叉引用。PDF/CBZ/DJVU 分支（`isPdf()`）整体不在本文范围。

---

## 1. 概览

阅读界面不是“分页引擎”，而是 **一段整章文本 + 一个会按整行对齐的滚动窗口**：`MRTextView`（自研 `StaticLayout` 变体，`staticlayout/*`）把当前章节（TXT 为 3 块滑动窗口，EPUB 为一章，超过 `maxHtmlChapterSize=100000` 字符再拆块）一次性排成一个很高的 View，放在 `ScrollView2` 里；“翻页”就是把 scrollY 跳到“下一页首行”的行顶（`AT.pageScroll`、`getNextPageLine2`），保证页首页尾不切行。所以默认的「无翻页动画」模式其实是可以手指上下拖动、带惯性 fling 的连续滚动，点击/按键只是按页跳转。所有翻页动画（仿真/水平/垂直/渐隐/覆盖）都是在跳转前后各截一张页面位图（`getPageShot`），在其上叠加动画层。

视图层次（`layout/show_txt.xml`，FrameLayout `txtFrame` 自下而上）：`dualPageBackground`（双页书本背景）→ `ContentLay`（内含 `txtLay`: `ScrollView2 txtScrollView01 + MRTextView`，双页时再并排一套 `txtScrollView02`；ContentLay 额外绘制书签角标与“纯图章节”整页图）→ `scrollCache/txtCache`（水平切换/覆盖动画用的旧页缓存）→ `txtScrollLay`（卷帘式自动滚屏的 `ScrollImage`）→ `flipImageView`（FlipImageView：渐隐/平移/覆盖动画）→ `curl3dLay`（GLSurfaceView `NewCurl3D` 仿真翻页）→ `dualChapterTv`（双页章节名）→ `txtStatusLay`（迷你状态栏）→ `linkBackIv`（链接返回）→ ViewStub 面板：顶部栏 `txt_top`、底部栏 `txt_bottom`、亮度 `txt_brightness`、字号 `txt_font`、TTS、搜索、提示 `tips_panel` → 选择条 `HighlightBar` 与拖拽柄 `dot1/dot2`（归他人）→ `shadeView`（亮度/蓝光遮罩，最顶层）。

主题是“颜色 + 可选的字体排版参数”的快照（14 个 XML），当前生效值存在 `A` 静态字段里。所有设置通过 `A.LoadOptions/SaveOptions` 读写（SharedPreferences `options1002`），Web 版用 localStorage/IndexedDB 或服务端用户配置即可。

**Web 架构建议（贯穿全文）**
1. 渲染：两条路线并存。(a) HTML/EPUB 用 **CSS 多栏（`column-width`/`column-gap` + 横向 `scrollLeft` 或 `transform`）** 分页——浏览器本身在行边界断栏，天然满足“页首尾不切行”，页数 = `scrollWidth / pageWidth`；(b) 「无翻页动画」滚动模式用原生纵向滚动 + 点击按“整行”跳转（用 `Range.getClientRects`/行盒测量实现 `getLastDisplayLine`）。TXT 先转成段落 HTML 再走同一管线。
2. 动画：先把当前页与目标页各渲染成 `<canvas>`/`ImageBitmap`（`html-to-image` 或自绘文本到 OffscreenCanvas），再用 CSS transform 或 WebGL 合成。仿真翻页用 WebGL（见 §4.3）。
3. 设置/主题：一份 JSON（字段名沿用本文 §3），主题为 §5 的 JSON 映射。
4. 状态栏/顶底栏：DOM 叠层，`position: fixed`，避免进入分页容器。

---

## 2. 功能清单

### 2.1 VIEW：视图结构、菜单、导航、系统相关

#### VIEW-001 阅读容器与「整行翻页」模型 〔P0〕〔[浏览器]〕
- 行为：翻页向下 = 跳到「当前页最后一个完整显示行」的下一行行顶；向上 = 优先弹出历史栈 `yBeforePageDown`（回到上次翻页前的精确位置），栈空则按“scrollY − pageHeight”反算首行。一行只有露出 `oneLineTag` 比例才算“显示”：`lineSpace<0` → `1 − lineSpace/10`；否则 `(lineSpace≥2 ? 0.75 : 0.82) + (亚洲语言 0.1 : 0.08)`，不足则该行顺延到下一页。页高 = 容器高 − 上下 padding（`A.getPageHeight`）。可选「翻页时保留一行」（`keepOneLineWhenPaging`），下一页首行 = 上页末行。章内到底 → 自动换下一章（`pageDownToNextChapter`），章首上翻 → 上一章末尾（`pageUpToPriorChapter`）。书首/书尾翻页被忽略（`ignoreFirstOrLastPageFlip`），自动滚屏/朗读中遇到则停止。
- 出处：`AT.pageScroll(13098)`、`getNextPageLine2(7143)`、`A.getLastDisplayLine(5687)`、`A.oneLineTag(9340)`、`A.getPageHeight(5939)`。
- 设置项：`keepOneLineWhenPaging`(默认 false)。
- Web：CSS 多栏天然不切行，`oneLineTag` 可省；若做滚动模式则需测行盒。

#### VIEW-002 顶部栏（标题栏）〔P0〕〔[浏览器]〕
- 文案：返回箭头；标题（TXT 显示文件名，EPUB 显示「书名 - 作者」）；`pen`(仅 PDF)；`chromeSwitch`「出版商格式预览」(Misc 选项开启才显示)；`⋮` 溢出菜单。
- 行为：点返回 → 回书架（`do_back_to_book_stack`）；点标题 → 书籍信息（`do_book_info`，归他人）；点 ⋮ → VIEW-008「选项菜单」。背景色日间 `#1E88E5`，夜间 `#505050`；高度平板 64dp。显示/隐藏动画 150ms 平移（上栏从上滑入、下栏从下滑入）。
- 出处：`layout/txt_top.xml`、`AT.initTopBottomLay(8762)`、`getTopBarColor(7512)`、`layoutAnimationShow/Hide(10033/10021)`。
- Web：固定定位 div + CSS transition。

#### VIEW-003 底部栏：进度条 + 章节切换 + 百分比 〔P0〕〔[浏览器]〕
- 文案：`◀`上一章 / SeekBar(0–1000) / 百分比文字(如 `35.21%`) / `↩`(nav_return 回退) / `▶`下一章；背景日间 `#E0E0E0`、夜间 `#424242`；百分比文字日 `#616161`、夜 `#E0E0E0`。
- 行为：拖动 SeekBar 实时调用 `showBookByPercent(i)` 跳转（TXT/HTML 全书按字数比例；EPUB 先按章字数累加算章再算章内偏移，松手时才真正载入，`ebook_inLoading` 防抖）；开始拖动前 `saveLinkBackInfo` 记录原位置，`↩` 一键回到拖动前位置。点百分比 → 对话框，标题 `0.0% - 100%`，输入数字（可带 `%`，范围 0–100）→ 跳转（`do_go_percent`）。点 ◀/▶ → 同时显示 `↩`、隐藏顶部栏并换章。拖动中百分比文字实时显示 `i/10 %`。
- 出处：`layout/txt_bottom.xml`、`AT.seekBarChanged(1394)`、`showSeekBarProgress(16497)`、`do_go_percent(5675)`、`showBookByPercent(22610)`、`do_floatBarButton(5556)`。
- Web：`<input type=range min=0 max=1000>`；EPUB 需要每章字数表（服务端解析时给出，见 01 文档）。

#### VIEW-004 底部工具按钮栏（20 个可定制按钮）〔P1〕〔[浏览器]〕
- 文案/功能（`ReaderBar.bText/bIcon`，index 即按钮号）：0 屏幕方向 Screen Orientation；1 白天/晚上模式切换 Day/Night Mode；2 朗读 Speak（Pro）；3 自动滚屏 Autoscroll；4 目录 Chapters；5 书签 Bookmarks；6 亮度调节 Brightness；7 文字大小 Font Size；8 搜索 Search；9 允许倾斜设备翻页 Tilt；10 可视选项；11 控制选项；12 其它选项；13 配色方案 Themes；14 设置选项 Options；15 关闭 Shutdown；16 双页模式开关 Dual-Page；17 自定义工具栏 Customize；18 同步到云端；19 从云端同步。
- 行为：默认勾选 = 0,1,2(仅 Pro),3,4,17，其余不勾；每项可勾选+拖拽排序（`DragSort`），设置存文件 `reader_bar_icons`，格式 `<index>*<true|false>` 每行一项（20 行）。「双行显示」`doubleLineBar`(默认 false)：勾选项数为奇数时补一个空位，前一半放第一行。平板（非折叠屏）栏高 60dp，图标 padding 3dp。点按钮前先 `hidePop`。长按按钮 → VIEW-005 弹出菜单；长按 15/16/17 与点击等同；其余项长按只 toast 按钮名。
- 出处：`components/DragSort/ReaderBar.java`、`AT.buttonClick(1064)`、`buttonLongClick(~1130)`、`setBottomIconsVisibility(22197)`。
- 设置项：`doubleLineBar`、`reader_bar_icons` 文件、入口 Misc「自定义阅读器工具栏」。
- Web：拖拽排序用原生 DnD/pointer events；图标需重绘（apk 的 drawable 是 Material 风位图，建议用 SVG 重画）。

#### VIEW-005 底部按钮的长按菜单 〔P1〕〔[浏览器]〕
- 0 屏幕方向：列出 7 种方向（见 VIEW-011）。1 日夜：白天主题 / 晚上主题 / 读取配色方案 / 保存为配色方案（`doDayNightLongTap`）。2 朗读：他人。3 自动滚屏：列出 6 种模式，选中即以该模式开始滚屏。4 目录：总章节数（打开目录）/ 切换到上一章 / 下一章。5 书签：已保存书签 / 添加新书签。6 亮度：自动 / 100% / 50% / 1% / +1 / −1。7 字号：字体名称（本地字体列表）/ 字号+ / 字号−（菜单文案写「±0.5」但代码实际 ±1.0，见 §7）。8 搜索：他人。9 倾斜：打开倾斜设置对话框。
- 出处：`AT.doDayNightLongTap(3667)`、`doAutoScrollLongTap(3553)`、`doBookmarkLongTap(3579)`、`doBrightnessLongTap(3594)`、`doChaptersLongTap(3621)`、`doFontSizeLongTap(3775)`、`doOrientationLongTap(4490)`。
- Web：右键/长按 → 弹出 Popover。

#### VIEW-006 浮动「字体大小」面板 〔P0〕〔[浏览器]〕
- 行为：点底部「文字大小」按钮或动作 10 → 在底部显示面板：大字号（SeekBar，范围 `maxFontSize−minFontSize`，整数部分）+ 小数位 SeekBar（0–9，步长 0.1）+ 左右 `−/+`（±1 / ±0.1）+ 数字显示 + 「重置」箭头（恢复打开面板前的值）。字号上下限 `minFontSize=10`（平板 12）、`maxFontSize=100`，保存时取一位小数；每次调整 `resetPageCount()+setFontSize()`，实际重排延迟 ~200ms（`SET_FONT_SIZE` 消息去抖）。
- 出处：`AT.getFontLay(7010)`、`updateFontLayValue(17623)`、`A.minFontSize/maxFontSize(864/865)`。
- Web：`<input type=range step=0.1>`，调整后去抖重排并按当前阅读位置（字符偏移）重新定位——**必须以字符/段落锚点而非 scrollY 记录位置**。

#### VIEW-007 亮度面板与蓝光过滤 〔P1〕〔[浏览器] 有降级〕
- 文案：「亮度:」「自动」复选 + 滑条(0–150，实际值=进度−50) + `−/+`；「蓝色光波过滤」复选 + 「过滤量」滑条(0–95) + `−/+`。
- 行为：`brightnessValue` 取值 −100（=跟随系统自动）或 −50…100。≥1 时设窗口亮度 = 值/100；≤0 时窗口亮度固定 1%，再在 `shadeView` 叠一层半透明黑：alpha = `min(1 − v, 50) × 4`（0…200，v=0 → 4，v=−50 → 200）。蓝光过滤开启时叠加暖色遮罩，详见 §4.8。面板由「亮度调节」按钮/动作 20/左边缘滑动唤出；从边缘滑动唤出时是只含滑条的精简版，约 3 秒（`hideBrightnessPanelFade`）渐隐；长按底部亮度按钮有预设菜单。
- 出处：`AT.initBrightSeek(8353)`、`showBrightnessPanel(16123)`、`setScreenBrightness(22355)`、`showShadeCoverOnView(16569)`、`getShadeAlph(19339)`、`updateBluelightFilter(17603)`。
- Web：**浏览器无法改系统亮度**。降级方案：值 ≤0 时照搬遮罩公式；值 >0 时无意义，建议把滑条重映射为「0–100 = 页面内亮度 40%–100%」，用同一块遮罩（黑色 alpha）实现，并在 §7 标注与原版语义不同。蓝光过滤用同一遮罩换成暖色。
- 设置项：`brightnessValue`(默认 −100)、`bluelightEnable`(false)、`bluelightOpacity`(30)、`adjustBrightness`(true，左边缘滑动)、`brightness_edge`(0=左)。

#### VIEW-008 选项菜单（⋮）与「导航菜单」 〔P0〕〔[浏览器]〕
- 选项菜单（顶部栏 ⋮ 或动作 8）：可视选项 / 控制选项 / 其它选项 / 配色方案 / `-` / [名字替换（Pro 且设为不放主菜单时）] / 更多操作... / 分享... / 书籍信息。点开任何一项前会停止自动滚屏与朗读、保存位置。
- 「更多操作...」= 导航菜单（动作 9），实际菜单项（`showMoreOptionsMenu` 把数组 `more_options_menu` 的“书籍信息”位改成“自动滚屏”、“浮动工具栏”位改成“字体大小调节”、末位改成“亮度调节”）：[朗读(Pro)] / 页面文字摘录 / 全文搜索 / 自动滚屏 / 章节目录 / 切换到上一章节 / 切换到下一章节 / 打开上一个文件 / 打开下一个文件 / 书签管理 / 字体大小调节 / 亮度调节。点击后先收起菜单栏再执行（`doMoreOptionsMenuClick` 的 case 与此顺序一一对应）。
- 出处：`AT.showOptionsMenu(16423)`、`doOptionsMenuClick(4452)`、`showMoreOptionsMenu(23165)`、`doMoreOptionsMenuClick(4233)`；`arrays.xml: options_menu, more_options_menu`。
- Web：Popover 菜单；「上一个/下一个文件」= 书架当前列表的相邻书（需书架接口）。

#### VIEW-009 阅读设置对话框层级 〔P0〕〔[浏览器]〕
- 三个全屏式对话框互相跳转：**可视选项 PrefVisual**（`R.layout.pref_visual`）↔ **控制选项 PrefControl** ↔ **其它选项 PrefMisc**，每个对话框底部有两个切换按钮跳到另外两个；背景半透明便于预览（`dimAmount=0`），关闭时 `A.SaveOptions` 落盘。详见 §6。
- Web：右侧抽屉/半屏 sheet，修改即时预览，关闭保存。

#### VIEW-010 日夜模式一键切换 〔P0〕〔[浏览器]〕→ 见 THEME-002。

#### VIEW-011 屏幕方向 〔P1〕〔[浏览器] 受限〕
- 按钮 0：点击 = 在「横屏(感应器)」和「竖屏(感应器)」之间切换并重建阅读页（`generateNextScreenOrientation`；当前为横屏或 screenState==5 → 6，否则 5）；长按弹出 7 种：自动(传感器) / 横屏 / 竖屏 / 横屏(反向) / 竖屏(反向) / 横屏(感应器) / 竖屏(感应器)，对应 Android 方向常量 10/0/1/8/9/6/7。选“自动(传感器)”但系统自动旋转未开时提示「在将屏幕方向设置为自动（传感器）之前，请先启用系统自动旋转屏幕。」。默认：平板按当前方向 5/6，手机 6。
- 出处：`A.getScreenOrientation(6060)`、`AT.generateNextScreenOrientation(6456)`、`PrefControl.setScreenOrientation`、`A.defaultScreenState(2810)`。
- Web：`screen.orientation.lock('landscape'|'portrait'|'natural')`——仅全屏 + 安装为 PWA 的 Android Chrome 可用，iOS Safari 不支持；不支持时隐藏该项或只做“布局横/竖偏好”提示。
- 设置项：`screenState`。

#### VIEW-012 全屏 / 沉浸模式 / 刘海适配 〔P0〕〔[浏览器]〕
- 选项（Misc「全屏模式」+ 齿轮）：`fullscreen`(默认 true，隐藏系统状态栏)；`fullscreenWithStatus`「全屏时显示透明系统通知栏」(false)；`immersive_fullscreen`「浸入式全屏(隐藏系统按键栏)」(Android 8+ 强制 true)；`fitCutout`「适配刘海屏(Android 9+)」；状态栏位置相关 `statusUnderNotch`「放刘海下面」。呼出顶底栏时临时退出沉浸，隐藏后恢复。
- 出处：`PrefMisc.pmFullscreenOp(2400+)`、`AT.setFullscreen(15666)`、`A.getTopMargin(6370)`。
- Web：`element.requestFullscreen()`（须用户手势，不能默认自动进入）；刘海用 `env(safe-area-inset-*)`；顶部页边距应加上 safe-area。

#### VIEW-013 屏幕常亮 〔P1〕〔[浏览器]〕
- 行为：`keepScreenAwake`(默认 true)。“扩展分钟” `screenAwakeExtend`：每次触摸/按键刷新计时，超过 N 分钟无操作则取消常亮（N=1/2/5/10/30，选「+∞」存 100 = 不取消）；自动滚屏中永远常亮；朗读/速读中常亮。默认 5。选项文案「阅读时保持屏幕长亮」，齿轮对话框选 `+1/+2/+5/+10/+30/+∞ 分钟`。
- 出处：`AT.checkScreenAwake(17873)`、`PrefMisc.pmSetScreenAwake`。
- Web：`navigator.wakeLock.request('screen')`，无操作 N 分钟后 `release()`；用户回到页面需重新申请（visibilitychange）。

#### VIEW-014 双页显示（Dual Page）〔P1〕〔[浏览器]〕
- 文案：「双页面布局」；对话框含「仅横屏时」`landscape2PageMode`、「书页样式」`pageStyle2PageMode`、「显示阅读章节」`dualChapterText`、「可折叠手机的自动双页面模式」`auto2PageForFoldable`、「文字大小(±)」`dualFontSizeAdd`；底部按钮 16「双页模式开关」。
- 行为：`dualPageEnabled = dualPage && (!dualPageOnlyLandscape || 横屏) && !自动滚屏 && !朗读 && 非 PDF/WebView`。双页用左右两个 ScrollView 各放同一章文字的相邻页，页面上下滑动被禁用（`isDisableMove` 含双页）。启用时书页样式画一张 9-patch 书本背景 `bookstyle`/`bookstyle_night`（纯黑背景不画）。状态栏变成两栏页码「当前页/总页」。默认平板开启（`dualPage=dualPageOnlyLandscape=isTablet`）；开关会 `restartReaderIntent` 重建。
- 出处：`AT.checkDualPageMode(2441)`、`dualpage_switch(6040)`、`setBookStyleBackground(22176)`、`A.dualPageEnabled(3202)`、`PrefMisc.pmSet2Page`。
- Web：宽屏（≥~900px 横向）双栏；CSS 多栏 `column-count:2` 天然支持；书本背景用 CSS 图或 SVG。

#### VIEW-015 书签角标（右上红色丝带）〔P1〕〔[浏览器]〕
- 行为：当前屏幕范围内有书签时，在页面右侧 padding 区、书签所在行位置画 `bookmark_tag` 图标（可带书签颜色）；高度 = 行高×80%，宽 = 高×40/70，受右边距限制缩放；若书签位于页面顶部且只有一个，则固定画在右上角。`showBookmarkIcon`(默认 true) 控制长按选择时是否显示加书签图标。书签数据/增删归他人。
- 出处：`components/ContentLay.drawBookmarks`、`A.showBookmarkIcon`。
- Web：绝对定位的 SVG 丝带，位置 = 书签 Range 的 `getBoundingClientRect().top`。

#### VIEW-016 纯图片章节整页显示 〔P1〕〔[浏览器]〕
- 行为：EPUB 章节只有一张图时（`hasImageOnly`），ContentLay 以「等比缩放居中 + 半透明底 `#EE333333` 背景」整页绘制（双页时按左右边距、上边距内缩），不走文字排版。
- 出处：`ContentLay.drawFullImageOnly`、`A.currentChapterWithImageOnly`。

#### VIEW-017 链接返回 / 回退按钮 〔P1〕〔[浏览器]〕
- 行为：点击脚注/内部链接跳转后，底部出现悬浮的「返回」图标 `linkBackIv`（`LINK_BACK` 栈，记录章节+位置+滚动）；底部栏上 `nav_return`（↩）功能相同；进度条拖动后也使用它。返回键优先 `navigateBackLinks`。
- 出处：`AT.saveLinkBackInfo(22141)`、`doLinkBack(4043)`、`goToBackLink(7742)`。

#### VIEW-018 防误触边缘（Disable edge touch）〔P2〕〔[浏览器]〕
- 文案：「屏幕边缘防误触」+ 齿轮对话框设置四条边宽度。`ledge/redge/tedge/bedge`(默认各 8dp)：落在边缘带内的触摸整体忽略；多点触控时取最后一个手指重新分发。开启后，亮度/字号边缘滑动的触发区向内缩进相同宽度。
- 出处：`AT.disableEdgeTouch(3392)`、`isEdgeTap(9133)`、`isWipeInEdge(19843)`。
- Web：触屏设备上才有意义，可做。

#### VIEW-019 健康提醒 〔P2〕〔[浏览器]〕
- 文案：「使用下面选项以保护视力:」「连续阅读时间超过设置值时提醒」(`remind1`，默认开，60 分钟，文案「您已连续长时间使用本阅读器, 请注意休息以保护视力 .」)；「固定时间提醒」(`remind2`，默认关，23:30，文案「夜已深, 请注意休息」，在设定时间后 15 分钟内触发一次)。提醒对话框 60 秒倒计时自动关闭。自动滚屏/朗读中不计时。
- 出处：`AT.checkRemindEvent(2555)`、`PrefMisc.pmSetRemind1/2`。
- Web：`setInterval` + `Notification`/内置对话框。

#### VIEW-020 启动时打开上次文件 / 打开书动画 〔P1/P2〕〔[浏览器]〕
- `openLastFile`「自动打开上次阅读文件」默认 false。`openBookAnim`「显示书籍打开时的动画」默认 false，仅 Pro 且仿真翻页时可用：封面在黑底上以 FlipImageView type −100 左右对开（见 ANIM-012）。
- Web：路由层“继续阅读”；开书动画 P2。

#### VIEW-021 章节结束提示（EPUB）〔P2〕〔[浏览器]〕
- 选项「在章节结束处显示提示信息」`chapterEndPrompt`（默认 false，开启后才出现在 Misc 列表里）。章末多画一行提示文字（`A.getChapterEndText`）。TXT 另有「TXT书籍在新的一页显示下一章节」`txtChapterSplit`（TTS/自动滚屏/拖动时不生效）。

#### VIEW-022 章边界“下拉/上拉换章”手势 〔P1〕〔[浏览器]〕
- 行为：仅「无翻页动画」模式、非双页、未开「触碰屏幕时禁止页面上下滑动」时。当滚动已到章首仍继续向下拖（或章尾仍向上拖）时，在屏幕顶部/底部居中出现一个 40dp 圆形进度环（`ProgressWheel`，色=字色 alpha −150，线宽 4dp），弧长 = `|拖动距离| × 6 / density` 度，满 360° 时松手触发换上一章/下一章（并预载前一章）；书首/书尾无效。
- 出处：`AT.checkMovingToChangeChapter(2488)`、`showMovingChangeChapterState(16354)`、`components/ProgressWheel.java`。
- Web：pointer events 过拉检测 + SVG 弧。

#### VIEW-023 取色器 ColorDialog 〔P1〕〔[浏览器]〕
- 结构：HSV 色盘 + 亮度渐变条 + 四个 SeekBar（Hue/Saturation/Value，可选 Alpha）+ R/G/B 数值框 + HEX 输入（`#RRGGBB`，带 alpha 时 `#AARRGGBB`）。用于文字颜色（带 alpha）、背景颜色（强制不透明 `deleteAlphaOfColor`）、状态栏颜色等。选背景色后会按 `checkFontColor` 自动在深浅色文字之间切换：背景亮度<126 且字色亮度<126 → 字色换成上次的浅色（默认 `#F4F4F4`）；背景>126 且字色>126 → 换成上次的深色（默认 `#333333`）。
- 出处：`components/ColorDialog.java`、`PrefVisual.checkFontColor`。
- Web：`<input type=color>` + 自绘 HSV 面板。

#### VIEW-024 阅读页内提示面板 / 首次提示 〔P2〕〔[浏览器]〕
- `tips_panel` 显示 `assets/tips_autoscroll.png`（自动滚屏手势图：单指上下拖=滚屏速度；双指上下拖=移动；单击=暂停/继续；横划=停止，见 AUTO-001）或 `tips_tts.png`，带「不再提示」复选。`showedReaderClickTip`：第一次进阅读页会弹点击区域示意（ClickTip，见 CTRL-013）。

### 2.2 TYPO：排版与文字渲染

#### TYPO-001 字体样式 〔P0〕〔[浏览器]〕
- 文案/默认：文字大小 `fontSize`；字体名称 `fontName`（空=`serif`）；「字体加粗」`fontBold`(f)；「斜体」`fontItalic`(f，实现为 `TextSkewX=-0.25` 伪斜体，不是字体自带斜体)；「下划线」`fontUnderline`(f，点选后弹「实线/虚线」`dashUnderline`，默认虚线)；「字体阴影」`fontShadow`(f)；「平滑」`fontAnti`(t)。
- 阴影：深色字 → 1dp×1dp 偏移、半径 1dp、颜色 `#AA888888`（`-1433892728`，半透明灰）；白色字（`colorValue>355`）→ 黑色阴影；纯黑背景且白字则用灰色阴影（`-7829368`）以免被背景吃掉。
- 出处：`A.setTxtViewTypeface(10101)`、`setTxtViewShadow(10074)`、`PrefVisual.loadSettings`。
- Web：`font-weight`、`text-shadow`；斜体建议 `font-synthesis: style` + `transform: skewX(-14deg)`（−0.25 对应约 14°）；下划线用 `text-decoration-style: solid|dashed`。

#### TYPO-002 字体来源与选择 〔P0/P1〕〔[浏览器]/[服务端]〕
- 内置：`assets/fonts/` 4 个 TTF —— Arial.ttf(367 KB)、Calluna.ttf(99 KB)、Times New Roman.ttf(409 KB)、Vollkorn.ttf(61 KB)；系统字体族 `sans-serif/serif/monospace`；用户字体文件夹 `outerFontsFolder`（.ttf/.otf/.ttc，长按字体可重命名/删除）；EPUB 内嵌字体 `useCssFont`「使用书籍内置字体」(默认 true)，缺字时提示可安装。字体选择对话框 `PrefFontPick`：列表逐项用该字体渲染示例文本 + 底部可改字体文件夹路径 + 链接到「下载 xxx ttf」搜索。
- 状态栏字体独立设置（STATUS-002）。Calluna 在中文书里会导致首行文字显示不全（代码里有提示）。
- Web：`@font-face` + `FontFace` API；用户上传字体存 IndexedDB 或服务端；内置 4 个 TTF 的授权需确认（仅复刻时是否可用见 §7）。

#### TYPO-003 行距 〔P0〕〔[浏览器]〕
- 「行间距」滑条 −5…20，默认 3；`setLineSpacing(0, lineSpace/10 + 1)` ⇒ 行高 = 字体自然行高(ascent→descent) × (1 + lineSpace/10)，范围 0.5×–3.0×，默认 1.3×。
- Web：CSS `line-height` 要换算成无单位倍数，因为 Android 的“自然行高”约为 1.17–1.3em（随字体），建议 `line-height = naturalLH(font) × mult`，`naturalLH` 用 canvas `measureText` 的 `fontBoundingBoxAscent+Descent` 取；这是否与原版像素一致需实测（§7）。

#### TYPO-004 段间距 〔P0〕〔[浏览器]〕
- 「段间距」滑条 0–200%（步长 10，存值 0–20，默认 7 → 70%）。语义（`SHSL.out`）：段落之间的**空行**（长度<5 且全是空白的行，TXT 里 `\n\n`）剩余高度 = `行高 × paragraphSpace×10% − fontSize/7 dp`（行高含行距倍数；公式里实际是“被削掉的高度 = 行高×(100−paragraphSpace×10)%”，再多削 `fontSize/7`dp）；`paragraphSpace==10` 时不缩短（空行=整行高，不加 fontSize/7 削减）；`==0` 时空行只剩 8% 行高，而只含一个 `\n` 的行（`trimBlankSpace` 开启、`paragraphSpace==0`，或其前一字符不是换行时）高度直接坍缩为 0。开启「删除多余空格和空行」且段距>3 会被禁用并提示。EPUB 的段落 `margin/padding` 由 CSS 解析成 `MyMarginSpan`（见 TYPO-015），不受此项影响。
- Web：TXT 按“空行→`margin-block`”实现：`margin = lineHeight × paragraphSpace/10 − fontSize/7px`；EPUB 保持 CSS。

#### TYPO-005 字间距与字体伸缩 〔P1〕〔[浏览器]〕
- 「字间距」−4…20，`letterSpacing = fontSpace/20` em（−0.2…1.0em，默认 0）；「字体伸缩」−4…20，`textScaleX = fontScale/10 + 1`（0.6…3.0，默认 0 即 1.0）。
- Web：字间距直接 `letter-spacing: Nem`；字体伸缩无标准 CSS（`font-stretch` 仅对变量字体），可用 `transform: scaleX()` 作用在行内块（会影响排版宽度，难）或 canvas 绘制。建议字间距 P1、伸缩 P2。

#### TYPO-006 页边距 〔P0〕〔[浏览器]〕
- 「左/右/上/下边页面空白」0…`MAX_MARGIN`（手机 200 / 平板 300 / 超大平板 400，单位 dp），分别可调。默认值（`set_default_Margin`）：手机 左右=20dp（全面屏 24、大屏手机 26），上下=20dp（全面屏 30），**上边距 ×12/9**；平板 左右=短边/12，上下=50dp。全屏且显示透明系统栏时顶部再加 75% 状态栏高度；刘海屏适配时加刘海高度。开启断字时右边距会减去半个“?”宽度以补偿断字符。
- 出处：`A.set_default_Margin(10221)`、`setMarginLimitation`、`setTxtScrollPadding(10056)`、`A.getTopMargin(6370)`。
- Web：容器 padding；改边距要重排并保持字符锚点。

#### TYPO-007 两端对齐 〔P0〕〔[浏览器]〕
- 「两边对齐」`textJustified`（默认 = 系统语言为中文）。算法（`MRTextView.getWordSizes`）：把一行拆成“词”（CJK 逐字），先量出自然总宽 L；若行宽 W < L（超宽）依次尝试把 `textScaleX` 压到 0.98/0.95/0.9/0.85 以塞下；否则把富余宽度 `(W − L − (非CJK ? 1dp : 0)) / (词数−1)` 均分到每个词间隙；CJK 模式下若 L < 50% W（短行/段末行）不拉伸。开启断字时自动同时开启两端对齐。
- 出处：`MRTextView.getWordSizes(2716)`、`PrefVisual.justitifedOptionClick`。
- Web：`text-align: justify; text-justify: inter-character`（CJK）/ `inter-word`；段末行默认不拉伸（`text-align-last: start`）。

#### TYPO-008 段落首行缩进 〔P0〕〔[浏览器]〕
- 「段落首行缩进」`indentParagraph`（默认 = 中文）+ 齿轮「首行缩进字数」`indentLength` 0…4（默认 2）；缩进宽度 = `desiredWidth("一") × indentLength`；开关后，TXT 段首可补全角空格 `U+3000`（`INDENT_CHAR`）；标题标签 `<h1-h6>` 也会被排除/包含（`isHeaderTag`）；与 CSS 的 `text-indent` 冲突时由「禁用缩进符」选项决定（TYPO-015）。
- Web：`p { text-indent: Nem }`（因 `一` 的宽≈1em）。

#### TYPO-009 删除多余空格和空行 〔P1〕〔[浏览器]〕
- 「删除多余空格和空行」`trimBlankSpace`（默认 false）：在 HTML→Spanned 转换里连续空白/空段落折叠；与段距>3 互斥（提示）；拖动/自动滚屏时布局不同步压缩。
- 出处：`HtmlToSpannedConverter`(645/970/1190/1603/3958)、`MRTextView.java:2189,2619`。

#### TYPO-010 断字（Hyphenation）〔P1〕〔[浏览器] 或 [服务端]〕
- 「断字规则」开关（亚洲语言环境下隐藏）+ 「断字词典」下拉：列表 `array hyphenation_list`（27 项，首项 `*English`，代码表 `array hyphenation_code`：en,bg,cs,da,nl,de,el,eo,es,fi,fr,hu,id,it…）；apk 内实际带词典文件的 22 种（`assets/hyphenation/`：bg cs da de el en eo es fi fr hu id it lt nb nl pl pt ru sv tr uk）。列表里多出的语种是否有文件未核对（§7）。文件是 TeX 断字模式（`SHTextTeXHyphenationPattern`，由 `SHTextTeXHyphenator.load(lang, assets)` 读取），断字位置在行尾加连字符；开启后强制开启两端对齐、取消 CJK 模式。
- 出处：`A.setHyphenation(9985)`、`staticlayout/SH*`、`PrefVisual.pvHyphenation`。
- Web：CSS `hyphens: auto` + `lang`（依赖浏览器内置词典，质量不一）；要与原版一致需复用 apk 的 TeX 模式文件在 JS 里自己断字（Hypher/hyphen 库，需写转换器）。

#### TYPO-011 中文/东亚排版（textCJK）〔P0〕〔[浏览器]〕
- 「中文书籍排版」`textCJK`（默认 = 中文环境，仅亚洲语言环境显示）：开启时按字（而非按词）折行，`SHSL` 里对标点做避头尾（`isLeftQuote/isRightQuote/isLineEndDot` 字符表：`“‘„([{«‹¿¡《〈（「` 不可在行尾；`”)>»›》〉）」]}` 与句末标点不可在行首等），开启后同时打开两端对齐并关闭「紧凑模式」。「汉字简繁转换」下面另述。
- 出处：`A.textCJK`、`SHSL.isLeftQuote/isRightQuote(169-182)`、`PrefVisual.pvCJK`。`SHSL` 7.8k 行完整规则未逐条核对（§7）。
- Web：`line-break: strict; word-break: normal; text-align: justify; text-spacing-trim: space-first`（Chrome 123+）；`hanging-punctuation` 仅 Safari。需实测避头尾覆盖面。

#### TYPO-012 紧凑模式（Dense）〔P2〕〔[浏览器]〕
- 「紧凑模式」`textDense`（需 CJK 开启且非韩文）：每行尽量塞更多字符：允许标点出现在行首、允许拆分标点组合，对「句号+引号」等组合占位压缩（文案 `text_dense_tip`）。

#### TYPO-013 竖排 〔P2〕〔[浏览器]〕
- 「竖排模式」`verticalAlignment`（仅亚洲语言环境显示）：`MRTextView` 里 `vDrawText` 逐字旋转/排布；日文时对图片有特殊处理，ruby 注音位置也不同；旧版字体（含非 ASCII 名）走 `vertOld` 路径。
- Web：`writing-mode: vertical-rl` + 横向翻页（页向左增长）；CSS 多栏在竖排下方向要反转，工作量大，P2。

#### TYPO-014 汉字繁简转换 〔P1〕〔[浏览器] 或 [服务端]〕
- 两个互斥选项「汉字简繁转换」(简→繁)、「汉字繁简转换」(繁→简)，开启时弹问「是否同时转换常见词汇? 比如 公文包->公事包 / 贝克汉姆->碧咸」（`jianFanWord/fanjianWord`，一对多字 如“发”可能判断不准）；库 `com.luhuiguo.chinese.*`（含拼音）+ `components/ChineseJianFanConvert`；转换发生在文本送进 `MRTextView` 之前（`A.chineseJianFanConvert`）。
- Web：OpenCC-js（词表 + 字表）；大书可在服务端预转换；注意不影响搜索/书签的字符偏移（偏移要以原文为准）。

#### TYPO-015 书内 CSS 处理与「禁用 CSS」 〔P0/P1〕〔[浏览器]〕
- 总开关 Misc「禁用电子书内置的CSS样式表」`disableCSS`：勾选时弹多选框（`array disable_css_styles`，8 项独立开关）：①禁用字体类型(粗体/斜体/下划线)=`cssFontStyle` ②禁用字体大小(小/大/em指定)=`cssFontSize` ③禁用指定颜色(文本及背景)=`cssFontColor` ④禁用对齐排版(左/中/右)=`cssAlignment` ⑤禁用对齐排版(全书左右对齐)=`cssJustify` ⑥禁用缩进符(px/pt/em/in)=`cssIndent` ⑦禁用段落间隔(margin/padding)=`cssLineSpace` ⑧禁用其他属性(表格/边框/背景图/浮动等)=`cssOthers`。`disableCSS` 的值 = 8 项任一为真。默认全 false；但 `cssJustify` 载入默认 **true**（`getBoolean("cssJustify", true)`，与其他项不同）。
- 注意：8 个子开关只有在总开关 `disableCSS` 为 true 时才生效（代码都是 `!disableCSS || !cssXxx` 才解析该属性）；`cssJustify` 载入默认 true 只是“首次勾选禁用 CSS 时该项预勾选”的效果。
- 默认行为：书内 CSS **被采纳**，再被用户字号/颜色/字体/对齐等覆盖到何种程度由上述开关决定（即默认让书的 CSS 起作用，用户设置作为默认值）；用户设置的行距/缩进/两端对齐若被书 CSS 覆盖，改设置时会弹提示（`css_justified_tip`/`css_margin_tip`/缩进同理）引导去关闭对应 CSS 项。
- 另外：`useCssFont`「使用书籍内置字体」、`disableLinkColor`（链接颜色不用书中色）、`footnoteOnBottom`「在章节里直接显示注解内容」。`fb2.css`（assets，FB2 用户样式，可在 Misc 对 FB2 书「自定义CSS用户属性」）默认内容：`.epigraph{margin-left:25%;font-style:italic}` `.text-author{margin-left:4em;font-style:italic}` `.poem,.cite{margin-left:4em}` `.subtitle{text-align:center}` `p{text-indent:2em;margin-top:1em;margin-bottom:1em}` `h1–h5{text-align:left}` `.footnote{font-size:0.8em;background:rgba(126,126,126,.1);margin:.5em;padding:.5em;border:1px dotted #888;border-radius:10px}`。
- 出处：`PrefMisc.do_SetCSS(971)`、`components/CSS.java`(`Style` 解析于 960-1130)、`HtmlToSpannedConverter`(628/923/1332/1573/2166/2235)。
- Web：EPUB 用 DOM 原样渲染 + 注入覆盖样式表；8 个开关对应 8 条 `!important` 覆盖规则（如 ① `* {font-weight:inherit!important;font-style:inherit!important;text-decoration:none!important}`）。

#### TYPO-016 HTML/CSS 渲染能力清单 〔P0/P1〕〔[浏览器]〕
- `HtmlToSpannedConverter` 处理的标签：`p div span br hr h1-h6 b strong i em u s strike del small big sub sup tt code kbd pre cite dfn font a img image ruby rb rt rp ol ul li dl dt dd blockquote table tr td th center figure figcaption section aside nav video audio` 等；`CSS.Style` 解析属性：`font-weight/style/size/family`、`color`、`background-color/image/position`、`text-align`(含 justify)、`text-indent`、`text-decoration`、`text-shadow`、`-webkit-text-fill-color`、`text-emphasis-style`(着重号)、`vertical-align`、`margin*/padding*`、`border*(+radius)`、`float`、`display`、`list-style-type`、`page-break-after`、`white-space`、`width/height`。样式匹配 `MyHtml.getClassStyle`：支持 `tag`、`.class`、`tag.class`、`#id`、空格分隔的后代选择器（`secFitPriorTags` 检查祖先标签/类，含 `body x`），按特异性合并，结果按章缓存（`css.cacheStyles`）；子选择器 `>`、属性选择器、伪类/伪元素未见处理（§7）。
- 特殊渲染：浮动图/文字（`MyFloatSpan`，含**首字下沉**：对 `float:left` 的首字符计算 `float_width/height` 并标 `isDropcap`，占位 ≥2dp 右边距）；表格（`MyTableSpan`，表格超出页宽时右下显示放大图标 `isTableZoomIcon`，点开独立查看）；项目符号（`MyBulletSpan`）；上下标；注音 ruby（`<ruby><rb><rt>` 与 `MyHtml.Ruby`，TXT 里 `《》` 日文注音由 `JpRubyTxt` 转换）；着重号；`<hr>`；图片（`MyImageSpan`，点击全屏浏览，`fitImageToScreen/imageWhiteTransparent` 等图片选项在 Misc「图片相关选项」）；`<audio>/<video>` 以图标 span 呈现并调起 `MediaAct/mp3 播放条`。
- Web：直接用浏览器渲染 DOM；首字下沉 `p::first-letter{float:left}` / `initial-letter`；ruby 原生支持。

#### TYPO-017 TXT 专有：编码、章节分割、新章换页 〔P0〕〔[服务端]〕
- 「文字编码」下拉（`R.array.charsets`，约 50 项：AUTO, UTF-7/8/16/16BE/16LE/32/32BE/32LE, US-ASCII, BIG5, CP864/866/874, EUC-CN/JP/KR, GBK, GB2312, KOI8-R, SHIFT-JIS, x-JIS7/8, Macintosh, ISO-8859-1…16, ISO-2022-JP, Windows-950/1250…1255 等），保存到 `file_encoding` 偏好，更换立即重新读取；默认 AUTO（亚洲语言环境）/UTF-8。TXT 章节标题识别归他人（解析）。`txtChapterSplit`「TXT书籍在新的一页显示下一章节」。
- Web：编码探测与转码放服务端（`chardet`/`iconv`）。

#### TYPO-018 链接/批注颜色 〔P2〕〔[浏览器]〕
- Misc「链接颜色」`linkColor/linkVisitedColor`（日夜各一套）：默认链接 `#6060E4`，已访问 `#999999`；「标注弹窗颜色」`noteTextColor`(默认 `#111111`)、`noteBackColor`(`#F6EA8C`)（脚注弹窗，日夜各一套）。
- 出处：`CSS.LINK_COLOR(20)`、`A.DEFAULT_NOTE_*`。

#### TYPO-019 字号相关杂项 〔P1〕〔[浏览器]〕
- 双页字号微调 `dualFontSizeAdd`(±，默认 0)，字号输入的数值选择器 `NumberPicker`（整数位 + 小数位）；`getDualFontSizeAdd` 仅双页生效；字号保存为浮点。

### 2.3 THEME：主题、配色、背景

#### THEME-001 主题数据模型、14 套主题、加载规则 〔P0〕〔[浏览器]〕
- 主题 = 一个 XML（SharedPreferences 格式，文件名 `theme_<名称>.xml`）。首次安装时把 `assets/themes/*.xml` 复制到应用目录（`extractThemesFromResource`，仅当不存在 `theme_Day Theme.xml` 时）；随后首次启动再用当前默认边距/字号覆盖 Day/Night Theme 并保存。列表顺序：`Day Theme`、`Night Theme`，其余按文件名 ASCII 排序（含 `.` 的名字排在最后），再追加临时主题 `circle_only`（不显示）。
- **缺省字段回退**：`PageTheme.loadFromXml` 对每个字段用当前全局值作默认，所以只写颜色的主题（Day 1…pro 4）等于“只改颜色”；只有 `pFontName` 存在且≠"false" 的主题（Day/Night Theme 例外）才视为「带字体样式」（`emptyFontStyle=false`）。
- **载入**：`loadTheme(name, colorOnly)`：总是载入 `pFontColor/pBackgroundColor/pBackgroundImage/pUseBackgroundImage`；仅当 `!colorOnly && !loadThemeWithColorOnly && !emptyFontStyle` 时才载入字体名/字号/边距/行距/段距/字距/伸缩/粗斜体下划线阴影等。`loadThemeWithColorOnly` 载入默认 **true**（对话框勾选「只更改颜色配置」）。
- 完整格式、字段与 14 套取值见 §5。
- 出处：`A.PageTheme(967)`、`A.getThemeList(6392)`、`A.loadTheme(9135)`、`A.extractThemesFromResource(3322)`、`PrefTheme`。

#### THEME-002 日夜一键切换（按钮 1 / 动作 7 / 长按菜单）〔P0〕〔[浏览器]〕
- 行为（`cycleThemes`）：比较当前主题哈希（`getCurThemeHash`：字体颜色 + 背景色/图 + [非只改颜色时] 字体/字号/边距…）与 Day/Night 主题哈希：
  - 当前既非 Day 也非 Night（自定义主题）→ 先把当前保存为临时主题 `circle_only`（若该书没有专属主题）→ 载入 Night Theme；
  - 当前是 Night → 载入 Day；
  - 当前是 Day → 若该书有专属主题（主题名=书文件名）则载入该主题（若它等于 Day/Night 则载入 Night）；否则载入临时主题 `circle_only`（上次的自定义主题），若临时主题等于 Day/Night 则载入 Night。
  即在 `Day → (专属/临时主题) → Night`…循环。切换后 `A.mainNightTheme = isNightState(false)`，顶底栏/对话框随之变夜间色，系统导航栏变色（`setNavigationBarColor`），并清除翻页缓存。
- 长按菜单：白天主题 / 晚上主题 / 读取配色方案... / 保存为配色方案...（均走「只改颜色」）。
- 出处：`AT.cycleThemes(3287)`、`clickDayNightButton(2773)`、`doDayNightLongTap(3667)`。

#### THEME-003 主题管理对话框 〔P1〕〔[浏览器]〕
- 「读取配色方案」：网格（格宽 150dp 高 120dp），每格用该主题的背景（图/色）+ 字色 + 字号 + 字体渲染主题名；底部复选「只更改颜色配置」`loadThemeWithColorOnly`、「自动日夜模式切换」`autoTheme`（旁边齿轮 → THEME-004）、「跟随系统深色模式」`sysDarkModeFollow`（Android 10+ 才显示）。点格 = 载入并关闭。
- 「保存为配色方案」：输入名称（`deleteSpecialChar` 去特殊字符，空→提示「theme_name_error」），已存在则确认「xxx 已存在, 是否覆盖?」。默认名 = 当前书文件名（这就是“书籍专属主题”的来源，`A.getThemeOfBook`）。首次修改颜色后弹一次提示（`saveThemeHint`）。
- 长按主题格：改名 / 删除 / `─> 白天模式`(把此主题设为 Day Theme) / `─> 晚上模式`。Day/Night Theme 不可改名/删除（提示「该项名称不允许改动」「该项不允许删除」）。
- 出处：`PrefTheme.java`、`A.saveTheme(9660)`、`A.deleteTheme/renameTheme(2912/9538)`。

#### THEME-004 自动日夜切换（定时）〔P1〕〔[浏览器]〕
- 文案：「自动日夜模式切换」；对话框含「白天模式 (执行条件: 上次阅读是在晚上)」开关+生效时间+「新亮度」；「晚上模式 (执行条件: 恢复阅读)」开关+生效时间+新亮度。默认：白天 06:00(`autoThemeDayTime=600`)、亮度 10；晚上 22:00(`2200`)、亮度 1；两项默认启用，「设置亮度」复选默认 false。
- 逻辑（`setAutoThemeHandler`，在恢复阅读时调用）：以今天的 [白天时刻, 17:00) 为白天窗口且“上次阅读时间不在 5–17 点”→ 切 Day；晚上窗口为 [夜间时刻, 次日 05:00) → 切 Night；切换时若勾选「设置亮度」则把亮度调到设定值（白天只在当前亮度小于设定值时提高；夜间只在大于设定值时降低），否则亮度恢复自动。
- 出处：`AT.setAutoThemeHandler(15378)`、`PrefTheme.autoThemeOption`。

#### THEME-005 跟随系统深色模式 〔P1〕〔[浏览器]〕
- `sysDarkModeFollow`；首次检测到系统深色时弹窗「跟随系统深色模式?」带「不再提示」。切换时载入 Night/Day Theme 并更新 `mainNightTheme`。与自动日夜互斥。
- Web：`matchMedia('(prefers-color-scheme: dark)')` + 监听 `change`。

#### THEME-006 背景：纯色 / 图片 / 透明度与模糊 〔P0/P1〕〔[浏览器]〕
- 「背景颜色」(颜色块)、「背景图片」(缩略图)，二选一显示（`useBackgroundImage` 决定当前哪个生效，选择器旁有选中标记）。背景图选择列表 = 应用 assets/background 全部 33 个文件（文件名去扩展名作 id）+ 用户文件夹图片（`outerImagesFolder`），§5.3 有清单。
- 渲染：位图宽、高**均 < 100px** → 平铺（`REPEAT`）；否则**拉伸铺满**（FIT_XY，不保持比例）。图片找不到 → 退回纯色。
- 「透明度」(隐藏入口，`transparency` 视图 gone)：背景图 alpha 0–255、模糊半径 0–`getMaxBlur`（Blurry 库 `components/blurry/*`，INNER 模糊），结果存文件 `getImageAlphaFile`，重置=255/0。
- 选背景自动调字色见 VIEW-023。纯黑背景（`#000000` 且非图片）时双页书页背景不画（`isPureBlackBackground`）。
- 出处：`A.setBackgroundImage(9757/9771)`、`setBackgroundDrawable(9721/9741)`、`A.getBackgroundImages(4028)`、`PrefVisual.setBackgroundAlpha`。
- Web：CSS `background-image` + `background-size: 100% 100%`（大图）/`background-repeat: repeat`（小图）；模糊/透明用离屏 canvas + `filter: blur()`。

#### THEME-007 文字颜色与界面夜间色 〔P0〕〔[浏览器]〕
- `fontColor` 默认 `#1B211E`，`backgroundColor` 默认 `#E6EACF`（读取时强制 alpha=255）。夜间判定 `A.isNightState()`：`mainNightTheme || lastTheme=="Night Theme"`；`isWhiteFont(color)`：R+G+B>355；`isWhiteFont2`：>200（亮度判断用，驱动阴影色、状态栏图标亮/暗、书页背景、选中色等）。
- 浮层颜色：顶栏日 `#1E88E5`/夜 `#505050`；底栏日 `#E0E0E0`/夜 `#424242`；对话框夜间背景 `#505050`、分隔 `#666666`；亮度面板日 `#909090`（夜或白字 `#323232`）。
- 出处：`A.isNightState(8834)`、`isWhiteFont(9071)`、`A.setDialogNightState`、`AT.getTopBarColor/getBottomLayColor`。

### 2.4 ANIM：翻页动画

#### ANIM-001 动画类型总览与速度 〔P0〕〔[浏览器]〕
- 选项「翻页动画」`flip_animation`（`PrefVisual.getNewFlipAnimations`，序号=值）：0 无 / 1 (Apple) 纸张翻页效果 / 2 (Google) 纸张翻页效果 / 3 水平切换 / 4 上下滚动 / 5 渐隐式 / 6 左右覆盖 / 7 上下覆盖；旁边 8 个缩略图可直接点选（`flip0…flip7`）。选非“无”时出现「翻页速度」滑条 `flipSpeed` 0–50，默认 30（Kindle 为 20），提示 toast 显示数值；「重置」恢复默认。选 1/2/3/6 且当前点击区为“上下模式”时自动切为“左右模式”并弹提示（`toggleTapModeForFlip`）。
- 默认 `flip_animation=flip_ebook=flip_pdf=0`。「允许左右划动屏幕翻页」时另有「水平滑动翻页动画」`hori_fling_animation`（见 ANIM-010）。
- 各类型的触发方式：1/2/3/6 支持**手指跟随拖动**；4/5/7 只在翻页动作（点击/按键/横划手势/垂直手势 `isShiftGesture`）后播放动画；0 无动画，竖向拖动即滚动。
- 出处：`PrefVisual.getNewFlipAnimations(201)`、`A.isFlipCurl/isFlipHorizShift/isFlipVerticalShift/isFlipNone(8653-8672)`、`A.set_default_flip(10297)`。

#### ANIM-002 无翻页动画（滚动）〔P0〕〔[浏览器]〕
- `isFlipNone = (flip_animation == 0 || >7)`：手指拖动 ScrollView 滚动 + 惯性 fling（自带 fling 逻辑 `MySimpleGesture.onFling`：`distance = v² / (2·mDeceleration)`，`mDeceleration = density·160·386.0878·scrollFriction`；若估算滚动距离超过整章高度一半则限速；TXT 在靠近块边界时先重组前/后块再继续 fling）。松手后不自动对齐到行首；点击翻页是“整行跳转”（VIEW-001）。「触碰屏幕时禁止页面上下滑动」`disableMove`(false) 关闭拖动滚动；「允许左右划动屏幕翻页」`allow_scroll_horizontally`(默认 true) 允许横划翻页（速度>600px/s 且水平为主）。
- Web：原生滚动 + `scroll-snap`（可选）；翻页 = `scrollTo({top, behavior:'instant'})` 到整行。

#### ANIM-003 (Apple) 纸张翻页（iBook 仿真翻页）〔P0〕〔[浏览器] WebGL〕★最难
- 视觉：一张页面纸沿拖动方向卷成半圆柱（半径随拖动距离变化），圆柱前半段显示正面，翻过去的背面显示页面镜像（单页模式：同一张当前页图镜像、0.9 alpha、并按页面平均色着色，模拟纸张透字；双页模式：显示对面那一页），卷曲处有明暗渐变，卷曲线下方有投影，背面圆柱折返处有自阴影。使用正交投影，没有透视。
- 点击翻页 = 用 4 个合成触摸事件模拟一次拖拽（从底部角落拉起），再自动补完动画；松手后根据位置/速度决定完成或回弹。
- 算法、参数、阴影、动画曲线见 **§4.3**。
- 出处：`NC3D`(`Mesh3D.curl ~549`、`drawiBook ~707`、`Render3D 1024`、`updateCurlPos 1745`、`setCurlPos 1582`、`startCurl 1666`、`pageScroll 1877`、`simulateOnTouchLock 2012`、`initObserver3D 1464`)、`AT.handleCurlMessage(7773)`、`get3dCurlShot(6477)`、`get3dFlipSpeed(6584)`。
- Web：WebGL1（页面 canvas → `texImage2D`），顶点 ≤ 约 40 个（每帧重算），逐帧 `drawArrays(TRIANGLE_STRIP)`；Canvas2D 备选：把页面切成 N 条竖直窄条，每条做 rotate+scale 近似圆柱（质量下降）。

#### ANIM-004 (Google) 纸张翻页（Google Play Books 风格）〔P2〕〔[浏览器] WebGL〕
- 视觉：整页作为 50 段的条带网格，用贝塞尔曲线弯成 S 形（无圆柱），带透视（相机 FOV 横屏 30°/竖屏 45°），页面右缘一块 3 段阴影网格。拖动时位置 t 由水平位移累积；松手后向 0 或 ±1 动画。
- 公式与常量见 **§4.4**。出处：`components/GoogleBook.java`、`NC3D.Render3D.onSurfaceChanged`。

#### ANIM-005 水平切换（push，flip_animation=3）〔P0〕〔[浏览器]〕
- 视觉：新旧两页作为一整条一起水平平移（旧页被推出、新页被拉入），无阴影；**手指跟随**：拖动时两层（`scrollCache` 旧页 + `txtScroll` 新页）随手指移动并裁剪（`setClipPos`），松手后以「减速」曲线补完或回退。禁用页面上下滑动（`isDisableMovedFlips` = 3 或 6）。
- 动画：松手补完（以及**单页模式下的点击/按键翻页**，它们走同一条 `doValueFlip→startValueAnimation`，起点位移=0）时长 `valueDuration = (600 − flipSpeed·10) × 剩余距离/屏宽`（≥100ms；默认 30 → 300ms 满程）；曲线 `pos(t) = start + (end−start) × (1 − (D−t)^3 / D^3)`（三次减速，约 15ms 一帧）；位移不足 1dp 视为回弹。`FlipImageView` 的 type 3/6 分支只在**双页**（`isValueFlip` 要求单页且非 PDF）时使用，公式见 FlipImageView 描述。
- 出处：`AT.setValueAnimationPos(22569)`、`startValueAnimation(23973)`、`shiftAnimateWithTimer(15969)`、`ScrollView2.setClipPos/dispatchDraw`。
- Web：两层 `transform: translateX` + 手势跟随（pointer events）；松手用 CSS transition 或 rAF。

#### ANIM-006 左右覆盖（shift horizontally，flip_animation=6）〔P1〕〔[浏览器]〕
- 视觉：**向后翻**：当前页向左滑出，露出静止在下面的下一页，分界线右侧加一条竖向阴影（`shadow_l`）；**向前翻**：上一页从左侧滑入盖在当前页上，右缘带阴影。支持手指跟随拖动（同 ANIM-005 机制，但只有一层移动）；阴影宽度 20dp（density>2）否则 15dp，资源 `shadow_l2.xml`（渐变）。
- 单页模式点击/按键与拖动一样走“跟随”路径（时长同 ANIM-005）；双页模式用 FlipImageView 两张位图合成，时长 `800 − flipSpeed·10`（翻下一页再 −150ms），曲线：翻下一页 `pos = W·(t/T)^1.2`（先慢后快），翻上一页 `pos = W − W·((T−t)/T)^2.5`（先快后慢）。
- 出处：`AT.setValueAnimationPos(22569)`、`FlipImageView.onDraw(~540)`、`ScrollView2.drawVertShadow`。

#### ANIM-007 上下滚动（vertical push，flip_animation=4）〔P1〕〔[浏览器]〕
- 视觉：新旧两页一整条纵向平移；状态栏固定不动（`statusLay.draw` 在最上层）。只在页高范围内动（`A.getPageHeight`，不含顶/底 padding 以外区域，保留 `paddingTop` 偏移）。拖动触发：`isShiftGesture`（纵向位移>20dp 且横向<40dp）= 翻页一次，非跟随。
- 动画：FlipImageView，`frameStep=2.0`，`pos = H − H·((T−t)/T)^2`（先快后慢）。

#### ANIM-008 上下覆盖（shift vertically，flip_animation=7）〔P2〕〔[浏览器]〕
- 视觉：向后翻：当前页向上滑出盖住…（以代码为准：`rect3=[0,iPow,w,h]→[0,0,w,h−iPow]` 旧页向上移，下面新页静止并在分界下方加横向阴影 `shadow_b`/`shadow_b2`（夜间））；向前翻：上一页自上而下盖入。阴影高度同 shadow_width（15/10dp）。

#### ANIM-009 渐隐（fade，flip_animation=5）〔P1〕〔[浏览器]〕
- 视觉：旧页与新页交叉淡入淡出，`alpha_new = t/T`，`alpha_old = (T−t)/T`；时长 `800 − flipSpeed·10 + 100`ms。

#### ANIM-010 水平滑动手势翻页 + 垂直动画 〔P1〕〔[浏览器]〕
- 「允许左右划动屏幕翻页」`allow_scroll_horizontally`（默认 true）+ 齿轮「翻页动画」`hori_fling_animation`（默认 **手机 4（上下滚动）/ 平板 0**，列表同 ANIM-001）：只在当前 `flip_animation` 为“无”时作用——横划（速度>600px/s、水平位移>垂直位移、垂直位移<40dp）触发 `flingPageScroll` 翻页并按此动画播放；在竖向动画 4/7 下，横或竖向快速划动（任一方向速度>600、另一方向位移<40dp）都可翻页。

#### ANIM-011 翻页声音 〔P2〕〔[浏览器]〕
- 「翻页声音效果」`pageSound`（默认 false）+ 齿轮选 `翻页声音 1–5`（选第 6 项为自选文件 `pageSoundFile`，选中即试听）；资源 `res/raw/sound0.ogg…sound4.ogg`；打开页面声音时，在阅读栏可见状态下音量键用于调音量而非翻页。出处：`A.playPageSound(9375)`、`PrefMisc.pmSetSound`。
- Web：`new Audio(ogg)`（Safari 不支持 ogg → 转 m4a/mp3）。

#### ANIM-012 打开书动画（FlipImageView type −100）〔P2〕〔[浏览器]〕
- 封面全黑底上左右半页向两侧分开（`isPageDown` 时分开 / 否则合拢），时长 `600 − flipSpeed·10` ms，`speedType=2`（`pos = W/2·(t/T)^2`）。仅 Pro+仿真翻页+非横屏时启用。

### 2.5 CTRL：操控（点击、手势、键盘、传感器）

#### CTRL-001 点击区域（九宫格）〔P0〕〔[浏览器]〕
- 「控制选项 → 屏幕触碰事件」：`点击上面/下面`（上下模式）、`切换为左右模式`（复选 `toggleTapMode`）、`点击左边/右边`（左右模式）。`tapMode` 0–6，共 11 种示意图（`ClickTip` 画廊 11 格：模式 0–3 各有“上下/左右”两版 = 8 格，模式 4–6 无左右版 = 3 格）。默认 `tapMode=1` + 左右模式。
- 判定与每种模式的格子划分见 **§4.5**（已逐条从 `A.clickArea` 推出）。区域结果 0=中间(呼出/收起菜单)；1=上；2=下；3=左；4=右。每个区域绑定一个“动作”（CTRL-002）：默认 上/左 = 向上翻页(0)，下/右 = 向下翻页(1)。
- 点击成立条件（`onTouch` ACTION_UP 路径）：按下到抬起 <800ms（`ONTOUCH_IGNORETIME`；WebView 200ms）、移动 <10dp、触点数 ≤20、且距上次 fling 结束 >500ms；两次 tap 间隔 ≥100ms。点击时若菜单栏已显示则先收起（且“中间”之外的区域点击也会先收起菜单再执行动作）；自动滚屏中点击 = 暂停/继续；朗读中点击 = 暂停/继续（上下左右映射到朗读的翻页）。
- 出处：`A.clickArea(2253)`、`AT.do_TapUp_Event(5287)`、`doTouchDown(18261)`、`ClickTip.java`。
- Web：pointer events，按容器宽高比例判定；高亮示意（ClickTip）用半透明覆盖层。

#### CTRL-002 动作列表（26 项，所有“可绑定”入口共用）〔P0〕〔[浏览器]〕
- 下拉列表（`R.array.controls` + `PrefControl.setSpinnerList` 追加 7 项）：
  0 向上翻页 Page Up / 1 向下翻页 Page Down / 2 上一文件 Prior File / 3 下一文件 Next File / 4 搜索 Search / 5 书签 Bookmarks / 6 显示书籍信息 Book Information / 7 改变配色方案 Change Theme / 8 打开选项菜单 Options Menu / 9 打开导航菜单 Navigate Menu / 10 字体大小调节 Font Size Bar / 11 显示章节目录 Show Chapters / 12 前一章节 Prior Chapter / 13 下一章节 Next Chapter / 14 返回书库 Back To Book Shelf / 15 无 None / 16 退出整个程序 Close Moon+ Reader / 17 页面文字摘录 Text Selection / 18 自动滚屏 Auto Scroll / 19 朗读 Speak (Text-to-speech)（Pro）/ 20 亮度调节 Brightness / 21 可视选项 / 22 控制选项 / 23 其它选项 / 24 向上滑动 Page move up（上滚一行）/ 25 向下滑动 Page move down（下滚一行）。
- `doEvent(i)`：15 返回 false(无动作，事件继续向下传)；其余执行并返回 true。`doEvent2(5)`=直接给当前位置加书签。24/25：到顶则翻上一页/到底则翻下一页，否则按当前首行的行高滚一行。
- 出处：`AT.doEvent(18013)`、`do_move_up/down(5718/5738)`、`A.DO_*` 常量(A.java:185-210)。

#### CTRL-003 长按屏幕 〔P0〕〔[浏览器]〕
- 「长按屏幕」`doLongTap`（默认 17 = 页面文字摘录/文本选择），「长按事件激活时间(秒)」`longTapInterval` 默认 0.4（最小 0.05）。可改绑任意动作（CTRL-002）。文本选择后的流程归他人。

#### CTRL-004 滑动手势 〔P2〕〔[浏览器]〕
- 「屏幕划动手势」四个方向：从右向左/从左向右/从上向下/从下向上，默认全 None(15)。判定（`do_Gesture_Event`，仅在 ACTION_UP 且触摸起于文字区）：横向位移 > min(屏宽/2, 400px) 且纵向位移 <120px → 左→右(`doSwipeLeftToRight`)/右→左；纵向位移 > min(屏高/2, 400px) 且横向 <120px → 上→下/下→上。若左右分别绑 3(下一文件)/2(上一文件)，首次触发会弹确认框「swipe_gesture」带“不再询问”，取消则两者重置为 None。

#### CTRL-005 键盘/硬件键映射 〔P0〕〔[浏览器]〕
- 「硬件按钮」：主页键/返回键/菜单键/搜索键/摄像头键/音量加/音量减/方向键 上下左右中/耳机按键/播放下一首/上一首/暂停；每项可绑任意动作。默认：音量加=向上翻页(0)，音量减=向下翻页(1)，方向键上=0，下=1，左=12(前一章节)，右=13(下一章节)，中=8(选项菜单)，搜索键=4，其余=15（None）。
- 行为细节：菜单栏显示时音量键、方向键交给界面（不执行翻页）；自动滚屏中音量键=翻一页（不终止）；朗读中音量键透传；音量动作 20=亮度±1；「返回键」优先级：关闭弹窗/提示/选择点/字号面板/亮度面板/搜索面板，再停自动滚屏/朗读，最后 `doBackKey`（默认 None → 退出阅读器）；「菜单键」默认 None 时 = 呼出/收起顶底栏。
- Web 映射建议：PageUp/空格/↑/←(上一页)；PageDown/↓/→(下一页)；Home/End；Enter=中（选项）；Esc=返回；Ctrl+F=搜索；音量键在网页不可用（移动端无法捕获）；耳机/媒体键用 Media Session API (`nexttrack/previoustrack/play/pause`) P2。
- 出处：`AT.doKeyDown(18118)`、`onKeyDown(20291)`、`onKeyUp(20385)`、`A.set_default_Do_Events(10169)`。

#### CTRL-006 多点触控缩放字号 〔P1〕〔[浏览器]〕
- 「允许用多点触摸改变字体大小」`mult_touch`（默认 false）：双指开合，`fontSize += (Δ距离 / 20dp)`（>2 指时缩小 10 倍），范围 `minFontSize…maxFontSize`，过程中 toast 当前字号；仅在不在边缘滑动区、非 PDF 时。WebView 渲染另有 1–72 的字号。
- Web：Pointer Events 双指距离，去抖重排。

#### CTRL-007 屏幕边缘滑动调亮度/字号 〔P1〕〔[浏览器] 部分〕
- 「擦动屏幕左边沿调节屏幕亮度」`adjustBrightness`（默认 true，齿轮选哪条边 `brightness_edge`=左0/右1/上2/下3，默认左；还有 LED/按键背光选项 `adjustLed/adjustNightLed/disableLedValue` 属旧机型功能，不做）；「擦动屏幕右边沿调节字体大小」`adjustFontSizeAtSlide`（默认 false，`fontsize_edge` 默认右 1）。触发区宽度 40dp（平板 50/60，PDF 20），起点与当前点均需落在其内；手指**上滑变亮、下滑变暗**：每累计移动 ≥20dp 触发一次，步数 `= (1 + 滑动速度/f) × 移动距离/20dp`（`f`=上滑 500、下滑 400，速度上限 10000px/s，用 `VelocityTracker`），并有“≤2/1/0 时不跨过”的低亮度保护（值≤0 时每次只 −1）；字号上滑变大、下滑变小，每移动 ≥40dp 一次，单指 ±1.0、双指 ±0.1，夹在 `minFontSize…maxFontSize`。首次使用弹提示（`showAdjustBrightnessTip`）。
- 出处：`AT.do_AdjustBrightness_Event(5026)`、`do_AdjustFontSize_Event(5078)`、`getEdgeSize(6981)`。
- Web：亮度仅遮罩（VIEW-007）。

#### CTRL-008 摇一摇 / 倾斜翻页 〔P2〕〔[浏览器] 受限〕
- 「摇动手机」`doShakePhone`（默认 15）：加速度传感器；判定（`MyShakeSensorListener`）：采样间隔 >60ms，|Δx|>9 或 |Δy|>9 且“加权加速度”>500（二次>400），二次反向摇动在 500ms 内且反向分量>8 → 触发 `doEvent(doShakePhone)`，两次触发间隔 ≥2000ms。
- 「允许倾斜设备翻页」`tilt_turn_page`（默认 false，Pro）：以加速度 z 轴相对“基准 z”的变化判定，`tilt_forward`(默认 0=向下翻页)/`tilt_backward`(1=向上翻页)；灵敏度 `tilt_forward_sensitive`=1.0、`tilt_backward_sensitive`=1.2（对话框滑条 `43 − 值×10` 的 0–40 映射，范围 0.3–4.3）；需“先倾斜再回正”在 1s 内完成，两次间隔>300ms；静止 3 次采样后（>500ms）重设基准。
- Web：`DeviceMotionEvent`（iOS 需 `requestPermission()`，须 HTTPS 与手势）；仅手机浏览器有效，P2。

#### CTRL-009 耳机/媒体键 〔P2〕〔[浏览器] 受限〕
- 耳机键、播放暂停、下一首、上一首可绑定翻页等动作（Pro；Android 8+ 前后端点位不同）。朗读时耳机键用于暂停（`headsetForSpeaking`）。Web 用 Media Session API。

#### CTRL-010 状态栏点击/长按动作 〔P1〕〔[浏览器]〕
- 控制选项内「阅读状态栏」：点击左边/中间/右边、长按左边/中间/右边，各绑一个动作（CTRL-002）。默认：点左=6(书籍信息)、中=15、右=5(书签)；长按左=20(亮度调节)、中右=15。未绑定的区域不可点击。点击 `percentView`（底栏百分比）打开跳转对话框，点击标题打开书籍信息。
- 出处：`AT.do_floatBarButton(5556)`、`setStatusBarProperties(22382)`。

#### CTRL-011 触摸相关开关 〔P1〕〔[浏览器]〕
- `disableMove`「触碰屏幕时禁止页面上下滑动」(false)；`allow_scroll_horizontally`；`mult_touch`；`disableEdgeTouch`。以上在 Visual/Misc 中重复出现，同一字段。

#### CTRL-012 触摸事件总流程 〔P0〕〔[浏览器]〕
- 顺序：①记录用户活动/常亮刷新；②无动画且仍在播放时吞掉；③保存事件，边缘防误触；④记录亮度滑动速度；⑤自动滚屏/朗读时走专用处理（`auto_scroll_touch`/`speak_touch`）；⑥多点触控字号；⑦文本选择拖拽点；⑧仿真/跟随翻页（`doOnCurlTouch`）；⑨ACTION_UP：先判手势（CTRL-004）、再判 tap（CTRL-001）；⑩ACTION_MOVE：边缘亮度/字号 → 上下滑翻页(`isShiftGesture`) → 章边界下拉换章 → 交给 `GestureDetector`(fling)；⑪滚动。`pagingByMove` 标志防止一次拖拽触发多次翻页。
- Web：状态机用 pointer events 实现；与浏览器原生滚动冲突处用 `touch-action: none/pan-y`。

#### CTRL-013 点击区域示意（ClickTip）〔P2〕〔[浏览器]〕
- 控制选项「设置点击模式」按钮 `setTapMode` 与首次进入阅读页都会弹出：当前页截图作底，叠加 `tip11…tip53` 9-patch 示意图 + 各区的动作文字（上/左= 向上翻页，下/右=向下翻页，中=菜单），底部画廊可切换 11 种模式；点任意处关闭。
- Web：半透明蒙层 + 区域文字。

#### CTRL-014 跳转：章节、百分比、位置 〔P0〕〔[浏览器]〕
- 目录/章节列表（归他人）；底栏 ◀▶ 与动作 12/13 = 章跳转（TXT 用章节表 `getTxtChapters`，无章节时提示「没有下一章」`no_next_chapter`）；百分比跳转见 VIEW-003；「上一/下一文件」= 书架相邻书。位置表示：TXT 为字符偏移 `A.lastPosition`，EPUB 为 `lastChapter + lastSplitIndex + lastPosition`（章内偏移），保存到 `positions10` 文件并参与云同步（归他人）。

### 2.6 STATUS：状态显示

#### STATUS-001 迷你状态栏（阅读页底部）〔P0〕〔[浏览器]〕
- 文案/元素（`txtStatusLay`）：左 = 电池图标（内嵌电量数字，`BatteryTextView`：日 `battery.png`/夜 `battery2.png`）+ 时间（`HH:mm`，12 小时制 `use12Hour` 时 `hh:mm a`，中日韩把 AM/PM 放前面）；中 = 章节名 + ` (当前页/总页)`（TXT：`章节名 (n/m)`，`n/m` 用全书页数估算）；右 = 阅读百分比（`35.21%`，两位小数，满 100% 显示 `100%`）。三块可分别显示/隐藏：「显示电量|时间」`statusTime`(t)、「显示阅读章节」`statusChapter`(t)、「显示阅读进度」`statusProgress`(t)；总开关「显示小型阅读状态栏」`showStatusbar`(t)。
- 刷新：翻页/滚动后 ≥100ms 节流刷新；之外每 60s（全屏且显示系统栏时 30s）定时刷新。
- 页码：EPUB/HTML 章内 `total = floor(章高/页高)+1`、`current = floor(total × (scrollY + 页高/5) / 章高') + 1`（章高' 在章高/页高>2 时加 `oneLineTagHeight`/3 或 /2 的修正）；有拆块时按块字数折算成整章页数；到末尾 `current = total`；TXT 页数 = `getTotalPages()/100000`（全书折算）。
- 双页时中间栏变成两栏「n/m」「n+1/m」，章节名移到 `dualChapterTv`（页面上边/下边灰色小字）。
- 出处：`AT.showReadProgress(23330)`、`getPercentStr2(7198)`、`updateBarTime(17571)`、`T.getPercentStr/getPercentStr2/time`、`layout/show_txt.xml`。
- Web：DOM 栏；电池见 STATUS-004。

#### STATUS-002 状态栏设置 PrefStatusSetting 〔P1〕〔[浏览器]〕
- 选项：「状态栏放屏幕顶部」`statusBarOnTop`(f)、「(刘海屏)放刘海下面」`statusUnderNotch`(t)、「显示电量|时间」「显示阅读章节」「显示阅读进度」「12小时格式」`use12Hour`(f)、「使用自定义字体和文字颜色」`statusCustomizeFont`(f) → 展开「字体选择」`statusFontName`(默认 sans-serif)/「文字颜色」`statusFontColor`(`#222222`，不选自定义时跟随正文字色，时间 alpha−50)/「文字大小」`statusFontSize`(3–30，默认手机 10、平板 13 高分辨率)/「边框空白」`statusMargin`(0–100，手机 0，平板 2)/「背景颜色」`statusBackColor`(`#33333333` 半透明灰)。「重置」恢复。出现在 Misc「显示小型阅读状态栏」齿轮与控制选项里。
- 出处：`PrefStatusSetting.java`、`A.set_default_statusbar(10305)`。

#### STATUS-003 剩余阅读时间 〔P2〕〔[浏览器]〕
- 「显示当前书籍阅读剩余时间」`showRemainingTime`(f)，齿轮「合并显示到小型状态栏里」`remaingTimeInStatusBar`(f)。显示：「章节剩余时间: %d分钟」「整书剩余时间: %d小时%d分钟」。速度 = 本书已读字数/已读分钟（累计阅读>10 分钟才用本书数据，否则全局统计，否则默认中文 400 字/分、其他 220 词/分）。剩余字数由解析侧提供（`BaseEBook.getUnReadWordCountFrom`，EPUB 按章字数累加；TXT 按文件长度）。
- Web：统计阅读时长/字数（统计归他人）。

#### STATUS-004 电池与时间源 〔P2〕〔[浏览器] 受限〕
- Android 读 `ACTION_BATTERY_CHANGED` 的 `level`（或 `/sys/class/power_supply/battery/capacity`），无电量（模拟器等）则隐藏电池块。
- Web：`navigator.getBattery()`（仅 Chromium 系，Firefox/Safari 无）→ 不可用时隐藏；时间用 `Intl.DateTimeFormat`。

#### STATUS-005 顶部栏标题 / 进度文字联动 〔P1〕〔[浏览器]〕
- 顶栏标题随书型变化（见 VIEW-002）；底栏百分比拖动时即时显示；面板出现时 `showSeekBarProgress` 会把进度条同步到当前位置（TXT `位置/总长×1000`，EPUB 当前累计字数/总字数×1000，末页=1000）。

### 2.7 AUTO：自动滚屏与速读

#### AUTO-001 自动滚屏（6 种模式）〔P1〕〔[浏览器]〕
- 入口：底部按钮 3、动作 18、导航菜单「自动滚屏」；Misc「选择自动滚屏模式」`autoScrollMode`；`startAutoScroll`(false) 为启动时自动开始。首次点按钮若 `askForScrollEvent`(默认 true) 会弹「选择自动滚屏模式:」对话框（模式下拉 + 速度滑条 + 「不再询问」）；首次启动显示手势图（VIEW-024）。启动时关闭菜单栏、常亮；开始滚屏前若处于双页会先转单页（`resetPositionFrom2PageModeBeforeAutoScroll`，退出滚屏后再转回）。
- 模式（`array auto_scroll_mode` + `A.getAutoScrollModes` 追加「速读」）：0 卷帘式(像素)、1 卷帘式(按行)、2 按像素滚屏、3 按行滚屏、4 按页滚屏(有进度提示)、5 快速阅读（RSVP，见 AUTO-004）。
- 手势（`auto_scroll_touch`）：单指上下拖动 = 调速度（每 20dp ±1，范围 0–100，toast「滚屏速度: n%」，实时重设定时器）；单点 = 暂停/继续（再点一次，toast「暂停」）；横向拖动 >80dp = 停止（toast「滚屏已取消」）；双指 = 暂停并可移动页面。返回键 = 停止。音量键 = 翻一页（不终止）。
- 速度/间隔/步进公式见 **§4.6**。
- 出处：`AT.do_AutoScroll(5152)`、`do_AutoScrollAsk(5213)`、`do_autoscroll_message(5386)`、`startAutoScrollEvent(17047)`、`getAutoScrollInterval(6638)`、`AutoScrollTask(1730)`、`auto_scroll_touch(2292)`。
- 设置项：`autoScrollMode`(0)、`autoScrollSpeed`(50)、`startAutoScroll`(f)、`askForScrollEvent`、`askAutoScrollTip`。
- Web：`requestAnimationFrame` 计时 + `scrollBy`；卷帘用两张页面位图 + clip；按页滚屏顶部画 1px 进度线（色 `#AA666666`）。

#### AUTO-002 卷帘式滚屏渲染（rolling blind）〔P1〕〔[浏览器]〕
- 视觉：`ScrollImage` 画两张整页位图：下层 `page1Bm`（旧页）和上层 `page2Bm`（新页，仅绘制 `topLine` 以下区域），新页逐像素/逐行从页面顶部向下“铺开”；分界线处画 1px 字色(alpha −50) 横线（仅深色页）+ 8dp 高阴影图 `shadow_b/shadow_b2`。到达页底时 `autoScrollTurnPage` 截新页重新开始，书末则停止。
- 参数：像素式 `scrollPos += getPixelScrollSpace() × 55 / (55 − (speed<50 ? 50−speed : 0))`；按行式 `scrollPos = 下一整行行顶 − scrollY + paddingTop`。状态栏高度从页高中扣除。

#### AUTO-003 像素/整行滚动 与 按页滚屏 〔P1〕〔[浏览器]〕
- 模式 2（按像素）：定时器周期 `speed≥50 ? (speed−49)·10+20 : 20` ms，每次 `txtScroll.scrollBy(0, step)`，`step = speed<50 ? 50−speed : 1` px（例：speed=0 → 每 20ms 50px；49 → 20ms/1px；50 → 30ms/1px≈33px/s；100 → 520ms/1px≈1.9px/s），并在文末追加 `pageHeight/lineHeight/4` 个空行防止到底抖动；模式 3（按行）：定时器 100ms，计数 `count×5 ≥ speed` 时下移一行（周期 = ⌈speed/5⌉×100ms，speed=50 → 1 行/秒，100 → 1 行/2 秒）；到章底：EPUB 倒计时 3 秒（toast 3/2/1，速度>10 时）再翻章，TXT 直接翻页；模式 4：定时器 100ms，`f=(speed+20)/10`，`阈值=((f²/(f+5))×30×100)/((speed<50 ? (50−speed)×2 : 0)+100)`，计数达阈值则翻一页，顶部 2dp 进度线按 `宽×count/阈值+15` 增长。
- 出处：`AT.do_autoscroll_message(5386)`、`pixelAutoScrollLastLineHint(14399)`、`getSmoothAutoScrollStep(7320)`、`getAutoScrollInterval(6638)`、`AutoScrollTask(1730)`。

#### AUTO-004 速读 RSVP（PrefSpeedRead）〔P2〕〔[浏览器]〕
- 是什么：「快速阅读（RSVP）」，全屏（dimAmount 0.9）单词闪现：屏幕中央一个大字号文字区，按 WPM 逐词/逐词组刷新；点中央文字 = 开始/暂停；暂停时两侧出现 `<`/`>` 逐词前后移；底部“控制条”点屏幕任意处隐藏/显示：速度 `speedReadWPM`（WPM，50–2000，步长 10，默认 200）、字号 `speedReadSize`（10–100，默认 30）、每次显示词数 `speedReadWords`（1–10，默认 1）；右下进度 `n/总词数`；右上关闭。
- 取词：从当前位置起（TXT 取后续最多 50 万字符；EPUB 取本章；PDF 取本页），`MRTextView.getWords` 分词（CJK 逐字/词，英文按空格），合并孤立左引号/标点（`END_PUNC=,.;?:!，。；＂”：？）、！’` 与右标点黏到前一词），多词模式按 `词数×(60000/WPM)` ms 展示，宽度放不下则提前截断；单词模式：词长>10 额外 +min(½基准,100)ms，以 `.;?!。；？！` 结尾也 +同值（停顿）。读到末尾：TXT/末章停止，EPUB 自动换下一章继续；退出时把阅读位置推进到速读到达的位置，并累加阅读时间/字数统计。
- 出处：`PrefSpeedRead.java`、`AT.doSpeedRead(4891)`、`A.speedRead*`。
- Web：纯前端；分词中文建议 `Intl.Segmenter`。

#### AUTO-005 朗读相关 〔交叉引用〕
- 朗读(TTS)归他人。与本区的交互：朗读中点击 = 暂停/继续，上下左右区按翻朗读页；朗读时禁用双页；`tts_divide` 选项在 Misc；本文不展开。

---

## 3. 设置项总表

> 字段 = `A.java` 静态字段名（SharedPreferences 键名不同的列在“存储键”）。默认 = `LoadOptions`/`set_default_*` 的值；“—”表示布尔默认 false。位置：Visual=可视选项，Control=控制选项，Misc=其它选项，Theme=配色方案对话框，Status=阅读状态栏设置，Bar=阅读器工具栏自定义，Menu=其他入口。

### 3.1 文字/排版（可由主题保存/载入的标★）

| 字段（存储键） | 默认 | 含义 / 取值 | 位置 |
|---|---|---|---|
| fontSize ★ | 手机 14（亚洲语言 17）/平板 18 | 字号，`minFontSize`10(平板12)–`maxFontSize`100，0.1 步长 | Visual 文字大小；字体面板；双指；边缘滑动 |
| fontName ★ | ""→`serif` | 字体：`sans-serif/serif/monospace`/assets 字体名/文件绝对路径 | Visual 字体选择 |
| fontColor ★ | `#1B211E`(-14999266) | 文字颜色 | Visual 文字颜色 |
| backgroundColor ★ | `#E6EACF`(-1643825) | 背景色（alpha 强制 255） | Visual 背景颜色 |
| useBackgroundImage ★ | false(安装后 Day Theme 为 true) | 背景图/纯色二选一 | Visual |
| backgroundImage ★ | "" | 背景图 id（assets 文件名去扩展名或 `/` 开头绝对路径） | Visual 背景图片 |
| fontBold ★ / fontItalic ★ / fontUnderline ★ / fontShadow ★ | false | 加粗/伪斜体(−0.25)/下划线/阴影 | Visual |
| dashUnderline | true | 下划线是否虚线 | Visual 下划线子菜单 |
| fontAnti ★ | true | 抗锯齿 | Visual 平滑 |
| lineSpace ★ | 3 | −5…20，行高倍数=1+值/10 | Visual 行间距 |
| paragraphSpace ★(`paragraphSpace2`) | 7 | 0…20（UI 0–200%，×10） | Visual 段间距 |
| fontSpace ★ | 0 | −4…20，字距 = 值/20 em | Visual 字间距 |
| fontScale ★ | 0 | −4…20，横向缩放 = 值/10+1 | Visual 字体伸缩 |
| topMargin★(`topMargin2`)/bottomMargin★(`bottomMargin2`)/leftMargin★/rightMargin★ | 见 TYPO-006 | 0…200(300/400)dp | Visual 页面空白 |
| textJustified ★(`textJustified3`) | =中文环境 | 两端对齐 | Visual |
| textHyphenation / hyphenationLang | false / 系统语言 | 断字开关 / 语言码 | Visual |
| textCJK | =中文环境 | 东亚排版（按字折行+避头尾） | Visual |
| textDense | false | 紧凑模式 | Visual |
| verticalAlignment | false | 竖排 | Visual |
| textJian2Fan / textFan2Jian / jianFanWord / fanjianWord | false | 简→繁/繁→简及“常用词”转换 | Visual |
| indentParagraph / indentLength | =中文环境 / 2 | 首行缩进开关 / 字数 0–4 | Misc 智能排版 |
| trimBlankSpace | false | 删除多余空格空行 | Misc |
| txtChapterSplit | false | TXT 新章换页 | Misc |
| keepOneLineWhenPaging | false | 翻页保留一行 | Misc |
| textEncode(`textEncode`)/文件编码表 `file_encoding` | AUTO(亚)/UTF-8 | 文本编码 | Visual 文字编码 |
| dualFontSizeAdd | 0.0 | 双页字号加减 | Misc 双页对话框 |
| maxHtmlChapterSize(`maxHtmlChapterSize5`) | 100000 | HTML 章拆块长度（字符） | （无 UI） |

### 3.2 CSS / 内容

| 字段 | 默认 | 含义 | 位置 |
|---|---|---|---|
| disableCSS(`disableCSS3`) | false | 禁用书内 CSS 总开关（=下 8 项任一） | Misc |
| cssFontStyle / cssFontSize(`cssFontSize2`) / cssFontColor / cssAlignment / cssJustify(**默认 true**) / cssIndent(`cssIndent2`) / cssLineSpace(`cssLineSpace2`) / cssOthers | false（cssJustify true） | 8 类单独禁用 | Misc 禁用 CSS 弹窗 |
| useCssFont | true | 使用 EPUB 内嵌字体 | Misc |
| disableLinkColor | false | 链接不使用书内颜色 | Misc 链接颜色 |
| linkColor / linkColorNight / linkVisitedColor / …Night | `#6060E4`/同/`#999999`/同 | 链接色 | Misc 链接颜色 |
| noteTextColor / noteBackColor（+Night） | `#111111` / `#F6EA8C` | 注释弹窗色 | Misc |
| footnoteOnBottom | false | 直接显示注解 | Misc |
| showChromeButton | false | 顶栏“出版商格式预览”按钮 | Misc |
| chapterEndPrompt | false | 章末提示 | Misc（先在别处开启） |
| outerFontsFolder / outerImagesFolder | 系统默认路径 | 用户字体/背景图目录 | Misc 字体文件夹；Visual 背景图选择器 |
| miss_font_hint | true | 缺字提示 | Misc 字体对话框 |
| imageWhiteTransparent / fitImageToScreen / longTapImageFullScreen | f / f / t | 图片相关（Misc「图片相关选项」） | Misc |

### 3.3 翻页/动画/控制

| 字段（存储键） | 默认 | 含义 | 位置 |
|---|---|---|---|
| flip_animation(=flip_ebook) | 0 | 翻页动画 0–7（见 ANIM-001）；`flip_pdf` 为 PDF 用 | Visual |
| hori_fling_animation | 手机 4/平板 0 | 横划翻页的动画（同 0–7） | Visual/Misc 齿轮 |
| flipSpeed(`flipSpeed2`) | 30（Kindle 20） | 0–50 | Visual 翻页速度 |
| allow_scroll_horizontally | true | 允许横划翻页 | Visual/Misc |
| disableMove | false | 禁止触摸上下滑动 | Visual/Misc |
| pageSound / pageSoundIndex / pageSoundFile | f/0/"" | 翻页声音 | Misc |
| tapMode | 1 | 点击区模式 0–6 | Control（ClickTip 画廊） |
| toggleTapMode | true | 左右模式（tapMode<4 有效） | Control |
| doTapScreenTop/Bottom/Left/Right | 0/1/0/1 | 四区动作（CTRL-002 编号） | Control |
| doLongTap | 17 | 长按动作 | Control |
| longTapInterval | 0.4 | 长按触发秒数，≥0.05 | Control |
| doSwipeLeftToRight/RightToLeft/TopToBottom/BottomToTop | 15×4 | 划动手势动作 | Control |
| doShakePhone | 15 | 摇一摇 | Control |
| doVolumeKeyUp/Down | 0/1 | 音量键 | Control |
| doDPadUp/Down/Left/Right/Center | 0/1/12/13/8 | 方向键 | Control |
| doHomeKey/doBackKey/doMenuKey/doCameraKey/doSearchKey | 15/15/15/15/4 | 硬件键 | Control |
| doHeadsetKey/doMediaPlayPause/Next/Previous | 15（Pro<Android8: 19/19/1/0） | 耳机/媒体键 | Control |
| statusClickLeft/Middle/Right (`statusClickLeft3` 为 Left2) | 6/15/5 | 状态栏点击 | Control/Status |
| statusClickLeft2/Middle2/Right2 | 20/15/15 | 状态栏长按 | Control/Status |
| mult_touch | false | 双指缩放 | Misc |
| adjustBrightness / brightness_edge | true / 0 | 边缘亮度 / 哪条边(0左1右2上3下) | Misc 齿轮 |
| adjustFontSizeAtSlide / fontsize_edge | false / 1 | 边缘字号 | Misc 齿轮 |
| disableEdgeTouch / ledge,redge,tedge,bedge | false / 8,8,8,8 dp | 边缘防误触 | Misc |
| tilt_turn_page / tilt_forward / tilt_backward / tilt_forward_sensitive / tilt_backward_sensitive / askForTiltAction | f / 0 / 1 / 1.0 / 1.2 / t | 倾斜翻页 | Misc |
| askForSwipeEvent / askForScrollEvent / askForShakeEvent | t | 首次使用确认 | — |
| showedReaderClickTip(`showedClickTop2`) | f | 是否已弹点击区提示 | — |

### 3.4 屏幕/系统

| 字段 | 默认 | 含义 | 位置 |
|---|---|---|---|
| screenState | 平板：横 5/竖 6；手机 6 | 屏幕方向 0自动 1横 2竖 3反横 4反竖 5横感应 6竖感应 | Control 屏幕方向；按钮 0 |
| fullscreen / fullscreenWithStatus(`fullscreenWithStatus`) / immersive_fullscreen(`immersive_fullscreen2`) / fitCutout(`fitCutout3`) | t / f / t / 0 | 全屏/带透明状态栏/浸入式/刘海适配（1=适配,−1=不适配） | Misc 全屏齿轮 |
| keepScreenAwake / screenAwakeExtend | t / 5 | 常亮 / 无操作 N 分钟后取消(100=∞) | Misc |
| brightnessValue | −100 | −100 自动，−50…100 | 亮度面板；Misc 亮度齿轮 |
| bluelightEnable / bluelightOpacity | f / 30 | 蓝光过滤 / 0–100(实际有效 0–80) | 亮度面板；Misc |
| adjustLed / adjustNightLed / disableLedValue | f/f/10 | 按键背光(旧机型) | Misc 亮度齿轮 |
| openLastFile / openBookAnim | f / f | 启动打开上次 / 开书动画 | Misc |
| dualPage / dualPageOnlyLandscape(`landscape2PageMode`) / pageStyle2PageMode / auto2PageForFoldable / dualChapterText | =isTablet / =isTablet / t / f / f | 双页相关 | Misc 双页；按钮 16 |
| remind1 / remind1Time / remind2 / remind2TimeHour / remind2TimeMinute | t/60/f/23/30 | 健康提醒 | Misc |
| sysDarkModeFollow / sysDarkNever / sysDarkModeTip / mainNightTheme | f / t / t / f | 跟随系统深色 / 界面夜间态 | Theme |
| showBookmarkIcon | t | 书签图标 | — |

### 3.5 主题与自动日夜

| 字段 | 默认 | 含义 | 位置 |
|---|---|---|---|
| lastTheme | `"DAY_THEME"`（注意：字面量≠`"Day Theme"`，见 §7） | 当前主题名 | 内部 |
| loadThemeWithColorOnly | true | 载入主题只改颜色 | Theme |
| autoTheme / autoThemeDay / autoThemeNight | f / t / t | 自动日夜 | Theme 齿轮 |
| autoThemeDayTime / autoThemeNightTime | 600 / 2200 | `HHMM` 整数 | 同上 |
| autoDaySetBright / autoNightSetBright | f / f | 切换时是否设亮度 | 同上 |
| autoThemeDayBrightness / autoThemeNightBrightness | 10 / 1 | 切换亮度 | 同上 |
| saveThemeHint | t | 首次保存主题提示 | — |
| 主题文件 `theme_<name>.xml` | 14 个 | 见 §5 | Theme |
| 阅读器工具栏文件 `reader_bar_icons` / doubleLineBar | 见 VIEW-004 / f | | Bar |

### 3.6 状态栏

| 字段 | 默认 | 含义 | 位置 |
|---|---|---|---|
| showStatusbar | t | 小型状态栏总开关 | Misc |
| statusBarOnTop / statusUnderNotch | f / t | 放顶部 / 刘海下 | Status |
| statusTime / statusChapter / statusProgress | t / t / t | 三块显示 | Status |
| use12Hour | f（加载默认 `屏宽>400`，重置为 f） | 12 小时制 | Status |
| statusCustomizeFont / statusFontName / statusFontColor / statusFontSize / statusMargin / statusBackColor | f / sans-serif / `#222222` / 10(平板 13) / 0(平板 2) / `#33333333` | 自定义外观 | Status |
| showRemainingTime / remaingTimeInStatusBar | f / f | 剩余时间 | Misc |

### 3.7 自动滚屏与速读

| 字段 | 默认 | 含义 | 位置 |
|---|---|---|---|
| autoScrollMode | 0 | 0卷帘像素 1卷帘行 2像素 3行 4页 5速读 | Misc；长按按钮 3 |
| autoScrollSpeed(`autoScrollSpeed2`) | 50 | 0–100（UI 滑条值=100−speed） | 开始滚屏对话框；手势 |
| startAutoScroll | f | 启动时自动滚屏 | Misc |
| askAutoScrollTip / askForScrollEvent | t / t | 提示面板 / 开始对话框 | — |
| speedReadWPM / speedReadSize / speedReadWords | 200 / 30 / 1 | RSVP 参数 | 速读界面 |

---

## 4. 关键算法

### 4.1 翻页对齐与位置模型（对应 VIEW-001）

```
pageHeight   = container.height - paddingTop - paddingBottom
oneLineTag   = lineSpace < 0 ? 1 - lineSpace/10 : (lineSpace >= 2 ? 0.75 : 0.82) + (asian ? 0.10 : 0.08)

lastDisplayLine(scrollY):
    line = lineAt(scrollY + pageHeight - 1)
    if lineTop(line) > scrollY + pageHeight - lineHeight(line) * oneLineTag:  line -= 1   // 露出不足,算下一页
    if there is a "border top" (表格/图片块) crossing: line = thatLine - 1             // 不把块拦腰截断
    return max(line, lineAt(scrollY))

pageDown():  top = lineTop( lastDisplayLine(scrollY) + 1 )         // 默认
             if keepOneLine: top = lineTop(lastDisplayLine)         // 保留一行
             yStack.push(scrollY); scrollTo(top)
pageUp():    if yStack non-empty: scrollTo(yStack.pop())             // 精确还原
             else: top = lineAt(scrollY - pageHeight) + 1 (<半行则取 0); 并保证上一页末行不丢
chapter edge: scrollY==0 && up -> 上一章(从末尾);  lastLineDisplayed && down -> 下一章
```
位置存储：TXT = 全文字符偏移；EPUB = (章, 拆块序号, 章内偏移)；重排后用“字符偏移 → 行 → scrollY”恢复（`showTxtByPosition`/`showEBookByPosition`）。Web 版建议以「章 + 段落 id + 段内字符偏移」为稳定锚点。

### 4.2 页码/百分比
- 状态栏百分比：`T.getPercentStr2(cur, total)` → `DecimalFormat("0.00%")`（两位小数），`isEndOfBook()` 时显示 `100%`；顶栏拖动时用 `i/10 %`（一位小数）；PDF 另用 `n/总页`。
- 章内页码：`total = floor(H/pageH) + 1`，`current = floor(total·(scrollY + pageH/5) / H') + 1`（H' = H + 修正）；块拆分/整书折算见 STATUS-001。
- 进度条值 TXT：`getAboutPosition()·1000/txtLength`；EPUB：`currentPosition·1000/总字数`（`getEBookTotalSize`，章字数优先 `pure_text_length`，否则章 `size`），末页强制 1000，`>0` 而取整为 0 时取 1。

### 4.3 iBook 仿真翻页（`NewCurl3D` 的 `Mesh3D`，本质是 harism/android_page_curl 的 CurlMesh）
**坐标**：GL 视口 x∈[−a,a]（a=W/H）、y∈[−1,1]（上=1）；屏幕→GL：`x = −a + 2a·px/W`，`y = 1 − 2·py/H`；正交投影。页矩形 R（当前页，可含 `setMargins`）；单页模式左页矩形 L = R 左移一个 R 宽（上一页“停放”在屏外左侧）；双页模式 R/L 各占视口一半。每张页面是 4 顶点矩形 `v0(left,top) v1(left,bottom) v2(right,top) v3(right,bottom)`，贴图坐标 (0,0)(0,V)(U,0)(U,V)（U,V=位图/2 的幂对齐尺寸，WebGL2/NPOT 下可取 1）。页面位图 = 该页当前的屏幕截图。`Mesh3D(maxCurlSplits=10)`。

**curl(P, D, r)**（P=卷曲线位置，D=单位卷曲方向，r=圆柱半径）：
```
θ = acos(D.x);  if D.y > 0: θ = -θ
rot[i] = rotateZ( v[i] - P, -θ )   // 把页矩形转到 D 沿 +x 的局部系；按 x 降序(同 x 按 y 降序)排序，rot[0].x 最大
edges = [[0,1],[0,2],[1,3],[2,3]];  若 |rot0-rot2| > |rot0-rot3|: edges[1][1]=3, edges[2][1]=2
arc  = π·r
scan = [0] + [ -arc·k/(n-1) | k=1..n-1 ] + [ rot[3].x - 1 ]        // n=10: 0,-arc/9,…,-arc,再加最远端
xmax = rot[0].x + 1
for i, s in scan:
    //  取页多边形落在 [s, xmax] 内的部分：每个满足 s<=rot[j].x<=xmax 的顶点，连同其竖线与各边的交点(getIntersections)；
    //  再加上竖线 x=s 与页边的两个交点；按“上-下”成对输出，形成 TRIANGLE_STRIP 顶点序列
    for w in 输出顶点:
        if i==0:                      // 平面前段(卷曲线之前)
            w.alpha = flipTex ? BACK : 1;                       front++
        elif i==last or arc==0:       // 圆柱之后的平面背面(折回)
            w.x = -(w.x + arc);  w.z = 2r;  w.penumbra.x = -w.penumbra.x
            w.alpha = flipTex ? 1 : BACK;                       back++
        else:                         // 半圆柱段
            φ = w.x / r                // w.x ∈ [-arc, 0] → φ ∈ [-π, 0]
            w.x = r·sin φ;  w.z = r − r·cos φ;  w.penumbra.x *= cos φ
            w.color = sqrt(sin φ + 1.5)·0.9 + 0.1               // 柱面明暗 ≈0.74…1.2
            (w.z >= r) ? (w.alpha = BACK; back++) : (w.alpha = 1; front++)
        w = rotateZ(w, θ) + P ; 写入顶点/颜色/贴图缓冲
        if 0 < w.z <= r:  dropShadow.insertAt((n+1)/2, pos=w.pos, penumbra = (w.z/2)·(-D), shade = w.z/r)
        if w.z > r:       selfShadow.insertAt((n+1)/2, pos=w.pos, penumbra = ((w.z-r)/3)·w.penumbra, shade = (w.z-r)/(2r))
```
`BACK` = 单页 0.9 / 双页 1.0（`setFlipTexture`）。阴影：每个阴影点输出两个顶点 P 和 P+penumbra，颜色 P=`lerp(OUTER(0,0,0,0), INNER(0,0,0,0.5), shade)`，P+penumbra=OUTER；`TRIANGLE_STRIP`，混合 `(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)`。

**绘制顺序**（`drawiBook`）：① 投影条(drop shadow) → ② 前段顶点 `[0, front)`：先按顶点色铺底，再带纹理（`texture × vertexColor`）→ ③ 背面顶点 `[max(0,front-2), …)`：单页模式用**同一张页图的镜像**纹理(texcoord 反转)，并整体乘以“页面平均色”常量色（各分量下限 0.1，alpha = `f + (0.9−f)·(255−lum)/255`，`f = lum>200 ? 0.4 : 0.5`，`lum`=平均色 R+G+B 的 `getColorValue`，即越亮的页背面越透）；双页模式用另一页的位图 → ④ 自阴影条。`aboutColor` 来自当前页截图平均色（`get3dAboutColor`）。页尾/页首等静止页用 `pageLeft/pageRight` 两个 Mesh 平铺。清屏色黑。

**指针 → 卷曲参数**（`updateCurlPos`）：
```
radius0 = (fromClick ? 1.0 : 1.5) · pageW / (landscape ? 6 : 3)  · max(1 − pressure, 0)    // pressure 固定 0.7843 ⇒ 因子 0.2157
// 向前翻(state=2，从右缘向左拖；双页的 state=1 同理):
dir = pointer − dragStart;   L = |dir|;   arcLen = π·r;   fullW = 2·pageW
if L > fullW − arcLen: arcLen = max(fullW − L, 0); r = arcLen/π
if L >= arcLen:  P = pointer − dir·((L − arcLen)/2)/L                     // 圆柱中心跟手
else:            P = pointer + dir·(sin(sqrt(L/arcLen)·π)·r)/L            // 起势“鼓起”
setCurlPos(P, dir, r)
// 单页向后翻(state=1): dir.x = P.x + dragStart.x; dir.y = P.y − dragStart.y; r' = clamp(P.x − R.left, 0, radius0); P.x −= min(R.right − P.x, r')
setCurlPos: 把 P 夹进页矩形（P.x<R.left→R.left；P.x>=R.right → 直接 reset()），调整 D 使卷曲线不越出上下边；D 归一；D==0 → reset。
```
dragStart = 触点夹在页矩形内（y 夹在上下边，x 取页右缘 R.right 或左缘 L.left）。

**手势与动画**：
- 按下：`dragStart` 设定，`startCurl(1|2)`：左半屏按下 → 向后翻(取上一页位图)，右半屏 → 向前翻(取下一页位图)（单页）；双页按下位置在 R.left 左/右分左右页。移动：`updateCurlPos` 逐帧重算 `curl()`。
- 抬起：`turnSuccess = !cancel`（cancel 由 AT 依 fling 方向传入：速度反向 >200px/s 即取消；速度 >600px/s 且方向正确则强制完成）。动画源=抬起点，目标=完成时取对侧页缘 x、y=dragStart.y；取消时回到 dragStart。
- 动画逐帧（`onDrawFrame`）：`t = (now − start)/T`；缓动 `e`：双页 或 (谷歌风格向后翻) → `t^((1−t)·1.2+0.01)`；`fromClick` → 向后翻 `sqrt(t)`、向前翻 `t^1.2`；拖动抬起 → 线性。`pos = source + (target − source)·e`，再走 `updateCurlPos`。结束后交换 `pageCurl/pageRight|pageLeft` 引用，`afterFlipCurl.Finished(turnSuccess)` 回调通知阅读器真正翻页(`pageScroll` 在动画开始前已预先翻好并截了新页图)。
- 时长：`T0 = (60 − flipSpeed)·9 ms`（Apple 默认 270ms；Google 为 `·11`=330ms），Apple 双页 `T0·15/11`；Google 单页 `T0·0.6`。点击翻页(`pageScroll`)：Apple 单页向前翻 `T0·9/10`、向后翻 `T0·6/10`；取消回弹：触点在右半屏 `T0·2/3`、左半屏 `T0·2`。
- **点击翻页的合成手势**（Apple，`NC3D.clickHandler`）：以 `T0/10` 为间隔发 4 个触摸事件——向前翻：DOWN(100%W, 99%H) → MOVE(98%W, 94%H) → MOVE(94%W, 94%H) → UP(92%W, 94%H)；向后翻：DOWN(0, 99%H) → MOVE(3%W, 96%H) → MOVE(6%W, 92%H) → UP(9%W, 91%H)（由 `i=2,i2=3` / `i=3,i2=4` 公式展开）；UP 之后按“成功”走上面的动画。即从屏幕**下角**捏起一角翻过去。
- **页面快照时机**（`get3dCurlShot`）：触摸 DOWN 且滑动 >8dp（反向 >20dp）时才触发取图：先 `pageScroll(dir, noAnim=true)` 把阅读器内部真的翻到目标页并截图(`tmpFlipShot2`)，再把旧页图(`tmpFlipShot1`)作第 0 张、新页图作第 1 张送给 GL；单页位图为 `RGB_565`/或高质量 ARGB(`HighQuality3D`)。取消翻页时需把阅读器滚回原位(`txtViewValueScrollBack` 对应)。Web 版需同样“先预渲染相邻页”，或用 CSS 多栏时直接把相邻两列各自截取。
- 实现建议(Web)：WebGL1，顶点 ≤ `(maxCurlSplits·2+6)` ≈ 26 个/批；用 `Float32Array` 每帧重算；着色器 `gl_FragColor = texture2D(tex, uv) * vec4(vColor.rgb, 1.0); alpha=vColor.a`；背面纹理水平镜像；阴影条用无纹理的带 alpha 顶点色三角带。画布大小=页面 CSS 像素×`devicePixelRatio`。Canvas2D 备选：N 条竖向切片 + `setTransform` 近似圆柱（无透视，质量下降但可用）。

### 4.4 Google 风格翻页（`GoogleBook`）
- 网格：`generate(50,1, …)`——条带 50 段×1 行，宽 = 页宽(GL)，贴图 u∈[0,1]；阴影网格 `generate(3,1, …)`（宽度因子横屏 0.05 / 竖屏 0.1，`attachShadow`）；透视 `gluPerspective(FOV, aspect, 0.1, 100)`，FOV 横屏 30°/竖屏 45°，相机沿 −z 退 `1/tan(FOV/2)`。
- 状态 `t`（拖动累计）：`mDir`：按下点在左半屏 = LEFT(2，上一页)，右半屏 = RIGHT(1)；每个 MOVE：`Δ = (x − downX)/W`（双页 ×0.82），`|Δ|>0.3` 时 `Δ = Δ/|5Δ|`，`t −= Δ`；抬起后用 `startPageTurnAnimation(t, target)` 动画到 0（取消）或 ±1（完成），缓动同 §4.3 的 `t^((1−t)·1.2+0.01)`（单页向后翻时）或线性/`sqrt`。
- 单页形变 `updatePosSimple`：`sm = (dir==LEFT) ? smooth(clamp(t,−1,0)+1) : clamp(t,0,1)·1.2`，`smooth(x)=x²(3−2x)`；`P0=(−W/2, 0)`，`P1=(W/2 + (−W)·sm, 0.1·sm)`，`Q0=(Q0Xsrc + (Q0Xtgt−Q0Xsrc)·sm, √sm·1.2·W)`（`Q0Xsrc=−0.39375, Q0Xtgt=−1.5`），`Q1=(Q1Xsrc + (W/2 − Q1Xsrc)·sm, z1(sm))`（`Q1Xsrc=−0.45`，`Q1Zsrc=−0.02`，`z1` 分段二次：sm<0.5 时 `((√(2sm)−0.5)²−0.25)·(Q1Zsrc/−0.25)`，否则 `((2sm−0.5)²−c)·(Q1Zsrc/c)` 其中 `c=(0.25−Q1Zsrc)/(Q1Zsrc+0.05)`），夹紧 `Q1.x ≤ P1.x`，`sm>0.5` 时 `Q1.z ≤ P1.z`。对每个顶点 `u=(x+W/2)/W`：`Q=lerp(Q0,Q1,u)`，`P0Q=lerp(P0,Q,u)`，`QP1=lerp(Q,P1,u)`，`B=lerp(P0Q,QP1,u)` → 顶点 `(x', z') = (B.x, B.y)`；贴图 u 改为沿弯曲线的累计弧长占比（页面纹理沿曲线均匀铺开）。双页 `updatePosComplex`：5 个控制点的 `bezierN`，其中 `ctrl3.x=(min(1,0.2+t)·0.35+0.65)`，对 1–4 号点用 `rotatePoint(angle=π/2·t·{2.4,1.8,1.5,1.0}, zmax=0.3W…)`。
- 阴影：`Shadow` 网格贴在页右端，`alpha[i] = 0.3 − 0.1·i/3…×k`，`k` 在 `t∈(0.6,0.8)` 由 1→2.5、`(0.8,1)` 由 2.5→0。
- 常量 `Q0XSrc/Q0XTgt/Q1XSrc/Q1ZSrc` 有 `setLeftStartX/setLeftEndX/setRightStartX/setRightStartZ` 调节函数，未发现正式 UI 入口（§7）。
- Web：与 §4.3 同一 WebGL 管线，顶点位置换成上述曲线、开透视矩阵。优先级低(P2)。

### 4.5 点击区域判定（`A.clickArea`，逐模式推出；W/H 为 `baseFrame` 宽高；双页点右页时 x += W/2）
返回码：0 中(菜单) 1 上 2 下 3 左 4 右。下表为 3×3 网格（行 = 上/中/下，列 = 左/中/右）：

| tapMode | 模式（toggle=true 左右模式） | 模式（toggle=false 上下模式） | 备注 |
|---|---|---|---|
| 0 | 3 0 4 / 3 0 4 / 3 0 4 | 1 1 1 / 0 0 0 / 2 2 2 | 三等分 |
| 1（默认） | 3 3 4 / 3 0 4 / 3 4 4 | 1 1 1 / 2 0 1 / 2 2 2 | 左+上 = 上一页，右+下 = 下一页（“L”形）；中心 = 菜单 |
| 2 | 十字中区：`x∈[W/3,4W/9)` 且纵向在上/下行 → 3；`x∈[4W/9,5W/9]` 全高、以及中间行内 `x∈[W/3,2W/3]` → 0；其余按左右半 → 3 / 4 | 同理转置：`y∈[H/3,4H/9)` 且横向在左/右列 → 1；`y∈[4H/9,5H/9]` 全宽、中列内 → 0；其余 → 2 | 中间“十”字形 |
| 3 | 中心格 = 0；中心格上/下方的格子按左半 3 / 右半 4 划分；左列全 3，右列全 4 | 转置：中心格 = 0；中心格左/右侧的格子按上半 1 / 下半 2 划分；上行全 1，下行全 2 | 中心格菜单，其余各半 |
| 4 | 仅**左上格 = 1**；中心格 = 0；其余全 = 2 | 同左（忽略 toggle） | 单手：只有左上角“上一页” |
| 5 | 仅**上中格 = 1**；中心 = 0；其余 = 2 | 同左 | |
| 6 | 仅**右上格 = 1**；中心 = 0；其余 = 2 | 同左 | |
| 其它 | 恒 0（整屏菜单） | | `default` |

每个返回码经 `doTouchDown`：1→`doTapScreenTop`、2→`doTapScreenBottom`、3→`doTapScreenLeft`、4→`doTapScreenRight`，再 `doEvent`。控制选项里 `toggleTapMode` 为真时「点击上面/下面」下拉被禁用、左右两个启用，反之亦然；`tapMode>=4` 时复选框无效。
`isMiddleTap`（用于“中间点击不翻页”和仿真翻页中屏蔽）：按下点和当前点都在中心格(`W/3<x<2W/3 且 H/3<y<2H/3`)才算。

### 4.6 自动滚屏速度公式（`speed` = `autoScrollSpeed` 0…100，**值越大越慢**；UI 滑条值 = `100 − speed`，toast 显示「滚屏速度: (100−speed)%」）
```
定时器周期 getAutoScrollInterval()（ms）：
  模式 2 (像素)  : speed >= 50 ? (speed-49)*10 + 20 : 20          // isSmoothAutoScrollMode
  模式 0 (卷帘·像素): i2 = speed >= 50 ? 40 + (speed-50)*150/50
                           : (space <= 4 ? 20 + (speed%5==0 ? 5 : speed%5)*3 : 25)
                     return i2 * 100 / ((speed < 50 ? (50-speed)*2 : 0) + 100)
  模式 1 (卷帘·行) : 10000 / ((speed < 50 ? 50-speed : 0)*2 + 100)
  模式 3 (行) / 4 (页): 100
每个定时器 tick 触发 do_autoscroll_message 的条件（AutoScrollTask）：
  模式 0、2、4 : 每 tick；  模式 1 : count*4 >= speed 时；  模式 3 : count*5 >= speed 时（触发后 count=0）
每次触发的动作：
  模式 2 : scrollBy(0, speed < 50 ? 50 - speed : 1)
  模式 0 : scrollPos += space * 55 / (55 - (speed < 50 ? 50-speed : 0)),   space = speed >= 50 ? 1 : (55-speed)/5   (整数除法)
  模式 1 : scrollPos = 下一整行的行顶
  模式 3 : scrollTo(下一行行顶)
  模式 4 : f = (speed+20)/10 (整数除);  threshold = f*f/(f+5) * 30 * 100 / ((speed<50 ? (50-speed)*2 : 0) + 100);  count >= threshold 时 pageScroll(1)
          （tick=100ms ⇒ speed=0 约 0.9s/页，50 约 12s/页，100 约 25s/页）；顶部 2dp 进度线宽 = 屏宽×count/threshold + 15
到页底/章底：卷帘模式截新页重来；像素/行模式在 EPUB 章末倒计时 3 秒（speed>10 时）再翻章，TXT 直接翻页；书末(isEndOfBook)停止并提示。
```
各模式速度大致单调、近似连续，可直接按公式复刻；Web 版如要统一单位可把它们换算成 px/s 后用 rAF 驱动（卷帘 =“新页铺开线”以同样速度向下推进）。

### 4.7 亮度遮罩与蓝光过滤（`showShadeCoverOnView`）
```
visible = !(brightnessValue > 0 && !bluelightEnable)
shadeA0 = (brightnessValue > 0 || brightnessValue == -100) ? 0 : min(1 - brightnessValue, 50) * 4     // getShadeAlph
i  = clamp(bluelightOpacity, 0, 100)           // 面板 SeekBar 0–95；滑到 0 自动关闭
A  = bluelightEnable ? i*180/80 + shadeA0 : shadeA0
i  = min(i, 80)
R  = bluelightEnable ? 200 - i*190/80 : 0
G  = bluelightEnable ?  180 - i*170/80 : 0
B  = bluelightEnable ?   60 - i*60/80  : 0
overlay = rgba(R, G, B, min(A, 230) / 255)      // 最顶层 View，不拦截触摸
```
例：默认 30% → A≈67、(129,117,38)。窗口亮度：`brightnessValue>0 ? v/100 : 0.01`。

### 4.8 排版相关计算汇总
- 行高：`lineHeight = naturalLineHeight × (1 + lineSpace/10)`；段间空行：`blankLineHeight = lineHeight × paragraphSpace/10 − fontSize/7`（dp 换算后；paragraphSpace=10 不缩短；=0 时空行 8% 行高，裸 `\n` 行为 0）。
- 字距 `fontSpace/20 em`；横向缩放 `fontScale/10 + 1`；缩进 `width("一")·indentLength`。
- 两端对齐：见 TYPO-007；断字右边距补偿见 TYPO-006。
- 状态栏文字大小 = `statusFontSize` sp；双页章节名字号 = `min(statusFontSize+1, fontSize−1)`。

### 4.9 主题载入伪代码
```
loadTheme(name, colorOnly):
  t = themes[name]
  fontColor = t.pFontColor; backgroundColor = t.pBackgroundColor
  backgroundImage = t.pBackgroundImage; useBackgroundImage = t.pUseBackgroundImage
  skip = !forceFull && (colorOnly || loadThemeWithColorOnly || t.emptyFontStyle)   // forceFull = 书专属主题载入
  if !skip: fontName, fontSize, margins(top,bottom,left,right), lineSpace, paragraphSpace,
            fontSpace, fontScale, bold, anti, underline, italic, shadow ← t
  lastTheme = name
  rerender(colors only if skip else full)
t 缺失的键 → 取当前全局值（所以只写颜色的 XML 就是“只改颜色”的主题）
saveTheme(name, true): 把当前全局的 19 个字段写成 XML；themeList 去重(同名覆盖)，新主题插在“临时主题”之前
```
书籍专属主题：`getThemeOfBook(file)` = 名称等于“文件名(含扩展名?)”的主题（`T.getFilename`），打开书时 `loadVisualOptionsForBook`：有专属主题则先保存当前为临时主题再载入专属主题(含字体样式)。

### 4.10 倾斜翻页（简述）
见 CTRL-008。核心：每个加速度采样得到 (x,y,z)，与上一采样比较，`|Δx|>4 或 |Δy|>4` 视为晃动并重置；静止(Δ 全 0)累计 >3 次 且距上次 >500ms → 记 `base_z`；`dz = z − base_z`，超过灵敏度阈值（`z` 向某方向、`dz>sens` 记 `tilt_down`；`dz<−sens` 记 `tilt_up`，横屏近似时灵敏度 ×1.4）；随后 `|dz|` 回到不足峰值一半 → 记“回中”；峰值到回中 <1000ms → 触发 `tilt_forward`(向下)/`tilt_backward`(向上) 的翻页。

---

## 5. 主题格式与 14 套主题取值表

### 5.1 XML 格式
文件名 `theme_<显示名>.xml`（assets/themes 里即这 14 个文件），内容为 Android `SharedPreferences` 的 `<map>`：
```xml
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
  <boolean name="pUseBackgroundImage" value="true" />
  <string  name="pBackgroundImage">readbg_13</string>
  <int     name="pFontColor" value="-16777216" />      <!-- 有符号 ARGB int32：0xFF000000 = -16777216 -->
  <float   name="pFontSize" value="14" />
</map>
```
类型只有 `boolean/int/float/string`；颜色是有符号 32 位 ARGB（转十六进制取 `& 0xFFFFFFFF`）。**`PageTheme.loadFromXml` 实际读取的键**（缺省时取当前全局值）：

| 键 | 类型 | 含义 |
|---|---|---|
| pBackgroundImage | string | 背景图 id（assets/background 文件名去扩展名，或以 `/` 开头的本地绝对路径） |
| pUseBackgroundImage | boolean | 用图(true)还是用纯色(false) |
| pBackgroundColor | int | 背景纯色（也是图缺失时的回退色） |
| pFontColor | int | 文字颜色 |
| pFontName | string | 字体名；**缺省或为字符串 "false" ⇒ `emptyFontStyle=true`（仅颜色主题）** |
| pFontSize | float(或 int) | 字号 |
| pTopMargin2 / pBottomMargin2 / pLeftMargin / pRightMargin | int | 页边距，单位 **px**（设备像素，UI 用 `vdr` 除以 density 显示 dp）；bottom 缺省回退值是 `A.topMargin`（疑似原版 bug） |
| pLineSpace / pParagraphSpace / pFontSpace / pFontScale | int | 同 §3.1 |
| pFontBold / pFontAnti / pFontUnderline / pFontItalic / pFontShadow / pTextJustified | boolean | 同 §3.1 |

**文件里出现但代码从不读取的键**（旧版遗留，Web 版忽略即可）：`pTopMargin`、`pBottomMargin`（不带 2 的旧键）、`pBottomOffset`、`pRightTextAlignment`、`pFadingEdgeLength`、`pReadProgress`、`flip_curl_color`（Day 3 里的 `-3750486 = #C6C5AA`，疑似翻页卷曲色，当前版本无引用）。
显示名 = 文件名去掉 `theme_` 前缀与 `.xml`；`Day Theme`/`Night Theme` 显示为本地化名「白天模式」/「晚上模式」。

### 5.2 14 套主题完整取值（颜色 `#RRGGBB`，ARGB 原值括号内；“—”表示文件未写 → 载入时取当前全局值）

| # | 文件(显示名) | pUseBackgroundImage | pBackgroundImage | pBackgroundColor | pFontColor | 其它写出的键 |
|---|---|---|---|---|---|---|
| 1 | Day 1 | true | `readbg_13`（800×1280 jpg，目视：近白微灰纸，边缘轻微暗角） | — | `#000000`(-16777216) | — |
| 2 | Day 2 | true | `readbg_14`（1022×681 jpg，目视：米色颗粒纸纹） | — | `#000000`(-16777216) | — |
| 3 | Day 3 | true | `readbg_11`（480×800 jpg） | — | `#191919`(-15132391) | `flip_curl_color`=-3750486(`#C6C5AA`，未使用) |
| 4 | Day Theme（默认白天） | true | `day161`（80×80 png 平铺，均色 `#DCD8D1`） | `#DCD7D1`(-2304047) | `#000000`(-16777216) | `pFontSize=14`、`pLineSpace=3`、`pFontSpace=0`、`pFontBold/Italic/Shadow=false`、`pTextJustified=false`；旧键(不读)：`pTopMargin=4 pBottomMargin=4 pLeftMargin=6 pRightMargin=4 pFadingEdgeLength=0 pReadProgress=0 pRightTextAlignment=false` |
| 5 | Night 1 (True black) | false | — | `#000000`(-16777216) | `#FFFFFF`(-1) | — |
| 6 | Night 2 | true | `readbg223`（720×1280 jpg，目视：深蓝灰 ≈`#3A3F48` + 四周暗角） | — | **`#000000`(-16777216)**（黑字配深色底，疑为原资源失误，§7） | — |
| 7 | Night 3 | false | — | `#0A0C13`(-16118765) | `#354552`(-13286062，低对比暗灰蓝字) | — |
| 8 | Night Theme（默认夜间） | true | `night161`（80×80 png 平铺，均色 `#3A3A3A`） | `#000000`(-16777216) | `#CCCCCC`(-3355444) | 同 Day Theme（`pFontSize=14 …`，旧键同样不读） |
| 9 | Outdoor (Pure white) | false | — | `#FFFFFF`(-1) | `#000000`(-16777216) | — |
| 10 | nature | true | `readbg201`（650×940 jpg） | `#E6EACF`(-1643825) | `#082D52`(-16241326，深海军蓝) | `pFontName=DroidSerif-BoldItalic`（assets 无此字体，回退 serif）、`pFontSize=16`、`pFontShadow=true`、`pLineSpace=3`、`pFontSpace=0`、`pFontBold/Italic/TextJustified=false`；旧键：`pTopMargin=13 pBottomMargin=11 pLeftMargin=12 pRightMargin=11 pBottomOffset=0 pFadingEdgeLength=0 pRightTextAlignment=false` |
| 11 | pro 1 | true | `readbg203`（1080×1920，扩展名 .png 但内容是 JPEG） | — | `#4A4539`(-11909831) | — |
| 12 | pro 2 | true | `readbg204`（1080×1920，同上 .png 实为 JPEG） | — | `#4A4539`(-11909831) | — |
| 13 | pro 3 | true | `readbg221`（1500×3000 jpg） | — | `#BDC9C8`(-4339256，浅灰绿字，应为夜间配色) | — |
| 14 | pro 4 | true | `readbg222`（768×1280 jpg） | — | `#BDC9C8`(-4339256) | — |

列表顺序（`getThemeList`）：Day Theme、Night Theme，然后 `Collections.sort` 的 ASCII 顺序：Day 1, Day 2, Day 3, Night 1 (True black), Night 2, Night 3, Outdoor (Pure white), nature, pro 1, pro 2, pro 3, pro 4，最后是不显示的临时主题 `circle_only`。
首次安装后 Day/Night Theme 会被 `adjustDisplay` 用当前全局字号/边距重新保存（所以设备上它们是完整样式主题），其余 12 个保持 assets 原样（颜色-only，除 nature）。

### 5.3 背景图清单（`assets/background/`，共 33 个文件；选择器列表 = 此目录全部文件 + 用户目录图片，id=文件名去扩展名）
渲染规则：宽、高均 <100px 的小图**平铺**，否则**拉伸到整页**（不保持比例）。PNG 小图的均色由本次解码算出；JPEG 未算均色。

| 文件 | 尺寸 | 渲染 | 均色/说明 | 被谁用 |
|---|---|---|---|---|
| day161.png | 80×80 | 平铺 | `#DCD8D1` | Day Theme |
| night161.png | 80×80 | 平铺 | `#3A3A3A` | Night Theme |
| readbg_00.png … readbg_06.png | 80×80 | 平铺 | 00 `#F4F0E5`、01 `#99BABC`、02 `#DDC3A2`、03 `#8FAA7A`、04 `#DAC5C3`、05 `#232323`(灰度)、06 `#DCD7D1` | 仅选择器 |
| readbg_11.jpg / _12.png(实为 JPEG) / _13.jpg / _14.jpg / _15.jpg | 480×800 / 480×854 / 800×1280 / 1022×681 / 1200×900 | 拉伸 | 11/13/14 被主题用 | Day 3 / —/ Day 1 / Day 2 / — |
| readbg201.jpg | 650×940 | 拉伸 | | nature |
| readbg202.jpg / readbg205.jpg | 1080×1920 | 拉伸 | | 仅选择器 |
| readbg203.png / readbg204.png(实为 JPEG) | 1080×1920 | 拉伸 | | pro 1 / pro 2 |
| readbg221.jpg / readbg222.jpg / readbg223.jpg | 1500×3000 / 768×1280 / 720×1280 | 拉伸 | 223 为深蓝灰带暗角 | pro 3 / pro 4 / Night 2 |
| page0.jpg / page205.jpg / page222.jpg / page3.jpg | 480×800 / 800×565 / 240×320 / 240×320 | 拉伸 | | 仅选择器 |
| page301.png … page306.png（无 304） | 80×80（305 为 64×64 1 位色） | 平铺 | 301 `#065C87`、302 `#1F4742`、303 `#2C4559`、305 `#EDEDED`、306 `#FFE1E1` | 仅选择器 |
| pagefb.jpg | 40×40 | 平铺 | | 仅选择器 |
| p_line.png | 1×663 | 小于 100 宽但高 663 ⇒ 因 `width<100 && height<100` 不成立而**拉伸** | 蓝色细线 `#6FBCE7`（非背景，疑为别处分隔线资源；也会出现在选择器里） | — |

> “目视”仅指本次打开了 3 张代表图（readbg_13/14/223）；其余 JPEG 未逐张查看。

---

## 6. 界面结构（菜单 / 面板 / 对话框层级）

```
阅读页（show_txt）
├─ 正文区  ContentLay：文字(MRTextView) / 书签角标 / 纯图章节
│     ├ 点击区(见 §4.5)：中 → 呼出/收起 顶栏+底栏；上/下/左/右 → 绑定动作
│     ├ 长按 → 文本选择（他人）；章边界过拉 → 换章（环形进度）
│     ├ 左边沿竖滑 → 亮度；右边沿竖滑 → 字号；双指 → 字号
│     └ 链接返回按钮(linkBackIv)
├─ 迷你状态栏  [电池+时间] [章节名 (n/m)] [百分比]    （双页：[n/m][n+1/m] + 章节名灰字）
│     └ 点击/长按 左/中/右 → 可绑动作
├─ 顶栏  [←返回书库] [书名/文件名→书籍信息] [(PDF笔)] [(出版商格式预览)] [⋮]
│     └ ⋮ → 选项菜单
│          ├ 可视选项 ↔ 控制选项 ↔ 其它选项（三对话框互跳）
│          ├ 配色方案（读取/保存，网格）
│          ├ [名字替换]
│          ├ 更多操作...（导航菜单）
│          ├ 分享...
│          └ 书籍信息
├─ 底栏  [◀章] [进度条0–1000] [百分比→跳转对话框] [↩回退] [章▶]
│     └ 按钮行(1行或2行，可自定义)：屏幕方向｜日夜｜朗读｜自动滚屏｜目录｜书签｜亮度｜字号｜搜索｜倾斜｜
│                                    可视｜控制｜其它｜配色｜设置选项｜关闭｜双页｜自定义｜云同步↑｜云同步↓
│          └ 每个按钮长按 → 小菜单（§VIEW-005）
├─ 浮层面板：字号面板 / 亮度+蓝光面板 / 搜索条(他人) / TTS 面板(他人) / 提示面板(自动滚屏手势图)
├─ 可视选项 PrefVisual（自上而下）
│     文字编码｜文字大小(整数+小数滚轮)｜文字颜色｜背景颜色｜背景图片(选中标记)｜[透明度(隐藏)]｜字体名称｜
│     粗体｜斜体｜下划线(实线/虚线)｜阴影｜平滑｜两边对齐｜断字(+词典下拉)｜中文书籍排版｜紧凑模式｜竖排｜
│     简繁转换｜繁简转换｜
│     段间距｜行间距｜字间距｜字体伸缩｜[重置]｜
│     左/右/上/下 页面空白｜[重置]｜
│     [保存为配色方案][读取配色方案]｜
│     翻页动画(下拉+8 缩略图)｜翻页速度｜[重置]｜允许左右划动翻页｜触碰时禁止上下滑动｜
│     底部：控制选项 / 其它选项 按钮
├─ 控制选项 PrefControl
│     屏幕方向｜摇动手机｜屏幕触碰事件(点击上/下/左/右、切换左右模式、[设置点击模式]、长按屏幕、长按触发时间)｜
│     硬件按钮(主页/返回/菜单/搜索/摄像头/音量±/方向键×5/耳机/媒体×3)｜屏幕划动手势×4｜阅读状态栏(点击×3、长按×3)｜[重置]
├─ 其它选项 PrefMisc（与阅读相关的部分）
│     全屏模式[齿轮:浸入式/透明系统栏/刘海]｜阅读时保持屏幕长亮[齿轮:+N分钟]｜擦动左边沿调亮度[齿轮:边/按键背光/亮度条]｜
│     擦动右边沿调字号[齿轮:哪条边]｜翻页时保留一行｜自动打开上次文件｜显示小型阅读状态栏[齿轮→PrefStatusSetting]｜
│     显示剩余阅读时间[齿轮]｜智能排版：首行缩进[齿轮:字数]｜删除多余空格空行｜TXT 新章换页｜
│     自动滚屏：模式｜EPUB：内置字体[齿轮:字体文件夹]｜禁用 CSS[齿轮:8 项]｜章末提示｜出版商格式预览按钮｜直接显示注解｜FB2 CSS｜
│     护眼：连续阅读提醒[齿轮]｜固定时间提醒[齿轮]｜蓝光过滤+过滤量｜
│     TTS 选项(他人)｜特殊选项：倾斜翻页[齿轮]｜多点触摸字号｜左右划动翻页[齿轮]｜禁止上下滑动｜双页布局[齿轮]｜翻页声音[齿轮]｜
│            打开书动画｜跟随系统深色｜屏幕边缘防误触[齿轮]｜云同步(他人)｜
│     名字替换｜链接颜色｜标注弹窗颜色｜图片相关选项｜自定义词典(他人)｜自定义阅读器工具栏｜[备份/恢复]
├─ PrefStatusSetting：放顶部｜放刘海下｜电量/时间｜章节｜进度｜12 小时｜自定义字体颜色(字体、颜色)｜文字大小｜边框空白｜背景颜色｜点击/长按×3｜重置
├─ 配色方案 PrefTheme：网格(150×120dp)｜只更改颜色配置｜自动日夜(齿轮)｜跟随系统深色｜(保存模式：名称框+保存)
├─ 取色器 ColorDialog；字体选择 PrefFontPick；背景图选择 PrefImageBrowser1；透明度/模糊 对话框
└─ 速读 PrefSpeedRead（全屏黑底）
```
Web 对应：右侧 Drawer（三个设置页 tab）、底部/顶部浮栏、Popover 菜单、全屏 Modal（速读/取色器/主题）。

---

## 7. 存疑与未确认点

1. **默认值来源不全**：`A` 里许多字段的 Java 静态初值被 jadx 吞掉，默认值取自 `LoadOptions`/`set_default_*`（已核对）；仍有少量读取值依赖运行时（如 `fitCutout` 初值、`statusFontSize` 平板/低分平板取值、`isChinese/isTablet/isFullScreenPhone` 判据）。`dr()` 为 `round(dp × density)`，边距默认的 dp 数以反推给出，实测可能差 1–2dp。
2. **`lastTheme` 默认值为字符串 `"DAY_THEME"`**（读取时），而不是常量 `"Day Theme"`；`isNightState()` 用 `lastTheme.equals(NIGHT_THEME)` 判断，首次读取默认 `"DAY_THEME"` 不等于夜间主题，因此没问题；但 `A.getThemeId("DAY_THEME")` 不会命中 —— 疑似原版遗留，复刻时应统一为 `"Day Theme"`。
3. **Night 2 主题字色为纯黑**（`pFontColor=-16777216` 搭配 `readbg223` 深蓝灰底），对比度极低；也可能是 assets 打包时遗漏了字色。复刻建议改为 `#CCCCCC` 之类，或保持并标注“原样”。
4. **字号长按菜单文案与行为不符**：菜单写「字体大小 +0.5 / −0.5」，代码 `A.fontSize += 1.0 / −= 1.0`。
5. **亮度语义**：Android 窗口亮度 + 遮罩；Web 无法设置系统亮度，§VIEW-007 的重映射是我们的设计，需产品确认。
6. **行高标定**：`setLineSpacing(0, mult)` 乘的是字体自然行高（含 ascent/descent，随字体和 CJK 回退字体变化，通常 1.17–1.45em），CSS `line-height` 需要按实际字体测算；字体渲染差异也会使“每页行数”与原版不同，本文不承诺逐像素一致。
7. **`SoftHyphenStaticLayout`（7.8k 行）与 `MyLayout`**：只读了行高/空行/缩进/两端对齐/标点判定相关段；CJK 避头尾的完整字符表、紧凑模式的具体例外（句号+引号压缩）、断字插入连字符的细节、浮动文字绕排、表格布局、ruby 行距调整均未逐行核对。`MRTextView` 的竖排绘制（`vDrawText`）与日文特例也只读了入口。
8. **`MRBookView`（WebView 渲染）**：`useWebView` 与「出版商格式预览」(`showChromeButton`) 走系统 WebView，注入 `body{margin…;color:…}` 样式；本文未展开其交互（`disableFunctionsInWebView` 禁用了哪些按钮等）。
9. **Google 风格翻页**：常量可通过 `setLeftStartX/…` 调节但未找到 UI/调用者；双页复杂曲线的 `rotatePoint` 细节（z 上限 `0.3W/…`）只摘了主干；视觉在不同机型上是否一致未验证。
10. **仿真翻页取页策略**：`get3dCurlShot`/`createCachePageShots`/`HighQuality3D` 的缓存/预渲染时机与内存策略（`RGB_565`、两段式取图）读得较浅；Web 版需要自己设计相邻页预渲染。
11. **自动滚屏速度公式**：各模式公式已逐条抄出（§4.6），但没有做“speed→px/s”的实机标定；卷帘模式 0 在 `speed<50` 时用整数除法，低速端（speed 接近 0）的每 tick 位移很大（上百 px），是否为设计意图未确认。
12. **按钮 18/19（云同步）与 Pro 限制**：朗读、倾斜翻页、耳机键、开书动画、名字替换等标注了 Pro；Web 版是否保留 Pro 开关需要产品决定（计划中应视为全开）。
13. **TXT 页码**：`getTotalPages()/100000` 的单位换算（`getAboutCurrentPage` 的权重）只确认了公式，未确认实际精度。
14. **CSS 选择器覆盖面**：只确认了 tag/.class/tag.class/#id/后代组合；`@media`、`>`、`+`、属性选择器、`::first-letter` 等是否被解析需用真实 EPUB 回归（首字下沉走的是 `float:left` 的首字符 span，不是伪元素）。
15. **未读代码区**：`PicGalleryShow`（图片浏览，图片点击/长按/幻灯片 `gallerySlideshowInterval`）、`PrefImageBrowser1`（背景图选择器）、`PrefEditBookmark`、`MediaAct`（音视频）、`pdfXxx`（PDF 路径）、`ColorTemplate`（高亮配色模板，归标注）、`WidgetProvider`；Misc 的「图片相关选项」对话框字段未展开。
16. **交叉引用**：位置/书签/高亮/笔记数据结构、章节列表、搜索面板、TTS 面板、云同步（Dropbox/GDrive/WebDAV）分别见另两份规格。
17. **字体授权**：assets 内置 4 个 TTF（Arial、Times New Roman 为商业字体）与 `res/raw` 的 arimo/cousine/amiri/texgy（PDF 用）若要随 Web 版分发需确认授权；建议用开源替代（Noto Serif/Sans CJK、Liberation）并保留“用户自带字体”。
18. **主题字段单位**：边距存 px（设备像素），跨设备同步时需统一为 dp 或相对屏幕比例；`fontSize` 以 sp 保存（受系统字体缩放影响）。
