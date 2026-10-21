# 03 内容层规格：书籍格式、目录与跳转、选择与标注、搜索、朗读、词典翻译、PDF 与漫画

> 调研对象：静读天下 Moon+ Reader Pro 7.3（`com.flyersoft.moonreaderp`）。
> 来源：`/work/analysis` 下 jadx 反编译源码与 apktool 资源。下文「源码」一栏写 `类.方法` 或 `文件:行号`（行号为 jadx 产物行号）。
> 范围：格式与内容处理、目录/链接/脚注、选词与标注/书签、搜索、TTS、词典翻译、简繁/注音、图片画廊、PDF/DJVU、CBZ/CBR。排版/主题/翻页动画/点击区/状态栏（另一位）与书架/同步（另一位）只做交叉引用。

---

## 1. 概览

Moon+ 的阅读器是**一个巨型 Activity（`ActivityTxt`）+ 一套全局静态状态（`A`）**。所有格式在内部被归并为三类「书」（`A.getBookType()`，A.java:4198）：

| bookType | 含义 | 文件类型（`A.getFileType()` 返回值） |
|---|---|---|
| 0 | 纯文本流（TXT 型，整本读入内存、按固定块切分） | 0=txt（**未知扩展名也按 TXT**）、3=zip、9=rar、13（未用） |
| 1 | 单文件 HTML | 1=htm/html |
| 100 | 章节式电子书（继承 `BaseEBook`，有章节列表、HTML 文本、CSS、图片/脚注回调） | 2=epub/epub3/mobi/azw/azw3/prc、4=umd、5=fb2/fb2.zip、6=chm、14=docx、15=odt、16=rtf、17=md（8=旧 Mobi 解码器，仅 `loadEBook` 兜底用） |
| 7 | 页面式（Radaee 渲染引擎：PDF / DJVU / CBZ / CBR） | 7=pdf、12=djvu、10=cbz、11=cbr |

文本类（0/1/100）统一进入自研文本排版控件 `MRTextView`（分页/滚动由另一位负责）；选择、高亮、搜索、TTS 都是**作用在这个 Spanned 文本的字符偏移上**。页面类（7）由第三方 Radaee 引擎（`com.radaee.*`，原生库 `librdpdf.so`、`libmydjvu.so`）渲染，选择/高亮/搜索/TTS 另有一套页码+字符序号的实现；并提供一个「文本重排」模式把 PDF 页文本转成文本流，复用文本排版管线。

对 Web 复刻最关键的几点（详见各条目与第 4 节）：

1. **位置模型**：标注/书签/进度都存 `(lastChapter, lastSplitIndex, lastPosition)` 三元组，含义随书类型而变（TXT=原文字符偏移；章节书=章节号+拆分段号+段内排版文本偏移；PDF=页号+页内字符序号）。Web 必须换成更稳的锚定（文本引用 + 章节内文本偏移 + 页内字符序号），并可选做 `.mrexpt` 兼容导入。
2. **TXT 是最复杂的「格式」**：编码嗅探（含按 UI 语言分支的启发式）、两套自动分章算法、`txts` 固定块、空行/缩进/去空白三个显示变换且**不影响持久化偏移**。
3. **TTS 是「按句排队 + 句末回调高亮 + 翻页/换章继续」模型**，并有 Pro 限制、定时停止、句间隔、过滤规则表、音频焦点/耳机键/后台。
4. **词典主要靠 Android Intent 调外部 App**，Web 只能改成 URL 模板/内置词典/代理。
5. **PDF 标注直接写回 PDF 文件**（markup annotation）并同时进 DB 供列表和同步；DJVU/CBZ 只读。

---

## 2. 功能清单

排版约定：每条含 `界面文案`、`行为`、`源码`、`设置项`、`Web 建议`、`可行性`、`优先级`。可行性：`[浏览器]` / `[服务端]`（说明服务端要提供什么）/ `[不做: 原因]`。

> 条目统计：共 92 条，其中 **P0 40 / P1 29 / P2 19**（按每条首个优先级计；4 条为交叉引用或「不做」：ANNO-013、MISC-005/006/007）。一条里含多个子能力时优先级分写，如 `P0（…）/ P1（…）`。

### 2.1 格式与内容处理（FMT-）

#### FMT-001 格式识别与支持清单（含全部扩展名）
- **界面文案**：无；打开失败提示「不支持此文件」(`invalid_file` / "Failed to load file.")；DRM 书提示「本书已被DRM数字技术加密, 请先在电脑去除DRM加密信息」(`drm_hint`)。
- **行为**：
  - **按扩展名（忽略大小写）判定**，`A.getFileType(String)` A.java:5013–5059：`.txt`→0；`.html/.htm`→1；`.epub/.epub3` 与 `isMobiExt`（`.mobi/.azw/.azw3/.prc`，A.java:8815）→2；`.fb2/.fb2.zip`→5；`.zip`→3；`.rar`→9；`.cbz`→10；`.cbr`→11；`.umd`→4；`.chm`→6；`.pdf`→7；`.djvu`→12；`.docx`→14；`.odt`→15；`.rtf`→16；`.md`→17；**其余一律 0（当 TXT 读）**。
  - 文件管理器「可列出/可导入」集合 `A.isSupportedFile` A.java:8895：txt, htm, html, epub, epub3, mobi/azw/azw3/prc, zip, rar, cbz, cbr, umd, pdf, djvu, docx, odt, rtf, md, fb2, chm。`A.isReadableFile` A.java:8872（用于「同目录上一本/下一本」）：同上去掉 zip/rar，加 `fb2.zip`。
  - 图片（画廊直接打开）`A.isImageFileExt` A.java:8744：`.png .jpg .jpeg .gif .webp .svg`。
  - Android 清单里声明的「用本应用打开」：`.fb2 .fb2.zip .txt .rtf .pdf .odt .mobi .md .epub .docx .djvu .chm .cbz .cbr .azw3` + MIME（`application/epub+zip`、`application/x-mobipocket-ebook`、`application/x-fictionbook`、`application/x-chm`、`application/vnd.ms-htmlhelp`、`application/x-cbz`、`application/vnd.comicbook+zip`、`application/x-cbr`、`application/vnd.comicbook-rar`、`application/pdf`、`application/djvu`、`text/plain`、docx MIME、`image/*`、`text/*`）；另有 `epub://`、`http`、`content`、`file` scheme（AndroidManifest.xml）。
  - **压缩包**：`.zip/.rar` 在文件管理器里当「虚拟文件夹」浏览（路径形如 `book.zip?inner/path.epub`），点内部文件时先解到缓存再按普通文件打开（`BaseCompressor.getZRCacheFile`）；内部若是图片则进画廊。zip 文件名编码按 UI 语言猜：zh→`EUC-CN`、ko→`EUC-KR`、ja→`EUC-JP`，其他默认（`MyAntZip` 构造器）。**无 zip 密码支持**。解析顺序：`.rar/.cbr` 先 `MyUnRar`（junrar），失败退 `MyAntZip`；其余反之（`BaseCompressor.createZipper`）。
  - **不支持**：`.7z`、`.cb7`、`.cbt`、`.lit`、`.doc`（旧 Word）、`.azw`(DRM 版)、带 DRM 的 EPUB/MOBI。
- **源码**：`A.getFileType` A.java:5013；`A.getBookType` A.java:4198；`A.loadEBook` A.java:9079；`BaseCompressor.createZipper`；AndroidManifest.xml intent-filter。
- **设置项**：导入过滤 `importEpub/importTxt/importHtml/importFb2/importChm/importMobi/importCbz/importUmd(=docrtf)/importPdf`（默认 true，属书架与同步分区文档）。
- **Web 建议**：拖放/文件选择器 + `<input accept>`；PWA 在 manifest 声明 `file_handlers`（Chromium）；扩展名白名单直接照抄；未知扩展名按文本嗅探（可不照搬「未知=TXT」，建议探测二进制后拒绝）。zip 文件名：若无 UTF-8 标志位(bit 11)，用 `TextDecoder('gbk'|'shift_jis'|'euc-kr')` 按用户语言/内容猜。
- **可行性**：`[浏览器]`；RAR 见 FMT-020。**优先级**：P0

#### FMT-002 TXT：编码检测与手动指定编码
- **界面文案**：「文字编码」(`text_encoding` / "Text Encoding")，下拉列表 `R.array.charsets`：`AUTO, UTF-7, UTF-8, UTF-16, UTF-16BE, UTF-16LE, UTF-32, UTF-32BE, UTF-32LE, US-ASCII, BIG5, CP864, CP866, CP874, EUC-CN, EUC-JP, EUC-KR, GBK, GB2312, KOI8-R, SHIFT-JIS, x-JIS7, x-JIS8, Macintosh, Adobe-Standard-Encoding, ISO-8859-1…16(无12), ISO-2022-JP, Windows-950, Windows-1250…1258`。入口在「视觉选项」`PrefVisual`（PrefVisual.java:769 保存）。
- **行为**：
  1. 读取顺序：每文件覆盖（SharedPreferences `file_encoding`，键=文件路径）→ 全局默认 `A.textEncode`（`getDefaultTextEncode`：首次为空时，**亚洲语言 UI → AUTO，否则 UTF-8**，A.java:4528）。
  2. AUTO 时 `A.getFileEncode`(A.java:4848) 先看 BOM：`FF FE`→UTF-16LE，`FE FF`→UTF-16BE，`EF BB BF`→UTF-8；无 BOM 且是 HTML 且头 4096 字符（按 UTF-8 解）含 `charset=UTF-8`/`charset="UTF-8"` → UTF-8。
  3. 仍未定：按 **UI 语言/地区** 兜底（A.getFileSavedEncode A.java:4953）：国家 CN→`GB2312`；TW/HK→`BIG5`；否则 `UTF-8`，但若语言是日语(`ja`/JP)或俄/乌(`ru`/`uk`)，且按 UTF-8 解头 1024 字符里 U+FFFD 个数 >5，则改 `SHIFT-JIS` / `Windows-1251`（`getErrCharCount` A.java:4715）。
  4. **中文 UI** 时再校验：`getCnSampleTextVal`(A.java:4325) 读头 4096 字符，统计是否包含「的」「了」「是」(UTF-16LE 不计)「在」各+1；若当前编码得分≠0 就采用；否则 `detectChineseEncode`(A.java:2917) 分别用 UTF-8/UTF-16LE/GBK/BIG5 算分，四者全等→保持；否则取最高分（并列优先级 UTF-8 > UTF-16LE > GBK > BIG5）。
  5. **韩语 UI**：若当前编码下 U+FFFD>5，且当前不是 EUC-KR 而 EUC-KR 下<3，则改 EUC-KR；若当前是 EUC-KR 且 UTF-8 下<3 则改 UTF-8（`detectKoreanEncode` A.java:2938）。
  6. 编码名不被 JVM 识别（`UnsupportedEncodingException`）→ 清除该文件覆盖、全局重置为默认、报错（ActivityTxt.loadTxtHtmlFile 10194）。
  7. FB2/CHM 另有各自的编码来源（FB2 取 XML 头 `encoding=`，CHM 取 CHM 头字符集），也可被同一「文字编码」覆盖（Fb2.getXmlEncoding、Chm.getEncoding）。Md 默认 `UTF-8`。
- **源码**：`A.getFileSavedEncode`、`A.getFileEncode`、`A.getEncode`(A.java:4692)、`A.detectChineseEncode`、`A.detectKoreanEncode`。
- **设置项**：`textEncode`（默认见上）、`file_encoding[文件]`。
- **Web 建议**：BOM → 严格 UTF-8 校验（`new TextDecoder('utf-8',{fatal:true})`）→ 对候选集 `gb18030/big5/shift_jis/euc-jp/euc-kr/windows-125x/koi8-r` 用 chardet 类库（`jschardet`/`chardet`/`encoding-japanese`）+ 常用字频打分；**不要依赖 UI 语言**，改为按内容判断。`TextDecoder` 原生支持 `gbk/gb18030/big5/shift_jis/euc-jp/euc-kr/utf-16le/be/windows-125x/iso-8859-x/koi8-r`；`UTF-7/UTF-32/x-JIS7/Adobe-Standard/CP864` 用 `iconv-lite` 补。提供「手动选择编码」弹窗（每书记忆）。
- **可行性**：`[浏览器]`。**优先级**：P0

#### FMT-003 TXT：自动分章（目录生成）
- **界面文案**：目录标签「目录」；无章节时目录为空；设置「TXT书籍在新的一页显示下一章节」(`txt_chapter_split` / "Display new txt chapter in next page (for txt book only)")。
- **行为**：`A.getTxtChapters()` A.java:6721 先跑「关键字法」`getTxtChapters1`；**仅当 UI 语言为中文**再跑「行特征法」`getTxtChapters2`，条数更多者胜；非中文 UI 且章节>10 时按标题长度剔除异常长标题。**判定完全由 UI 语言(`A.isChinese`、`A.isAsiaLanguage`、`A.isRussian`)与「中文书籍排版」(`textCJK`)驱动，不看书本内容。**完整规则见第 4.2 节。要点：
  - 关键字法：CJK/亚洲语言搜「第」，俄语「Глава」，其他 `chapter`（不区分大小写）；关键字前一个字符须是空白/`#`/`【`；整行作为标题；CJK 要求 3≤长度<40（或<80 且以 `]`/`)`/`）` 结尾）且含「第…(卷|章|回|集|話|節|节|折)」；非 CJK 要求长度<100(亚洲 80) 且关键字位置 < 长度/4；与上一章间距<100 字符则合并（删前一个）。
  - 行特征法（中文）：扫短行（≤40，含 `###` 标记时 ≤80），行末不是标点或「全书有缩进而本行无缩进」，行首（跳过空白/`#`/`【`）是数字或中文数字（一二三四五六七八九十零〇）等，分成 4 个候选池（数字序号递增池、中文数字/数字前缀池、孤立短行池、`##…##` 标记池），按规则挑一个；最终<4 条则视为「无章节」。
  - 章节对象 `TxTChapter`：`chapter`(原行)、`chapter_trim`(清洗后标题)、`position`(原文字符偏移)、`displayPos`(显示偏移，懒算)。标题清洗 `trimChapterTitle2`：若不是 `#…#` 包裹，删除标题里位置>3 的 `[…]`/`(…)`/`（…）` 注释（且括号内容长度>4）；开启「段首缩进」时把连续空格压成一个。
- **源码**：`A.getTxtChapters1` A.java:6780、`A.getTxtChapters2` A.java:7290、`chapterLengthOk` 2056、`chineseChapterTagOk` 2137、`hasChapterTag` 8443、`isPreChapterTag` 8851、`isChapterNumber` 8572、`trimChapterTitle1/2` 10558/10575、`removeTooCloseChapter` 9513、`TxTChapter` 1139。
- **设置项**：`txtChapterSplit`(false)、`textCJK`、`indentParagraph`。
- **Web 建议**：Web Worker 里实现；**不要用 UI 语言做开关**，改为「统计 CJK 字符占比」自动选 `第…章` 与英文 `chapter N` 两套；对「第X章/卷/回/集/节」「Chapter N」「Part N」「数字+顿号/点」「## Markdown 标题」「全角空格缩进+短行」做规则集；允许用户在「书籍设置」里编辑自定义分章正则（原版没有）。验证样本需包含无章节的短篇、`第一章`/`一、`/`001`/`Chapter 1` 多型。
- **可行性**：`[浏览器]`。**优先级**：P0（规则细节存疑点见第 6 节）

#### FMT-004 TXT：段落、空行、缩进、去空白
- **界面文案**：「删除多余空格和空行」(`trimBlacnkSpace`)；「段落首行缩进」(`indent_paragraph`)；缩进长度 `indentLength`（默认 2 个全角空格）。
- **行为**：
  - 读入后统一换行：`\r\n`→`\r`→`\n`，孤立 `\r`→`\n`（`A.getTxtDisplayText` A.java:8158）。
  - `trimBlankSpace`（默认 false，文案「删除多余空格和空行」）——**实质是「硬折行合并 + 去空行」**：TXT 显示文本经 `doTrimTxtSpace`（A.java:3008）：① NBSP/U+3000/Tab→空格并合并连续空格；② 对第 2 个字符起的每个 `\n`：若**前一字符不在** `" -.,;?\"':)。；”：？！）…"` 且**后一字符既不是 `\n` 也不是空格/NBSP**，就认为是被硬折行打断的句子，把 `\n` 换成「一个空格」（前一字符类别不是 `OTHER_LETTER`，即拉丁文）或「直接删除」（CJK），即把 80 列硬折行的段落接成一行；③ 最后 ` *\n *`→`\n`，连续 `\n`→单个 `\n`（所以空行全被删）。章节书里的纯文本章（UMD/MD 之外 `A.cleanHtml` 的非 HTML 分支）用较简单的 `doTrimBlankSpace`（A.java:3003）：只做空格合并与空行合并，不做折行合并。
  - `indentParagraph`（默认=是否中文 UI）：NBSP/U+3000/Tab→空格并合并，行首空格去除，若文本不是「双换行分段」且为中文，把 `\n` 变 `\n\n`（`doIndentParagraph` A.java:2992），之后排版器给每段首行补 `indentLength` 个全角空格。
  - **双换行/有无缩进自动判定** `A.isTxtDoubleBreak` A.java:8911：取第 2 块（只有 1 块取第 1 块；>2000 字符先跳过前 500 字符那一行）作样本，统计行数 N、`\n\n`(或 `\r\n\r\n`)出现次数 M、以空白/全角空格开头的行数 K：`M > N/4` → 「双换行」；是否「有缩进」按 `K > N/2`（双换行时 `N/4`）判定（反编译极性存疑，见第 6 节）；结果缓存于 `txtDoubleBreak/txthasIndent`，并被分章算法使用。
  - **关键约束**：以上变换只改显示文本；**标注/进度的 `lastPosition` 始终是未变换原文偏移**，靠 `getTxtRealPos`/`getTxtDisplayPos`（A.java:8169/8138）在「块」粒度上补偿（比较 `txts`(原文块) 与 `txts2`(显示块) 长度差）。
- **源码**：见上；`A.getTxts2` A.java:8210。
- **设置项**：`trimBlankSpace`(false)、`indentParagraph`(zh→true)、`indentLength`(2)。
- **Web 建议**：渲染层用 CSS：`text-indent: 2em`、`margin` 段距；去空行/空格在**显示文本**层做，且保留「显示偏移↔原文偏移」映射表（每次变换记录被删字符位置，二分换算），否则标注会错位。
- **可行性**：`[浏览器]`。**优先级**：P0

#### FMT-005 TXT：大文件分块与内存
- **行为**：整本按 `fixedBlockLength` 字符一块读入 `A.txts`（**手机 2048、平板 4096**，A.java:1250），块内存放原文；`A.getPriorTxtLength(i)`=前 i 块字符总长（等价 `i*blockLen`）。若已读 >`BIG_FILESIZE`(1,000,000) 且低内存，则**停止加载并提示**「已打开文本大小: N」(`low_memory_limits`)。启动时若上次位置<一块，先读前 3 块「预显示」(`inPreShow`) 提速，并有首屏文本缓存 `getTxtFileCache`。字数统计按块惰性计算 `A.txtWordCount[]`（`BaseEBook.getTxtUnReadWordCount`）。
- **源码**：`ActivityTxt.loadTxtHtmlFile` 10194；`A.fixedBlockLength` A.java:482/1250；`A.BIG_FILESIZE` A.java:162。
- **Web 建议**：`File.stream()` + `TextDecoder({stream:true})` 分块解码；块大小可放大到 64–256 KB 并存 IndexedDB；排版层用虚拟列表，只渲染视口±N 屏；章节边界/搜索都在 Worker 里跑，避免主线程卡顿。**位置仍用「解码后原文 UTF-16 偏移」以便导入导出兼容。**
- **可行性**：`[浏览器]`（>200 MB 的 TXT 建议服务端切块）。**优先级**：P0

#### FMT-006 HTML/HTM 单文件书
- **行为**：读全文（同编码逻辑，去 HTML 注释 `T.deleteHtmlComment`），存为 `htmlText`；超过 `maxHtmlChapterSize`(默认 100000 字符) 就按「~10 万字符之后的下一个 `<p`/`<div`（>20% 内找不到则取下一个 `>`）」拆成 `splitHtmls`，位置 = (splitIndex, 段内偏移)（`A.createSplitHtmls` A.java:2608、`adjustChapterHtml`）。目录沿用 TXT 的 `getTxtChapters`（按文本找章节，见 PrefChapters.refreshChapters）。可切「Chrome 按钮」用 WebView 全 CSS 渲染。
- **设置项**：`maxHtmlChapterSize`(100000)、`useWebView`(false)、`showChromeButton`。
- **Web 建议**：浏览器本身即「WebView 模式」；用 `DOMParser` 解析并 sanitize（DOMPurify），脚本一律不执行；目录用 `h1–h3`+同 TXT 规则。
- **可行性**：`[浏览器]`。**优先级**：P1

#### FMT-007 EPUB 2/3 解析
- **行为**（`Epub` 类，2734 行）：
  - 以 zip 打开（先 `MyZip_Java`，失败退 `MyZip_Apache`；`MyZip_Base.createZipper`）。找 OPF（`container.xml`→`getOpfFilename`）。
  - 元数据：`dc:title`(书名)、`dc:creator`(多作者以 `\n` 连接)、`description`、`dc:subject`(分类，<50 字符且非 `<`)、`meta` 里 series 信息（`extractSeries`）；`ISBN` 另有 `BaseEBook.getISBN` 文本扫描。
  - **目录**：`toc.ncx`(`getChaptersFromToc`/`addNCXChapters`，递归 navPoint，`treeTOC` 标志与 `indent`)；EPUB3 `nav[epub:type=toc]` 的 `ol/li`（`addEpub3NCXChapters`）；若 NCX 与 nav 的条数不同取更多者；无目录则用 spine 顺序（章节名为序号 "1","2"…，`getChaptersFromOpf`）。OPF 有 `<tours>/<site>` 老式目录也支持。
  - 只有 1 个章节时 `trySplitChapters`：在首 40000 字符（或末 10000 字符）内找 `href="#id"` 链接表，据对应 `id/name` 切成多个章节（要求>3 个）。
  - **封面**（`getBookCoverItem` Epub.java:570）按优先级：EPUB3 `properties="cover-image"` → `<reference type="cover|coverimagestandard|other.ms-coverimage-standard">` → `<meta name="cover" content=id>` → spine `idref="coverpage|cover"` → manifest `id="coverpage|cover"` → 第一个 `idref`；若指向 XHTML 则再解析其中 `<image xlink:href>`/`<img src>`；兜底文件名以 `cover` 开头的 jpg/png。
  - **DRM 检测** `isDrmProtected`：存在 `encryption.xml` 且存在 `rights.xml`/`signatures.xml`/`zhangyue-expansion.xml` → 弹「本书已被DRM…」并退出阅读器。
  - 单章最大 `getMaxHtmlSize`：普通 `A.BIG_FILESIZE`(1,000,000)；mobi 3,000,000。
- **源码**：`Epub.java`（`getChapters` 2345、`getChaptersFromOpf` 1105、`getChaptersFromToc` 1345、`getBookCoverItem` 570、`isDrmProtected` 2702）。
- **Web 建议**：用 **foliate-js**（`epub.js`+`overlayer.js`+`search.js`+`progress.js`，支持 EPUB/MOBI/KF8/FB2/CBZ，含 CFI、分页器、批注叠层）或 `epub.js`；zip 用 `fflate`/`JSZip`；封面按上述优先级取（foliate 自带 `getCover`）。
- **可行性**：`[浏览器]`。**优先级**：P0

#### FMT-008 EPUB/章节书：章节拼装、无目录文件、图片章
- **行为**：
  - **spine 中不在目录里的 XHTML**，会被并入前一个目录章（`checkChapterAdditionalText`，Epub.java:261，章间插入分页标记 `MyHtml.PAGE_BREAK`，并记入 `chapter.usedFiles`）；若相隔>3 个文件则用 `#MORE#` 标记延迟加载。第一个目录项之前的内容作为「书名」章插在最前（`contentBeforeChapter`）。
  - 多个目录项指向同一文件的不同 `#id`：按 id 把文件切成多个逻辑章（`HAS_ID_TAG`，`getChapterTextWithIDTag`）。
  - **图片章**：文本<600 字符且只含一张图 → `hasImageOnly`，用全屏图片展示。**空章**（<200 字符无图无文字）→ 居中显示章节名 `<center><h2>名</h2></center>`（`ifContentEmpty`）。
  - 章节名>403 字符截断为 400+`...`；残缺章（`brokenChapter`>2 个且不是全部）会被删除。
  - 「章末提示」：`chapterEndPrompt`(默认 false)开启时每章末尾追加右对齐的淡蓝色(#6060EE)下划线小字 `(翻页加载下一章"下一章名")`（拼接 `CHAPTER_END_HTMLHINT1 + chapter_end文案 + (亚洲语言无空格否则一个空格) + "章名" + HINT2`，英文文案 "Page down to next"；窄屏放不下时折成两行），TTS 会跳过该提示（见 TTS-009）。
- **Web 建议**：按 spine 顺序为「物理分段」，目录只提供导航锚点；不必合并 spine 项，但要保证「不在目录的 spine 项」可连续阅读（foliate 的 section 模型即如此）；章节名过长截断；图片章用 `object-fit: contain`。
- **可行性**：`[浏览器]`。**优先级**：P0

#### FMT-009 CSS 与 HTML 子集
- **行为**：Moon+ **不是完整浏览器**：`HtmlToSpannedConverter` 仅识别标签 `a aside audio b big blockquote br center cite code dd del div dl dt em figcaption figure font hr i image img kbd li nav ol p pre rb rp rt ruby s section small span strike strong sub sup table td th tr tt u ul video`（+ `h1–h6`），表格以「缩放图标」呈现（点击在 `PrefHtmlViewer` WebView 中显示，见 TOC-009）；CSS 由 `CSS.java` 解析成 span，可逐项关闭。
- **界面文案**：「禁用电子书内置的CSS样式表」(`disable_css`)；子项（`disable_css_styles`）：禁用字体类型(粗/斜/下划线)、禁用字体大小(small/large/em)、禁用指定颜色(文本/背景)、禁用对齐(左中右)、禁用对齐(全书两端对齐)、禁用缩进(px/pt/em/in)、禁用段落间隔(margin/padding)；「禁用书籍CSS属性里指定的链接颜色」(`disable_css_link_color`)；「禁用其他属性(边框, 背景图片等)」(`disable_css_others`)；「链接颜色」(`link_colors`)、「标注弹窗颜色」(`popup_note_color`)。
- **设置项**：`disableCSS`(false)、`cssFontStyle/cssFontSize/cssFontColor/cssAlignment/cssJustify(默认 true)/cssIndent/cssLineSpace/cssOthers`(默认 false)、`disableLinkColor`(false)、`useCssFont`、`linkColor`(=`CSS.LINK_COLOR`)、`linkVisitedColor`、`noteTextColor`(#FF111111)、`noteBackColor`(#FFF6EA8C)（含夜间各一套）。
- **Web 建议**：直接用浏览器渲染 + 注入覆盖样式表（`!important` 去除书内 `font-size/color/text-align/text-indent/margin`），每个开关对应一条覆盖规则；iframe/Shadow DOM 隔离书籍 CSS（foliate 用 iframe）。
- **可行性**：`[浏览器]`。**优先级**：P1

#### FMT-010 EPUB 内嵌资源：图片、SVG、字体、音视频
- **行为**：图片类型 png/jpg/jpeg/gif/webp/svg（SVG 用 androidsvg）；字体从 `@font-face` 的 zip 内文件取（`getFontFile2`），需用户点「确认」激活字体（`use_css_font_now`）；`<audio>/<video>` 在文本里以图标占位（`#audio#…`/`#video#…`），点击 `playMp3`（页内迷你播放条：播放/暂停/停止/进度/时长）或 `MediaAct` 全屏 `VideoView`+`MediaController`（`ActivityTxt.isMediaSpan` 9391、`playMp3` 21752、`MediaAct`）；`imageWhiteTransparent` 可把白底图变透明。
- **设置项**：`imageWhiteTransparent`(false)、`fitImageToScreen`(false，「把所有图片扩大到屏幕宽度」)、`longTapImageFullScreen`(true，「长按图片时用全屏模式打开」)、`galleryWhiteBackground`(false，「全屏时使用白色背景」)。
- **Web 建议**：资源通过 `URL.createObjectURL`/Service Worker 拦截 `epub://` 相对路径；`@font-face` 注入 `FontFace` API；音视频用原生 `<audio>/<video controls>`；白底透明用 `mix-blend-mode: multiply`（浅色主题）。
- **可行性**：`[浏览器]`。**优先级**：P1

#### FMT-011 MOBI / AZW / AZW3 / PRC
- **行为**：优先走**原生库 `libmloader.so`**（`com.dozof.app.MLoader`，把 MOBI/KF8 转成「虚拟 zip 文件列表」后交给 `Epub` 类处理，`MyZip_Mobi`），失败（仅 armeabi/x86 且报 `Incompatible`）才回退老 `Mobi` 类（`MobiDecoder`：PalmDOC/HUFF，`<img recindex>` 替换为 `image-N`）（A.loadEpubWithOldMobi A.java:9113）。mobi 的 `<mbp:pagebreak/>` 会被清除；单章上限 3,000,000 字符；封面取 `getCoverImageIndex`/缩略图索引。**无 DRM 解密**。
- **Web 建议**：foliate-js `mobi.js`（MOBI6 + KF8，AZW3）；备选 libmobi 的 WASM。DRM 书同样提示用户。
- **可行性**：`[浏览器]`（foliate-js）。**优先级**：P0（EPUB 之后）

#### FMT-012 FB2 / FB2.ZIP
- **行为**：`.fb2` 直接 XML；`.fb2.zip` 或带 `PK` 头的 `.fb2` 先解 zip（取第一个 `.fb2`，或嵌套的 `.fb2.zip`）；编码取 XML 声明。元数据：`author`、`book-title`、`annotation`、`genre`、`sequence`。**章节**=嵌套 `<section>` 树（`treeTOC`，`indent` 缩进；父节自身若有正文另建一章），`<body name="notes">` 的内容转成末尾「脚注」章（`footnotes`/"Footnotes"）。封面取 `<coverpage>` 的 `#id`；图片是 `<binary>` base64，抽取缓存到文件。脚注：正文 `<a type="note" l:href="#n1">` 转为 `?n1` 链接，`footnoteOnBottom` 开启时把脚注框直接插到段后（`createFootnoteBox`，样式取 `assets/fb2.css` 的 `.footnote`）。默认样式表 `assets/fb2.css`（epigraph 右缩进 25% 斜体、text-author、poem/cite 缩进 4em、subtitle 居中、`p{text-indent:2em;margin 1em}`、`.footnote{font-size:.8em; 半透明灰底; 点线框; 圆角 10px}`）。
- **源码**：`Fb2.java`（`getChaptersFromText` 461、`getChaptersFromBody` 368、`getNotesFromBody2` 780）；`BaseEBook.createFootnoteBox`。
- **Web 建议**：foliate-js `fb2.js`（XSLT→HTML）；fb2.zip 用 fflate；`assets/fb2.css` 内容可直接复用。
- **可行性**：`[浏览器]`。**优先级**：P1

#### FMT-013 UMD（掌上书苑）
- **行为**：纯文本格式，无图/无 CSS；`isHtml=false`，段分隔符 U+2029 → `\n`。解析见第 4.5 节二进制结构：魔数、元数据段（标题/作者/年月日/性别/出版商/发行商/内容长度）、章节偏移表、章节标题表、zlib 压缩的 UTF-16LE 正文块、封面 JPG。章末提示文本为 `\n\n**************************\n翻页加载下一章 "下章名"`。
- **源码**：`Umd.java`（`UMDDecoder.decode`）。
- **Web 建议**：自写解析（约 150 行）+ `fflate.unzlibSync`/`pako.inflate` + `TextDecoder('utf-16le')`；注意 `0x23('#')` 段与 `0x24('$')` 段交替读取。
- **可行性**：`[浏览器]`。**优先级**：P2

#### FMT-014 CHM
- **行为**：用纯 Java CHM 库（`com.dream.chmlib` 的 `ChmDocumentCache`）；目录来自 `.hhc`（`HHC.hChapters`，含 `indent/hasSubChapter`），主页 `homePage` 作为第一章（若 hhc 首项不是它）；章内文件按需解到缓存目录，编码取 CHM 头（可被「文字编码」覆盖），非 HTML 内容会转成 `<br>` 文本；图片同样按需解出。无 `.hhc` 时仅主页一章。
- **Web 建议**：浏览器端无成熟 CHM 库（LZX 解压+ITSF 结构），**由服务端用 `chmlib`/`7z x`/`extract_chmLib` 解成「目录 JSON + 资源文件夹」**，前端当 EPUB 类处理；或 WASM 编译 chmlib。
- **可行性**：`[服务端]`：提供 `POST /api/convert/chm` → 返回 `{toc:[{title,href,level}], files, encoding}`。**优先级**：P2

#### FMT-015 DOCX / ODT
- **行为**：**非常粗糙**：解 zip，读 `word/document.xml`（odt 读 `content.xml`），用字符串替换把 `<w:` 前缀去掉、`w:val=` 变 `class="c…"`、`tab/>`→四个 NBSP、`tc>`→`td>`、`tbl>`→`table>` 等当 HTML 渲染；图片通过 `<w:drawing>` 里 `pic:cNvPr name` 与 `word/media` 下文件名匹配，找不到则把所有图片堆在文首；odt 封面取 `Thumbnails/thumbnail.png`；**单章**（无目录），书名/作者取「文件名 - 作者」。
- **Web 建议**：`mammoth.js`（docx→语义 HTML，带样式映射，标题可生成目录）、`docx-preview`；odt 用 `odt2html`/`ODFJS` 或服务端 `pandoc`/`libreoffice --convert-to html`。
- **可行性**：`[浏览器]`（docx）；odt 可 `[服务端]`。**优先级**：docx P1 / odt P2

#### FMT-016 RTF
- **行为**：`rtfparserkit` 抽取纯文本（`StringTextConverter`），`\n`→`<br>`；**无图/无样式/无目录**，单章；书名/作者取文件名。
- **Web 建议**：`rtf.js`/`rtf-parser` 抽文本；复杂 RTF 走服务端 `pandoc -f rtf -t html`。
- **可行性**：`[浏览器]`（仅文本）。**优先级**：P2

#### FMT-017 Markdown
- **行为**：`flexmark` 解析（扩展：Abbreviation、Autolink、删除线/下标、上标、Footnote、Attributes、Tables），`escapeHtml(true)`，`<blockquote>`→带左边框灰色斜体 div，`<pre>`→带边框 pre；**章节=每个 `<h1>`**（文首无标题内容单独成一章；至少 2 个 h1 才分章，否则单章），编码默认 UTF-8。图片从相对路径文件读取，书名/作者取文件名。
- **Web 建议**：`markdown-it` + `markdown-it-footnote` + `-abbr` + `-sub` + `-sup` + `-attrs`；h1 分章（可扩展到 h2）。
- **可行性**：`[浏览器]`。**优先级**：P1

#### FMT-018 书籍元数据、封面与「书名 - 作者」文件名规则
- **行为**：EPUB/FB2/UMD/MOBI 从文件内取书名/作者/简介/分类/系列；无元数据格式（TXT/HTML/RTF/DOCX/ODT/MD/CHM/CBZ无 ComicInfo）用**文件名**：`<书名> - <作者>`（按第一个 `" - "` 切；后缀要>3 字符）（`A.getBookName` A.java:9086 等）。封面：EPUB 见 FMT-007；MOBI 取封面图索引；FB2 `coverpage`；CBZ/CBR 取排序后**第一张图**（`BaseCompressor.getCbzCoverBitmap`）；PDF 渲染首页；DOCX/RTF/MD/TXT/UMD 无封面（UMD 虽解出 `covers` 字节但 `getCoverFile` 返回 null）。
- **Web 建议**：导入时一次性解析元数据+封面并缓存；文件名规则可作为兜底。
- **可行性**：`[浏览器]`。**优先级**：P0

#### FMT-019 PDF/DJVU/CBZ/CBR 入口
见 PDF-001、COMIC-001。**优先级**：P0

#### FMT-020 压缩包（ZIP/RAR）浏览与 CBR 解压
- **行为**：见 FMT-001；RAR 用 `junrar`（Java 库，通常只支持 RAR3/4，RAR5 支持未验证），`MyUnRar.getAllList` 把 `\` 换成 `/`。
- **Web 建议**：ZIP 用 `fflate`（流式）；RAR 用 `node-unrar-js`（WASM，RAR3/4/5）或 `libarchive.js`；大于 ~300 MB 的 CBR 建议服务端解成图片流。
- **可行性**：`[浏览器]` + `[服务端]`（回退：`GET /api/archive/{id}/entries`、`GET /api/archive/{id}/entry?path=`，服务端用 `unrar`/`7z`/`libarchive`）。**优先级**：ZIP P0（CBZ 依赖）/ RAR P1

#### FMT-021 字数统计与剩余字数
- **行为**：`BaseEBook.getUnReadWordCountFrom/getTxtUnReadWordCount/getPdfUnReadWordCoun` 后台线程惰性统计每章/每块/每页字数（`T.getWordsCount(text, isAsia)`，CJK 按字、其他按词），用于「剩余阅读时间」「全书字数」；PDF 逐页取文本统计，失败会记入 `pdf_words_failed` 避免重复崩溃。
- **Web 建议**：Worker 内用 `Intl.Segmenter('zh'|'ja'|'en', {granularity:'word'})` 统计；结果缓存。
- **可行性**：`[浏览器]`。**优先级**：P2

#### FMT-022 ISBN 提取
- `BaseEBook.getISBN`：EPUB 在 `content.opf` 文本里找 `ISBN` 后第一个 `>`…`<`，仅含数字和 `-` 且<30 字符；MOBI 在全文找 `>ISBN` 或 `isbn:`。供「网络书籍信息/封面搜索」。
- **可行性**：`[浏览器]`。**优先级**：P2

### 2.2 目录、链接、脚注（TOC-）

#### TOC-001 目录面板（三个标签）
- **界面文案**：标签：「目录」、「书签」(`bookmark`)/「标注」(`annotation`)/「高亮」(`highlight`)（合在书签页里用筛选按钮切换）、「图片」（仅当电子书有图片时出现）。面板为**左侧滑出 85% 宽**半透明遮罩对话框（`PrefChapters.onCreate` 1924），顶栏：退出、倒序排序按钮(`sortB`)、删除按钮(`deleteB`，多选时才出现)。目录页顶部显示当前章「章节名 (n/N)」，右侧「展开/折叠全部」图标（有子章节时）。
- **行为**：打开时自动滚动定位到当前章（`focusHandler`）；点击章节→关闭面板并跳转；倒序开关 `chapterReversed`（目录/书签/图片共用，默认 false）；条目>50 时开启快速滚动条。滑动手势可关闭面板（`swipeToClose`，方向未核对）。
- **源码**：`PrefChapters`(2056 行)：`initView` 1152、`refreshChapters` 1222、`show_chapter` 1575、`show_bookmark` 1534、`show_images` 1605。
- **Web 建议**：左侧抽屉（Drawer）+ Tabs；移动端手势右划关闭；`position:sticky` 当前章标题；虚拟滚动处理 >5000 章（有些 TXT 会有数千章）。
- **可行性**：`[浏览器]`。**优先级**：P0

#### TOC-002 目录树：缩进、展开折叠、标题清洗、PDF 页码
- **行为**：数据源：TXT/HTML=`A.getTxtChapters()`（`chapter_trim`，恒无层级）；章节书=`ebook.getChapters()`（`name/indent/hasSubChapter/expanded`）；PDF=`pdfToc`（Radaee `GetOutlines` 递归，`pdfAddTocTree`；DJVU 用 `getOutline()`；CBZ 无目录）。树形（`indent>0`）时：缩进 `(indent-1)*15+28 dp`，有子项显示 `toc_open/toc_closed` 箭头并**粗体**，点箭头展开/折叠；一键折叠/展开全部（`tocCollapse`）。标题>150 字符且条目>20 时截断为 147+`...`；字号：普通 14sp，手机且标题≥100 字符 12sp；经 `A.chineseJianFanConvert` 转繁简；当前章用 `MyDialog.SELECT_END`（" √"）标记。PDF 条目右侧显示页码(`pageNumber+1`)，且位置由 `A.lastPosition`（页）反推当前目录条目（`pdfGetToc` 13552）。
- **源码**：`PrefChapters.ChapterAdapter` 521、`cleanChapterTitle` 875。
- **设置项**：`chapterReversed`(false)。
- **可行性**：`[浏览器]`。**优先级**：P0

#### TOC-003 目录跳转语义
- **行为**：回调 `onGetChapter(index, splitIndex, position, fromToc)`：TXT 目录项→`position` 为该章 `position`（原文偏移）；章节书目录项→`(chapterIndex, 0, 0)`；书签/标注项→使用其三元组；**PDF 笔记**→`splitIndex=-1` 时第三参为页，其余按页码跳转；跳转后若目标章与当前章相同则仅滚动。书签点击前对 TXT 缩进书签做位置修正（`A.fixIndentBookmarkPos`，用书签名里 `") "` 之后 8 个字符在原文里就近重新定位，±100~200 字符内）。
- **源码**：`PrefChapters.doNoteClick` 985；`A.fixIndentBookmarkPos` A.java:3350。
- **可行性**：`[浏览器]`。**优先级**：P0

#### TOC-004 脚注/注释弹窗
- **界面文案**：「脚注」(`footnotes`)；设置「在章节里直接显示注解内容」(`show_footnote` / "Show footnotes directly in chapter text")。
- **行为**：点击正文里的注释标记弹出气泡（`PopupNoteLay`：带箭头的浮层，可滚动，左右自动贴边，可选「按钮」如跳转，`showEpub3Footnote` 22841）。三类来源：
  1. **EPUB3 noteref**：链接 `#id` 且章节源码含 `"noteref"` → `Epub.getFootnoteHtml`（Epub.java:1597）在当前章（含后续 split 段）里按 `id="…"` 找 `<aside …>…</aside>`（距 `<aside` <1000 字符），取内容；也可跨文件（`href="file.xhtml#id"` → `getSingleFileText`），去掉首尾包裹 `</div>`，加粗链接文字做标题。
  2. **FB2 note**：`?id` 链接 → `Fb2.getFootNote`（取 notes body）。
  3. **启发式「像脚注的链接」** `isUrlLikeFootnote`（ActivityTxt 9726）：链接文字以数字结尾（如 `[12]`、`注3`），在全文中该标记出现≥2 次（或书已被标记为脚注书 `isFootnoteEpub`，按书名存 prefs），则截取标记后到下一个同前缀标记之间（<1500；脚注书<10000）的 HTML 作为气泡内容。
  - `footnoteOnBottom`(默认 false) 开启时脚注框直接作为 `FootnoteTextView`（顶部 1px 灰线 #88888888）插入段后（EPUB `createBottomText`/FB2 `insertFootnote`/`BaseEBook.createFootnoteBox`，样式取 `.footnote`：0.8em、半透明灰底、点线框、圆角 10px）。
  - **复用**：标注笔记气泡也是同一个 `showEpub3Footnote(note)`（点已有批注的「笔」图标位置 ±26dp 时弹出）。
- **源码**：`ActivityTxt.isEpub3Footnote` 9191、`isUrlLikeFootnote` 9726、`executeUrl` 6147、`showFB2Footnote` 16303；`PopupNoteLay`（components）。
- **Web 建议**：监听 `click` on `a[href^="#"]`/`epub:type="noteref"`；用 Popover API / Floating UI 定位气泡；EPUB3 用 `epub:type=footnote|endnote|rearnote` 目标；无标记的书可实现启发式（数字角标 + 目标块文本长度限制）。支持「点击空白关闭」「气泡里再点链接」。
- **可行性**：`[浏览器]`。**优先级**：P1

#### TOC-005 内部/外部链接与「链接返回」栈
- **行为**：点击链接由 `executeUrl`→`openUrlLink`→`openUrlLinkHandler`（10708，约 2400 行反编译产物）分派：`***` 前缀=直接弹脚注；`?x` = FB2 链接；`@@` 前缀忽略；`#frag`=章内/邻章锚点（`openHtmlFileWithTag`）；相对文件名=按 `usedFiles`/文件名找章；`http(s)`→**确认对话框**（标题 "URL"，正文 URL，按钮「打开」）（`openUrlAsk` 21158）后交给系统浏览器。
  - **链接返回栈** `link_backs`（`LINK_BACK{title, file, chapter, split, position}`）：每次跳转前 `saveLinkBackInfo`（22141）记录当前位置，标题=`"(进度%) 当前行前 15(亚洲)/20 个字符..."`，去重；随后显示悬浮「返回」按钮（`linkBackIv`，`linkBackSetVisible`），**点按=弹出栈顶一条并回到那里**（`doLinkBack`）；**按系统「返回键」**时若栈非空，不直接退出而是弹出历史菜单 `navigateBackLinks`（10411；调用点 ActivityTxt.java:18247）：每项是一条记录标题，末尾分隔线+「退出」(`exit`)，选记录=先把当前位置压栈再回到该处，选「退出」=关闭阅读器。底部进度栏里点「上一章/下一章」按钮同样先压栈并显示进度栏上的「返回」键（`nav_return`），方便撤销误跳。搜索结果跳转前会**清空**栈再压入搜索前的位置（搜索导航面板的 ⮌ 即回到它）。PDF 内链接同样记录（页号，`PDFLayoutView.beforePageJump`）。
- **Web 建议**：封装 `navigate(to)` 统一压栈；返回按钮 + 长按菜单；外链 `rel="noopener noreferrer"` + 自定义确认弹窗；EPUB 内部相对路径经资源解析器映射到章节（foliate `resolveHref`）。
- **可行性**：`[浏览器]`。**优先级**：P0（栈+内链）/ P1（外链确认）

#### TOC-006 图片标签页与图片定位
- **行为**：电子书有图片时目录面板第 3 标签列出 `ebook.getImageFileList()`（缩略图列表）；点击→`showImageLocation`（在各章里搜索该图出现位置并跳转，带进度对话框）；长按→`PicGalleryShow(ebookImage=…)` 打开画廊（见 COMIC-004）。
- **Web 建议**：导入时建立「图片→章节」索引（扫描 `img src`/`image href`）；缩略图网格。
- **可行性**：`[浏览器]`。**优先级**：P2

#### TOC-007 表格缩放与 HTML 查看器
- **行为**：表格不在文本流内渲染，而显示「放大」图标（`isTableZoomIcon`），点击打开 `PrefHtmlViewer`（type 0：用阅读背景/字体色/书内 CSS 包裹的 WebView，可双指缩放）；type 1 用于查看 GIF 动图文件（画廊里 gif 按钮）；type 2 加载 URL。
- **Web 建议**：浏览器原生渲染表格即可；宽表格可加「放大查看」模态。
- **可行性**：`[浏览器]`。**优先级**：P2

#### TOC-008 内嵌音视频
见 FMT-010。**优先级**：P2

### 2.3 文字选择与标注（ANNO-）

#### ANNO-001 长按选词
- **界面文案**：长按动作默认值 `doLongTap=17`（动作表 `R.array.controls` 第 17 项「页面文字摘录」/ "Text Selection"，A.java:10200；可在控制选项里改成其它动作如翻页、自动滚屏）；`longTapInterval`=0.4 s（长按判定，`A.longTapInterval`）。点击区/手势动作也复用同一张动作表（0 向上翻页、1 向下翻页、2 上一文件、3 下一文件、4 搜索、5 书签、6 书籍信息、7 改变配色、8 选项菜单、9 导航菜单、10 字体大小调节、11 显示章节目录、12 前一章节、13 下一章节、14 返回书库、15 无、16 退出、17 页面文字摘录、18 自动滚屏），详见排版/点击区分区文档。
- **行为**：长按（`doLongTimeTapEvent` 4055）依次排除：多点触控、书签角标、图片(长按全屏)、已有标注（点中则进入该标注的编辑态）、链接；然后 `selectText(false)`（15162）：
  1. 命中点→所在行→字符偏移 `lineOffset`；若点在已有高亮内则直接选中整条高亮（`getPreHighlight`）。
  2. **CJK 单字模式**（`oneCharDict`，亚洲语言默认开）：点中「其他字母」类字符（Unicode 类别 `OTHER_LETTER`，含汉字/假名）只选中**该字**；
  3. 否则向左/右扩展到**分隔字符**为止：`A.PUNCTUATIONS = "　/ ,.;?\"':(){}[]!，。；＂”“：？《》（）、！’‘\n\t"` + `oneCharDict` 时的 OTHER_LETTER（`isSplitChar` 9606）；点在标点上先左移到非标点；连字符断词(`textHyphenation`)时越过软断行继续到词尾。
  4. 选区高亮（半透明蓝，`hStart/hEnd`），显示两个**拖动手柄**（`dot1/dot2`，`DotImageView`）与工具条。
  - 手指不抬起继续拖动（>24dp 横向或>16dp 纵向）即「拖选」：`selectText(true)` 从 `first_select_pos` 到当前点，靠近屏幕上/下边缘（1.5 行高）自动滚动一行（`select_move_down` 15270，100ms 节流）。
  - 可选**放大镜**（`showMagnifier`，手机默认 true，平板 false）：长按/拖选时在手指上方绘制局部放大图（`HighlightLay.drawMagnifier`）。
  - 「自动查词」：`openDictDirect`（默认 false）开启时选词完成立即查词（`lookupWordAutomatically`），选词后可点其他区域取消选择。
  - 点击屏幕顶/底/左/右区的动作也可设为 17（「选择文本」）：此时单击即选词（`isSingleTapForTextSelection`）。
- **源码**：`ActivityTxt.doLongTimeTapEvent` 4055、`selectText` 15162、`select_move_down` 15270、`isSplitChar` 9606、`A.PUNCTUATIONS` A.java:280、`HighlightLay`。
- **Web 建议**：PC 端用浏览器原生选择（`selectionchange` + `Range`）；**移动端建议自绘手柄**（原生手柄在 iframe/自定义渲染里不可控），长按用 `pointerdown` 计时器（400 ms）+ `document.caretPositionFromPoint`/`caretRangeFromPoint` 得偏移，向两侧扩展到分隔符（CJK 单字/英文单词用 `Intl.Segmenter` 更准）；放大镜用 `<canvas>` 或 `element.cloneNode` 缩放；拖选靠近边缘自动滚动。
- **可行性**：`[浏览器]`。**优先级**：P0

#### ANNO-002 选择工具条（按钮、顺序、更多菜单）
- **界面文案**（`SelectBar.bText`）：「拷贝」(Copy)、「高亮」(Highlight)、「标注」(Note)、「词典」(Dict.)、「朗读」(Speak)、「分享」(Share)、「搜索」(Search)、「翻译」(Translate)、「维基百科」(Wikipedia)、「网络搜索」(中国大陆显示『网络搜索』，其余 "Google")、「生词本」(History)，外加系统里支持 `PROCESS_TEXT` 的 App 动态条目（如「有道词典 (有道)」）。
- **行为**：工具条 `HighlightBar`：前 **4 个槽位**为主按钮（常驻可见：`hb0–hb3`，**这 4 个位置在设置里强制勾选不可取消**），最右「⋯」(`shareTv`,`hMore`) 弹出余下已勾选项的菜单，末项「设置...」(`dictionary_list[5]` "Customize...") 打开定制对话框。出厂顺序与勾选：拷贝✔、高亮✔、标注✔、词典✔、朗读(仅 Pro ✔)、分享✔、搜索✔、翻译✘、维基✘、网络搜索✘、生词本✘，末尾追加所有「已安装 PROCESS_TEXT 应用」✔。顺序+勾选持久化在 `xml_files_folder/select_bar`（每行 `索引*true|false`，应用条目 `#类名*true`；少于 11 条视为损坏恢复默认）。工具条上方可显示「颜色快速选择模板」(`colorTemplate`，见 ANNO-005)；`hPen`（笔图标，仅 PDF 显示）：PDF 里点击→打开标注工具栏（Pro）；若选区在已有标注上则变为「删除标注」。
  - 长按按钮：长按「高亮」=用上次样式**直接**高亮（`doHighlight(true)`）；长按「词典」=用「长按词典」（`dict_index2`）查词。
  - 各动作：**拷贝**=`copyToClipboard(selectedWord)` 并清除选区；**高亮**=ANNO-005；**标注**=ANNO-007；**词典/翻译/维基/网络搜索/生词本**见 DICT-*；**朗读**=只读选中文本一次（TTS-001）；**分享**=`ACTION_SEND text/plain`，主题「分享页面: 书名」(`share_page`)；**搜索**=把选中文字填入全文搜索并开始（`showPrefSearch(selected)`，SRCH-006）。
- **源码**：`ActivityTxt.doHButtonEvent` 3804、`initHighlightViews` 8674、`showDictMoreMenu` 16254、`hbLongClick` 1618；`SelectBar.getButtons/customizeSelectBar`（components/DragSort/SelectBar.java）。
- **Web 建议**：选区上方/下方浮动工具条（Floating UI 防遮挡）；按钮清单照抄，**「朗读」「分享」**改 Web Speech/Web Share API（不支持则复制）；「更多」用下拉；定制界面=可拖拽排序列表（SortableJS）+ 勾选，前 4 项锁定。服务端保存配置（同步设备）。
- **可行性**：`[浏览器]`。**优先级**：P0（按钮与顺序）/ P1（定制界面）

#### ANNO-003 复制与分享选中文字
- 复制：PDF/DJVU 用 `A.formatPdfCopyText`（A.java:3588，去行末连字符、按句末标点补/去换行）/`formatDjvuCopyText`（去 `- `）；其余取 `selectedText` 并把 U+3000 换成空格后 trim（`getSelectedWord` 19313）。
- 分享：见 ANNO-002。
- **Web 建议**：`navigator.clipboard.writeText`；`navigator.share`。**可行性**：`[浏览器]`。**优先级**：P0

#### ANNO-004 高亮（样式、颜色、模板、选项）
- **界面文案**（`PrefSelectHighlight`，布局 `pdf_highlight.xml`）：标题「高亮」；四个单选样式+各自的颜色块：**高亮**(背景色)、**下划线**(`underline`)、**删除线**(`strikethrough`)、**波浪线**(`squiggly_underline`)；三枚「最近颜色」色块（`highlight_color1/2/3`，点击=把当前样式颜色换成它，并把当前色存入该位）；复选：「使用最后标注类型来高亮文字」(`last_highlight_as_text_selection`→`highlightStyleAsSelec`，false)、「允许长按+拖动操作直接标注文本」(`direct_highlight`→`directHighlight`，false)、「启用放大镜」(`magnifier`→`showMagnifier`)、「在文本选择工具条上方显示颜色快速选择模板」(`show_highlight_template`→`showColorTemplate`，默认 true)、「高亮显示本书所有的“xxx”」(`highlight_all`，只要对话框带着选中文字就出现——从工具条「高亮」进入时总是带着；从标注编辑里改样式时不出现)。按钮「确定」/「取消」（若是改已有标注则「取消」变「删除」）。
- **行为**：
  - 点击工具条「高亮」(`doHighlight(false)` 3896)：若有选区且**无**已有标注→弹 `PrefSelectHighlight`；确定后按所选样式创建。**长按「高亮」**或 `directHighlight`/颜色模板点击→`doHighlight2(…)` 直接创建（样式=`A.highlightMode`，颜色=该样式颜色）。
  - 样式 `highlightMode`：0 高亮、1 下划线、2 删除线、3 波浪线（默认 0）；颜色**每种样式各一个全局色**：`highlight_color`(#7700AAFF 半透明蓝)、`underline_color`(#FF555555)、`strikethrough_color`(#FF555555)、`squiggly_color`(#FF00FF00)；改色时若样式=高亮且 `highlightStyleAsSelec` 则同步全局色。「最近颜色/预设」`highlight_color1..5` = `#FF99AA77`、`#FFFF9200`、`#FFCC99C0`、`#88888888`、`#7700AAFF`。
  - 选区跨「单个标注」存一条记录：`(chapter, splitIndex, position)`=起点，`highlightLength`=显示长度，`original`=选中原文，`highlightColor`=颜色，三布尔表示样式（`underline`、`strikethrough`、`squiggly` 存于 `bak` 字段 "1"/"0"），无布尔为 0 即背景高亮。
  - **颜色模板** `ColorTemplate`（工具条上方，**两行×5 列**，按点击 y 坐标分上/下行，`getClicked()`=列号 0–4）：
    - **上行**=样式行：列 0–3 依次为 高亮 / 下划线 / 删除线 / 波浪线，点击=把 `A.highlightMode` 设为该列并**立即用该样式及其当前颜色**创建高亮；列 4 是提示图标，点击只弹 Toast「提示: 长按颜色块可更换预置颜色值」(`show_highlight_template_tip`)。
    - **下行**=预设色行：5 个预设色 `highlight_color1..5`，点击=**用当前样式(`highlightMode`)+该颜色**创建高亮。
    - **长按**任一块用 `ColorDialog` 改色：上行改对应样式的全局色（高亮/下划线/删除线/波浪线），下行改对应预设色槽。
    - PDF（非重排、非 DJVU）走 `pdfDoHighlight2(color)`，已选中某个 PDF 标注时上行点击无效。（`ActivityTxt.colorTemplicateClick` 2816、`initColorTemplateEvents` 19598、`ColorTemplate`）
  - **「高亮本书所有同词」**：勾选后把 `原文→"样式|颜色"` 存到 prefs `<文件路径hash>_highlight`（`A.highlightAllItems/Properties`，`updateHighlightAllItem`），渲染时全书匹配该词的位置都套用样式；取消勾选或删除该标注时移除（`A.deleteHighlightAllItem`）。
- **源码**：`PrefSelectHighlight`(358 行)；`ActivityTxt.doHighlight` 3896/`doHighlight2` 3935；`A.addNote` A.java:1870；`ColorTemplate`；`A.loadHighlightAllItems` 9120。
- **设置项**：`highlightMode`(0)、`highlight_color`、`highlight_color1..5`、`underline_color`、`strikethrough_color`、`squiggly_color`、`highlightStyleAsSelec`(false)、`directHighlight`(false)、`showMagnifier`、`showColorTemplate`(true)。
- **Web 建议**：渲染用 **CSS Custom Highlight API**（`CSS.highlights.set('hl-1', new Highlight(...ranges))` + `::highlight(hl-1){background-color}` 与 `text-decoration: underline|line-through|underline wavy`），不支持的浏览器退回 foliate-js `Overlayer`（SVG：highlight/underline/strikethrough/squiggly 恰好对应四种样式）或 `<mark>` 包裹；颜色选择器用 `<input type=color>` + alpha 滑块（Moon+ 颜色带 alpha）。
- **可行性**：`[浏览器]`。**优先级**：P0（高亮+颜色+样式）/ P1（模板、同词全书高亮）

#### ANNO-005 点击已有标注：改样式/色、删除、编辑
- **行为**：点击（或长按）已标注文字：`isNoteHighlightClick`（9473）→`A.getPreHighlight`(A.java:5986)：以 `(chapter, split)` 过滤，位置落在 `[lastPosition, lastPosition+highlightLength]` 内即命中；命中后**恢复选区+手柄**（工具条变为：「高亮」可改样式/颜色，笔图标变「删除」）；若该标注带笔记文字，则点击其起点标记 ±26dp 弹出笔记气泡（`showEpub3Footnote(note)`）。修改样式/色时先删除旧行再插入新行（`A.updateNote`：`removeNote`+`insertNote`，唯一键 = 文件+章+split+起点位置）。删除：`removeCurrentNote`（删除 DB、内存列表、「同词全高亮」项，刷新页面）。
- **源码**：`A.getPreHighlight`、`A.updateNote` A.java:10618、`ActivityTxt.removeCurrentNote` 14769。
- **Web 建议**：同一位置唯一键（`bookId+anchor.start`）；点击高亮显示迷你工具条（改色/笔记/删除/复制）。
- **可行性**：`[浏览器]`。**优先级**：P0

#### ANNO-006 标注/笔记（文字批注）
- **界面文案**：「标注」(`annotation` / "Note")，对话框 `PrefEditNote`（全屏宽 96%，输入框字号 ≥16sp 平板 18sp 且不小于阅读字号），按钮「保存」(`save_page`)、「取消」(新建) 或「删除」(编辑已有)、「颜色」(`colorB`，编辑已有时才可见，打开 `PrefSelectHighlight` 改样式)。
- **行为**：选区→点「标注」：无已有标注→新建 `NoteInfo`（同 ANNO-004 记录结构，`note` 为用户文字，样式取当前 `highlightMode`/默认高亮）→保存后加入 `highlights` 与 `notes`；已有标注→编辑文字；**空文字保存**=等同取消（PDF 路径）。保存后 400 ms 重建翻页缓存。批注位置在文中显示小「笔」标记，点击弹气泡（TOC-004）。批注在目录面板「标注」筛选里显示（`A.getNotes()`=`note` 非空的高亮）。
- **源码**：`ActivityTxt.do_add_note` 18297、`do_edit_note` 18676、`PrefEditNote`。
- **Web 建议**：右侧栏/底部抽屉编辑器；支持 Markdown 纯文本；Esc/外点击的保存策略：未改动=取消，改动=保存（原版 `dismiss` 时若文字变了自动保存）。
- **可行性**：`[浏览器]`。**优先级**：P0

#### ANNO-007 书签
- **界面文案**：「书签」(`bookmark`)、「增加新书签」(`add_new_bookmark`)、对话框标题「添加书签」(`add_bookmark`)，复选「不再询问」(`do_not_ask_again` → `bookmarkManually=false`)、颜色复选+颜色块、设置「在创建书签前输入书签名」(`bookmark_manually`)。
- **行为**：
  - 创建（`ActivityTxt.createBookmark` 17951）：若**当前位置已有书签则切换为删除**（同 `position`；非 PDF 还需同 `chapter/split`）；否则默认名=`"(<进度%>) <当前页首起 60(中文)/100 个字符>..."`（PDF=`"(页/总页) <页文本前缀>..."`；`generateBookmarkName` 19020，换行→空格，U+3000→空格，在 100 字符处按最后空格截断避免半词）；`bookmarkManually`(默认 true) 时先弹命名对话框。
  - 入口：①**页面右上角 40dp×40dp 的「书签角标」区域**——点击=切换书签（`clickForBookmark` 2805：`x > 宽-40dp` 且 `y < bookmarkYoff+40dp`），创建后立即 `showBookmarkIcon=false`；已有书签的页面该角标常显（可视书签，见下）；无书签时的占位角标只在 `showBookmarkIcon` 为真且选择手柄(`dot1`)可见时才绘制（`ContentLay.drawBookmarks`，含义存疑）；②工具栏「书签」按钮（动作「书签」=`do_bookmark`→打开目录面板的书签页），**长按**该按钮弹菜单「已保存的书签 / 增加新书签」（`doBookmarkLongTap` 3579）；③书签面板的「增加新书签」按钮（长按=不弹命名直接加）。
  - **可视书签**：已保存书签在页面右侧边缘绘制小旗子（颜色=书签色；`contentLay.visualBookmarks`，`drawY2` 记录位置），点击弹菜单「编辑 / 删除」（`isVisualBoomarkClick` 9869）。
  - 颜色：`bookmark_color`(默认红 #FFFF0000)，`bookmarkNoColor`(默认 **true**=无色，`getBookmarkColor` 返回 0)。
  - 存储：与标注**同表**（`notes`），`bookmark` 非空即书签行，书签颜色存在 `highlightLength` 列（`BookDb.bookmarkToNote` 233）。
- **源码**：`ActivityTxt.createBookmark/createBookmark2/clickForBookmark/doBookmarkLongTap`；`PrefEditBookmark`；`A.Bookmark` A.java:877；`A.getBookmarkColor` 4229。
- **设置项**：`bookmarkManually`(true)、`bookmarkNoColor`(true)、`bookmark_color`(红)、`showBookmarkIcon`(true)、`bookmarkSortByDate`(false)。
- **Web 建议**：右上角角标点击切换；书签名自动生成算法照抄；位置=章节+章内偏移+文本引用；可有颜色标签（5–6 种）。
- **可行性**：`[浏览器]`。**优先级**：P0

#### ANNO-008 书签/标注列表（目录面板第二标签）
- **界面文案**：顶部条：搜索(`searchB`)、书签筛选(`bookmarkLay`)、标注筛选(`noteLay`)、高亮筛选(`highlightLay`)、颜色筛选(`colorTv`，列出本书已用颜色 `#color#<int>`)、导出(`exportLay`)、选项(`bookmarkOption`)；底部「增加新书签」；空状态「尚无书签…」(`no_bookmark_tip`)。选项对话框（标题「书签」）：「在创建书签前输入书签名」、「按时间排序」(`sort_by_time`)、「分享内容里包含章节信息」(`share_with_chapter`)、「自动分享新的高亮和标注到Readwise」(`share_to_readwise`)。
- **行为**：筛选 `annotFilter`：0=全部（书签+标注+高亮）、1=仅书签、2=仅标注（有笔记文字）、3=仅高亮（**无**笔记文字的高亮，笔记不重复出现）；再叠加颜色筛选与关键字（不区分大小写，匹配书签名或 `笔记+原文`，匹配片段**加粗**）。排序：默认按位置（PDF：页→页内序；其他：章→split→偏移；`A.sortNotes` A.java:10420），开「按时间排序」按时间倒序；「倒序」按钮反转。
  - 列表项（`annotation_item`，平板双列）：左图标（书签=书签形状带书签色 / 标注=笔 / 高亮=荧光笔），正文：书签=名称；标注/高亮=`"序号. 原文"`（背景/下划线等样式用对应色绘出，原文被改成单行），标注文字另起一行；右下时间 `日期 时间`；右侧「⋮」菜单。
  - **「⋮」菜单**：标注：分享 / 分享 → Readwise / 编辑 / 删除 / 全部删除（注：数组 `catalog_popup_menu`=打开|编辑|删除，`one_file_bookmark`=打开|删除|全部删除）；高亮：分享 / 分享→Readwise / 删除 / 全部删除；书签：编辑 / 删除 / 全部删除。「编辑」书签=`PrefEditBookmark`（改名与色），编辑标注=文字对话框。「全部删除」弹确认，删除**当前筛选结果**中的所有项；若最后一条也没了，清理同名缓存笔记（`BookDb.deleteOtherSameFilenameCacheNotes`）。
  - **多选**：长按条目进入多选（点击切换勾选；右上出现「删除」按钮，`deleteB`）；导出时若有勾选则仅导出勾选项。
  - 点击条目→跳转（TOC-003）。
- **源码**：`PrefChapters.refreshBookmarkList` 1942、`AnnotsAdapter` 146、`onClick` 1757、`sortAnnotsByPos` 1640；`A.sortBookmarks/sortNotes`。
- **Web 建议**：侧栏标签页 + 工具条筛选 chips；多选用 checkbox 模式；搜索高亮用 `<mark>`。
- **可行性**：`[浏览器]`。**优先级**：P0

#### ANNO-009 位置模型与持久化
见第 4.4 节：表 `notes`（SQLite `mrbooks.db` v7）每行 `(book, filename, lowerFilename, lastChapter, lastSplitIndex, lastPosition, highlightLength, highlightColor, time, bookmark, note, original, underline, strikethrough, bak)`，**唯一键 = (lowerFilename, lastChapter, lastSplitIndex, lastPosition)**（同位置只存一条，`removeNote/removeBookmark` 按此键删）。
- **Web 建议**：见 4.4「Web 侧数据模型」；服务端存标注（用户账号），带 `updatedAt` 与 `deleted` 墓碑用于多端合并。
- **可行性**：`[浏览器]`（本地）+`[服务端]`（同步存储）。**优先级**：P0

#### ANNO-010 导出/分享/导入（文本、封面图、.mrexpt）
- **界面文案**：导出按钮弹窗标题「分享」(`share`)，四项：「分享高亮与备注 (TXT)」、「分享高亮与备注 (封面)」(`book_cover`)、「导出到文件」、「从文件导入」（`notes_import_export`）。
- **行为**：
  1. **TXT 分享**（`createShareContent` 915）：头 `<b>书名 - 作者</b> (高亮: N; 标注: M)` + `───────────────`；每条 `"\n\n▪ 原文"`，有笔记则 `" (笔记文字)"`；开启「分享内容里包含章节信息」时先按位置排序并在章变化处插入 `◆ 章节名`，条目缩进为 `"  ▪ "`；只含**勾选/当前筛选后的标注类**（不含书签）。>80,000 字符时改为「复制到剪贴板 / 保存到 txt」（`shareContent` 1355）。
  2. **封面分享**：同上文本 + 书籍缩略图作为 `EXTRA_STREAM`。
  3. **导出 .mrexpt**（默认 `<share_export_path>/<书名>.mrexpt`，可改路径）：格式见 4.4.3；若是 PDF，导出的是 `#A*#` 串（见 PDF-010）。
  4. **导入 .mrexpt**：默认路径=书同目录 `<书名>.mrexpt`，无则 `share_export_path`；按**文件大小差 ≤100000 字节**判定是否同一本书（否则「导入失败: 不是同一个文件」`import_not_same_file`）；按 (章,split,位置) 对比，已存在且内容不同→覆盖，`*DELETED*` 墓碑→删除，新增→插入（插入前 `confirmNoteNotExistAgain`）；返回 1/2 成功，-1 失败，-2 不是同一文件。
- **源码**：`PrefChapters.doShare` 999、`createShareContent` 915、`shareContent` 1355；`BookDb.exportNotesToText` 654、`importNotesFromText` 1349、`deletedNotesToText` 574。
- **Web 建议**：导出 Markdown（按章节分组）、JSON、`.mrexpt`（P2，导入时用原文引用重定位而非偏移）；分享用 `navigator.share({text})`；复制到剪贴板；封面分享可用 canvas 合成图。
- **可行性**：`[浏览器]`。**优先级**：TXT/Markdown 导出 P1；.mrexpt 导入导出 P2

#### ANNO-011 Readwise 同步
- **行为**：设置 `readWiseToken`(+`readWiseUrl` 默认 `https://readwise.io/api/v2/highlights/`)；开启 `syncReadWise` 后每次 `A.addNote(note,true)` 且 `original` 非空时 POST `{"highlights":[{"title","text","author","note"(可选),"chapter"(可选)}]}`，Header `Authorization: Token <token>`；也可在列表「⋮」里「分享 → Readwise」手动上传单条。
- **源码**：`components/Readwise.java`、`A.addNote` 1884。
- **Web 建议**：由**服务端**代发（避免暴露 token 与 CORS）；前端只保存开关。
- **可行性**：`[服务端]`：`POST /api/integrations/readwise/highlights`。**优先级**：P2

#### ANNO-012 选中文字的其他动作（分享/搜索/网络搜索）
见 ANNO-002。「网络搜索」优先 `ACTION_WEB_SEARCH` Intent，失败则打开 `https://www.baidu.com/s?wd=%s&ie=utf-8`（中国大陆 UI）或 `https://www.google.com/search?q=%s`。**优先级**：P1

#### ANNO-013 PDF/DJVU/CBZ 下的选择与标注
见 PDF-004/PDF-005/COMIC-003：CBZ **不支持**选择/标注（`doHighlight2` 直接 return）；DJVU 仅支持文本高亮（`djvuDoHighlight2`，存 DB，不写文件）；PDF 写回文件。**优先级**：随 PDF

### 2.4 搜索（SRCH-）

#### SRCH-001 全文搜索（对话框）
- **界面文案**：标题「搜索」(`search`)；输入框（`ClearableEditText`，回车=搜索）；按钮：搜索、历史（「历史记录」`history`）、选项；结果页标题「搜索结果: N」(`book_found`)，结果超 5000 显示「> 5000」；提示「(提示: 全文搜索支持正则表达式)」(`search_hint`)。选项（`search_options`）：「区分大小写」(`search_case_sensitive`)、「单词模式」(`search_whole_word`)、「只搜索已读的(向后搜索)」(`search_backward`)、「只搜索未读的(向前搜索)」(`search_forward`)。
- **行为**：点击搜索后禁用输入框，进度条转圈（点转圈=取消）；**后台线程逐块/逐章搜索，结果边出边显示**；超过 `MAX_RESULTS=5000` 停止。关键词**直接当 Java 正则**编译：`(?i)` 前缀(不区分大小写时) + `\b`(单词模式) + 用户输入 + `\b`；正则语法错误会抛异常（线程内 catch，无提示——存疑）。向后/向前搜索以当前位置为界（TXT 用全局偏移，章节书用 `(chapter,split,position)`，PDF 用当前页）。
  - **搜索文本**=经**简繁转换后**的文本（`A.chineseJianFanConvert(text)`），所以简体关键词能搜到被转换为繁体显示的内容。
  - TXT：对每个原文块先 `matcher.find()` 预判，再在 `getTxts2(i)`（显示文本）上全量匹配；`start/end` 为全书显示偏移；章节书按章 `A.adjustChapterHtml` 拆 split，对 `MyHtml.fromHtml(...).toString()`（纯文本）匹配；HTML 单文件按 split；PDF 对每页文本（重排模式用重排文本）匹配，`chapter`=页号。
  - **结果摘要**：命中前后各取 `pl` 字符（`pl`：亚洲语言手机 30、亚洲语言平板 60、非亚洲语言手机 60、非亚洲语言平板 100；PrefSearch 构造器），命中词加粗红色（中文 UI `<b><font color=#FF0000>`，其他 `<b>`），再用 `getSentence` 向前/向后收缩到最近标点（不足则 15 字符），去除换行制表符，两端加 `...`，末尾追加蓝色进度 `(xx.x%)`（PDF 为 `[页/总页]`）。
  - `SearchResult{chapter, splitIndex, position(=start>80?start-80:start), start, end, html}`。
- **源码**：`PrefSearch`(666 行)：`startSearch` 约 300–440、`getResultFromHtml` 约 160–300、`getSentence`/`firstPunc`/`lastPunc`；`A.searchBackwardOnly/ForwardOnly/CaseSensitive/WholeWord`。
- **设置项**：`searchCaseSensitive`(false)、`searchWholeWord`(false)、`searchBackwardOnly`(false)、`searchForwardOnly`(false)、`lastSearchKey`（记忆上次关键词）。
- **Web 建议**：Worker 里搜索；用 `RegExp`（`new RegExp(escape?key:key, flags)` 默认**按正则**，提供「按字面」切换更安全）；`\b` 对 CJK 无意义（原版同），整词可改用 `Intl.Segmenter`；摘要算法照抄；结果虚拟列表；PDF 用 pdf.js `getTextContent` 逐页缓存文本。foliate-js 有 `search.js`（章节内逐段搜索、返回 CFI 与摘要）。
- **可行性**：`[浏览器]`。**优先级**：P0

#### SRCH-002 结果跳转、高亮与搜索导航面板
- **界面文案/行为**：点击结果→关闭对话框并跳转（`doPrefSearchResult` 4515）：先清空并压入「链接返回」栈（可回到搜索前位置）；TXT：重载书并把 `hStart/hEnd` 设为命中范围（转为显示偏移 `getTxtDisplayPos`）；章节书：同章只滚动（目标行不在当前屏时 `txtScrollNoDelay`），异章重载并 `locate_to_search_result`；PDF：翻页后用「强制选区」或重排文本高亮；`A.lastPosition` 设为 `start` 前 1/4 屏文本长度处（保证命中不贴屏顶）。**结果数>1** 时弹出「搜索导航面板」(`search_panel`)：按钮「列表」(回结果列表)、「上一个」「下一个」、「关闭」、「返回」(nav_return)、计数「i/N」；全文关键词用 `forceHighlightKey` 高亮（TXT 所有出现处，不只当前）；关闭面板清除高亮。
- **源码**：`ActivityTxt.doPrefSearchResult` 4515、`showSearchPanel` 23690、`hideSearchPanel` 8115、`getSearchResultLocation` 19303；`MRTextView.forceHighlightKey`。
- **Web 建议**：页面底部/顶部浮动条；全文高亮用 CSS Custom Highlight API（`::highlight(search-all)`）+ 当前项强调；Enter/Shift+Enter 下一个/上一个。
- **可行性**：`[浏览器]`。**优先级**：P0

#### SRCH-003 搜索历史
- 历史按钮列出 SharedPreferences `SEARCH_HISTORY_FILE` 的所有关键词（`saveLastSearchKey` 保存 key），点击填入并重搜；对话框按钮「清除历史」(`clear_dict_history` 复用)。书签页搜索框同时使用 `lastSearchKey`。
- **可行性**：`[浏览器]`。**优先级**：P1

#### SRCH-004 书签/标注内搜索
见 ANNO-008 筛选，关键字不区分大小写。**优先级**：P1

#### SRCH-005 选中文字搜索
工具条「搜索」(`index 6`)=打开搜索对话框并立即用选中文本搜索（`senderSearchKey`）。**优先级**：P1

### 2.5 朗读 TTS（TTS-）

#### TTS-001 启动、入口与选项对话框
- **界面文案**：「朗读」按钮；对话框标题「TTS朗读设置」(`tts_options`)，内容：「选择内容划分方式」下拉（`tts_divides`：逗号(,)|句号(.)|整段|整页）+ 设置图标（打开系统 TTS 设置）；「自动停止朗读设置:」+勾选+分钟数（`tts_stop_time1/2`）；「不再询问」(`do_not_ask_again`)；按钮「开始朗读」(`start_speak_button`)。
- **行为**：
  - **Pro 专属**（`A.isPro()`，`do_speak` 5879）；Web 版建议不设限。
  - 入口：选择工具条「朗读」、工具栏朗读按钮（`doSpeak`）、手势/点击区动作、耳机媒体键。`A.askForTts`(默认 true)控制是否先弹选项对话框（首次使用强制弹且引导去系统 TTS 设置 `T.openTtsOptions`）；有选区时**跳过对话框并只朗读选中文本一次**（`onInit` 里 `tts.speak(selected,0)`，PDF 同）。
  - **朗读按钮长按菜单**（`doSpeakLongTap` 4866）：「开始朗读」(不自动停止)、「开始朗读 (N 分钟)」(带定时停止)、「朗读剪贴板文本」(`speak_text_in_clipboard`，一次性读完)。
  - 初始化失败提示「加载TTS引擎失败， 请检查是否已正确安装TTS」(`tts_init_failed`)；**不设置语言**（交给系统 TTS 引擎默认语言）。
  - 朗读期间：保持屏幕常亮(`setKeepScreenOn(true)`)、显示朗读状态图标、自动显示 TTS 面板；翻页手势/点击区动作被「TTS 控制」接管（`isSpeaking`）。
- **源码**：`ActivityTxt.do_speak` 5879、`initTTS` 8757、`onInitTTS` 1499、`doSpeakLongTap` 4866、`kill_tts` 9963、`stop_speak` 24015。
- **设置项**：`askForTts`(true)、`firstTimeUseTts`、`tts_stop_enable`(false)、`tts_stop_time`(10 分钟)、`tts_divide`(1)。
- **Web 建议**：`speechSynthesis`（`SpeechSynthesisUtterance`）；先 `getVoices()`（异步 `voiceschanged`）按书籍语言(`<dc:language>`/CJK 占比)选默认 voice，并提供「声音」下拉；入口按钮+快捷键 Space/`T`。
- **可行性**：`[浏览器]`（见 TTS-010 对后台的限制）。**优先级**：P0

#### TTS-002 内容划分（分句）
- **行为**：`tts_divide`：0=逗号级、1=句号级（默认）、2=整段、3=整页。`A.getTtsLines(text, isPdf, speakInBackground, offset)`（A.java:6498）：
  - 先截掉章末提示文本之后的内容，并把 `Mr.`/`Mrs.`/`Dr.` 暂时替换为占位符避免被当句号；
  - 按正则切（逗号级：`\(|\)|：|:|,|;|!|\. |\?|，|。|；|？|！|\t|\n|\r`；句号级：`;|!|\. |\?|。|；|？|！|\t|\n|\r`；整段：`\n|\r`；整页：不切），切出的每一段是 `TtsLine{s(要读的文本), start, end(原文范围)}`，`start/end` 用于高亮；段首/尾会修剪空白/引号/括号（前缀集 `　 ,.;?:!，。；：？、！\t\n\r…`，后缀集 `　 ”\t\n\r` 等），末尾紧跟的 `,.;，。；?？!！` 会计入 `end`。
  - **后台连续朗读（章节书）**时强制 `tts_divide=1`（`z2`）。
  - 单条超过 4000 字符截到 3950（引擎上限）。
  - `isAvialable()`：`end>start` 且（`len>1` 或（`len==1` 且不是 U+FFFC 图片占位且不是标点））才入队。
- **Web 建议**：同样的正则；`Intl.Segmenter('zh', {granularity:'sentence'})` 可作为更好的备选；每句一个 `SpeechSynthesisUtterance`（规避 Chrome 桌面 ~15 s 截断 bug），一次性 `speak()` 全部入队（原版也是循环 `tts.speak(line, QUEUE_ADD)`）。
- **可行性**：`[浏览器]`。**优先级**：P0

#### TTS-003 当前句高亮、自动滚动与连续朗读
- **行为**：每句结束的回调 `onUtteranceCompleted(id)`→`doOnUtteranceComplted`（4394）：`tts_utteranceId=id`；若还有下一句→`highlightText(lastStartOfSpeakText+line.start, +line.end)` 高亮**下一句**；已到本页最后一句→**翻页**（`speakNextPage`：非 PDF 调 `do_page_down` 并重新 `getSpeakText` 取下一屏文本；章节书后台模式用 `pageDownToNextChapter` 换章）；到达书末→`stop_speak`。取屏文本 `getSpeakText`（7352）：从当前屏首行到末行，**末尾回退到最近的 `SPEAK_PUNCT1` 标点处**（至少 15 字符），上屏残留(`lastEndOfSpeakText`)的半句并入下一屏（避免在句子中间断开）；章节书则整章一次取（`speak_in_background=true`，预载下一章）。后台时每句仍高亮并按需「确认高亮在屏内」（`confirmSpeakHighlightInScreen` 2845），App 退到后台时把进度写入 `POSITION_FILE`。
  - 第一句高亮在 `setSpeakQueue` 中立即设置（`tts_divide != 3`）；整页模式不高亮单句。
- **设置项**：见 TTS-002。
- **源码**：`ActivityTxt.getSpeakText` 7352、`setSpeakQueue` 15802、`doSpeakHandlerEvent` 4803（消息 0=下一页、1=上一页、2=检查翻页、3=停止、5=下一句、6=下一章、31=更新倒计时）。
- **Web 建议**：事件 `utterance.onend` 驱动下一句；高亮用 CSS Custom Highlight API；翻页/换章在最后一句 `onend` 后触发；`boundary` 事件仅作词级细化（部分浏览器无）。
- **可行性**：`[浏览器]`。**优先级**：P0

#### TTS-004 TTS 面板与控制
- **界面文案**：面板（`tts_panel`）：「音量:」「音调(Tone):」「语速:」三个滑块，「重置:」(`reset`) 文字按钮（仅当速度或音调≠10 时可见），倒计时文字（定时停止剩余时间），按钮行：上一页(`tts_page_up`)、上一句(`tts_prior`)、播放/暂停(`tts_play`)、下一句(`tts_next`)、下一页(`tts_page_down`)、停止(`tts_stop`「停止朗读」)、系统 TTS 设置(`tts_options`)、更多(`tts_more_options`)。
- **行为**：
  - 上/下页：`tts_stopped=true; tts.stop(); lastEndOfSpeakText=-1; speakPriorPage/NextPage`；
  - 上一句：`tts_utteranceId>-1`→回退一句并重新排队（`force_utteranceId`），否则回上一页并从**最后一句**开始(`tts_from_last_line`)；
  - 下一句：若不是最后一句则前进一句并排队，否则翻到下一页；
  - 播放/暂停：`pauseTTS`/`restore_speak`（暂停=停止引擎并记录句号，继续=从当前句重排队）；图标在 `tts_play`/`tts_pause` 间切换；
  - 速度/音调：拖动时 Toast 显示数值，**松手后**写入设置并 `restore_speak` 立即生效；音量滑块直接设置**系统媒体音量**（0–15）。
  - 面板可见保持：任何操作调用 `keepTtsPanelVisible`；`tts_reset` 恢复速度/音调为 10。
- **源码**：`initTtsPanel` 8811、`do_tts_buttons` 18866、`tts_speed_setProgress` 17366、`get_tts_speed_progress` 19388。
- **Web 建议**：底部浮层；暂停用 `speechSynthesis.pause()/resume()`（**Android Chrome 的 pause 不可靠**，建议「取消并记录句号，继续时重排队」，与原版一致）；音量用 `utterance.volume`（0–1）。
- **可行性**：`[浏览器]`。**优先级**：P0

#### TTS-005 语速、音调、音量映射
- **行为**：存储 `tts_speed`（默认 10，实际速度=值/10 → `setSpeechRate`）、`tts_pitch`（默认 10 → `setPitch`）。滑块：速度 `max=40`：进度≤30 时值=进度（0.1×–3.0×，进度 0 视为 1），进度>30 时值=`30+(进度-30)*2`（最高 5.0×）；音调 `max=20`（0.1–2.0，进度≤0 视为 1）；音量 `max=系统媒体最大音量(通常 15)`。
- **Web 建议**：`utterance.rate`（范围 0.1–10，多数引擎 0.5–2 有效）、`utterance.pitch`（0–2）；滑块设计同上（1×=10）。
- **可行性**：`[浏览器]`。**优先级**：P0

#### TTS-006 定时停止
- **行为**：`tts_stop_enable`（默认 false）+`tts_stop_time`（分钟，默认 10）；开始朗读后 `setStopTtsHandler`（15913）发延时消息 3（停止）与 31（每秒更新倒计时）；倒计时在面板上显示：>10 s 显示格式化剩余时间（小字，`T.formatInterval`），≤10 s 变大号红色数字；到点 `stop_speak`。**点击面板上的倒计时文字**（`ttsStopTv`）弹菜单「重置 / 取消」，「重置」再弹输入框（标题「停止朗读(分钟)」）修改 `tts_stop_time` 并重新计时。长按朗读按钮「开始朗读 (N 分钟)」可一次性启用（`force_tts_stop`），「开始朗读」则忽略设置（`force_tts_not_stop`）。
- **Web 建议**：`setTimeout` + 剩余时间显示；到点停止并淡出。
- **可行性**：`[浏览器]`。**优先级**：P1

#### TTS-007 句间间隔
- `tts_interval_enable`(false) + `tts_interval_time`(默认 500 ms，界面单位文案「秒/millisecond」不一致，实际为毫秒)：每句 `speak` 后追加 `tts.playSilence(ms, QUEUE_ADD)`。设置位置：TTS 更多选项（`tts_sentence_interval` "朗读间隔:"）。
- **Web 建议**：在 `onend` 后 `setTimeout(ms)` 再读下一句。**可行性**：`[浏览器]`。**优先级**：P1

#### TTS-008 朗读字符过滤（替换表）
- **界面文案**：「朗读字符过滤」(`tts_filter` / "TTS Chars Filters")；复选「用正则表达式」(`tts_regular`)。
- **行为**：`A.ttsFilters`（`Filter_Item{original, replaceWith}`），文件 `xml_files_folder/tts_filter`，每行 `原文#->#替换`；**默认**4 条：`—`→空格、`-`→空格、` '`→空格、`' `→空格。每个句子在入队前依次替换（`TtsLine` 构造器，A.java:1055–1100；正则开关时用 `replaceAll`，异常忽略）；另硬编码：「」→`"`，`’ `/` ’`/`‘`→空格，换行(含两侧空格)→空格，去首尾引号/括号/空格；跳过包含章末提示文本或水平线占位的行。
- **Web 建议**：设置里的规则表（原文/替换/是否正则，可导入导出，按书覆盖）；读之前对每句顺序 `replace`。
- **可行性**：`[浏览器]`。**优先级**：P1

#### TTS-009 跳过规则汇总
- 无法发音的行（单字符且为标点或 U+FFFC 图片占位）被丢弃；章末提示文字及其后内容被截断；水平线 `MyHtml.HR_TAG` 行为空串；`Mr./Mrs./Dr.` 不当断句点；日文 Ruby 用读音替换汉字（见 TTS-012）；PDF 里换行规整（`formatPdfTtsText`，行末连字符合并，`☀`/`✔` 作为段落占位符）；整页模式不切句。
- **可行性**：`[浏览器]`。**优先级**：P1

#### TTS-010 后台播放、音频焦点、耳机键、媒体会话
- **界面文案**：「停止使用AudioFocus与其它语音应用进行交互(允许TTS一直在后台运行)」(`disable_audio_focus`)；提示「如果需要阅读器在息屏后继续朗读, 请在系统电池优化里, 把阅读器和TTS引擎一起加入到白名单中」(`battery_optmization_tip`，点击申请忽略电池优化)；「耳机按键」(`headset_key`)。
- **行为**：`registerAudioFocus`（14611）：请求 `AUDIOFOCUS_GAIN`（流=音乐）；失焦(-2 暂时/-1 永久)且正在读→自动暂停并记 `audio_pause_from_listener`，得焦且是因它暂停的→自动继续；`disableAudioFocus`(false)开启则完全不申请/不响应。`MediaSession("MR2")`+`OpenFile_Receiver.handleMediaIntent` 把耳机/蓝牙媒体键（播放暂停/下一首/上一首/耳机钩）路由到 `A.doHeadsetKey/doMediaPlayPause/doMediaPlayNext/doMediaPlayPrevious`（可配置动作；`headsetForSpeaking`/`headsetPauseForSpeaking`：动作值 19(朗读)，或动作值 15(无)且本次已朗读过，则按 TTS 控制处理——暂停/继续、下一句/上一句，ActivityTxt.java:8056/8064），拔耳机（`HEADSET_PLUG`）事件也上报给阅读器；后台时（`isPaused`）仍继续朗读、进度写入 prefs，章节书用 `speak_in_background` 模式（整章取文本、自动换章）。
- **Web 建议**：
  - **前台**用 `speechSynthesis` 即可；**后台/锁屏**：浏览器在标签页被隐藏/锁屏时常暂停或杀掉 `speechSynthesis`（iOS Safari 基本不支持），**无法保证后台连续朗读**。
  - 若要做到「锁屏继续读」：**服务端合成音频**（Edge TTS / Azure / Piper / 系统 `espeak-ng`）按句或按段返回 `audio/mpeg`，前端用 `<audio>` 队列播放 + **Media Session API**（`navigator.mediaSession.setActionHandler('previoustrack'|'nexttrack'|'play'|'pause')`、`metadata`）接管锁屏/耳机键；并配合 Wake Lock API 防休眠。
- **可行性**：前台 `[浏览器]`；后台 `[服务端]`：`POST /api/tts/synthesize {text, voice, rate, pitch, lang}` → 音频流（可带词边界时间戳 JSON）；`GET /api/tts/voices`。**优先级**：P1（前台 P0）

#### TTS-011 PDF 朗读与连续翻页
- PDF（非重排）按页取文本：`pdfGetTtsLines`（13614）→`A.getTtsLines(..., isPdf=true)`，当前句用「强制选区」高亮（`pdfSetForceSel`），页读完自动翻页（`speakPdfText(true)` 16927，内部 `pdf.PDFGotoPage`）；重排模式与文本书相同。选中文字时只读选区。
- **可行性**：`[浏览器]`（pdf.js 文本层取句 + 高亮层）。**优先级**：P1

#### TTS-012 日文 Ruby 朗读
TTS 前把带 Ruby 的汉字替换为读音（`TtsLine` 构造器遍历 `MyHtml.Ruby` span，`str.replace(ruby.original, ruby.rt)`），并去掉日文文本中的多余空白（仅当相邻字符都不是分隔符才保留一个空格）。**优先级**：P2

#### TTS-013 朗读统计
后台朗读时按句累计「已读字数」（`addStatisticsWords`），计入阅读统计（统计页属书架与同步分区文档）。**优先级**：P2

#### TTS-014 语音引擎与声音选择
- 原版**不提供应用内选声音**，完全依赖系统 TTS 设置（`T.openTtsOptions` 跳转 `com.android.settings.TTS_SETTINGS`）。Web 需补：声音下拉、语言自动匹配、试听按钮。
- **可行性**：`[浏览器]`（`speechSynthesis.getVoices()`，`lang` 匹配）。**优先级**：P0

### 2.6 词典与翻译（DICT-）

#### DICT-001 触发方式
- **界面文案**：选择条「词典」按钮（单击=词典1，长按=词典2）、「自动查词」、「单字查词」。
- **行为**：`lookupWord(word, useDict2, fadeBar)`（10287）：把词写入「词典历史」（prefs `DICT_HISTORY_FILE`，键=词，值空），再 `openDictUrl(A.getDictUrl(index), word, ...)`；词典1=`dict_index`（默认 0），词典2=`dict_index2`（默认 -1=翻译）。`openDictDirect`（「选词后自动查词」，默认 false）：选中即查；`oneCharDict`（「单字查词」，亚洲语言默认 true）：见 ANNO-001。`translateInited` 为 false 时（首次）点词典/翻译按钮先弹「自定义词典设置」。
- **源码**：`ActivityTxt.lookupWord` 10287、`doDictButton` 18005、`openDictUrl` 20973、`A.getDictUrl` A.java:4546。
- **可行性**：`[浏览器]`。**优先级**：P0

#### DICT-002 词典来源与调用方式（原版全表）
`A.getDictUrl` 返回值 → `openDictUrl` 的分发（ActivityTxt.java:20973–21156）：

| 标识 | 含义 | 调用 | Web 替代 |
|---|---|---|---|
| `ColorDict3` | ColorDict/BlueDict/GoldenDict(深蓝词典) | Intent `colordict.intent.action.SEARCH` + `EXTRA_QUERY` + 弹窗位置(`EXTRA_HEIGHT/GRAVITY/MARGIN`) | 不可；见下 |
| `ColorDict` | ColorDict 老接口 | `VIEW` 指定组件 | 不可 |
| `Lingvo` | ABBYY Lingvo | `com.abbyy.mobile.lingvo.intent.action.TRANSLATE` 含弹窗高度/重力 | 不可 |
| `FreeDictionary` | TheFreeDictionary App | 组件 `org.freedictionary.MainActivity` | 在线 `https://www.thefreedictionary.com/%s` |
| `Leo` | LEO | 组件 `org.leo.android.dict.LeoDict` | 在线 `https://dict.leo.org/` |
| `YunCi` | 云词 | `com.yunci.search` | — |
| `Fora` | Fora Dict | `com.ngc.fora.action.LOOKUP` | — |
| `Merriam` | WordWeb App | 组件 `com.wordwebsoftware...WordWebActivity` + 查询 | 在线 WordWeb/Merriam-Webster |
| `Oxford` | 牛津词典 App | 先试 `com.oup.elt.oald9` / mobisystems Oxford 组件 `SEARCH`，失败 `PROCESS_TEXT` | 在线 Oxford Learner's |
| `Dictionray.com` | Dictionary.com App | `PROCESS_TEXT` | `https://dictionary.com/browse/%s`（`A.DICTIONARY_URL`） |
| `youdao` | 有道词典(离线) | `PROCESS_TEXT` 组件 `com.youdao.dict.activity.ProcessTextActivity` | `https://dict.youdao.com/result?word=%s&lang=en` |
| `XinHua` | 新华字典 | 组件 `hugh.android.app.zidian` + `zi` | 在线汉典/新华字典 |
| `Google`/`DICTIONARY_URL` | 在线 dictionary.com | `VIEW` 浏览器 | 同 |
| `Customized` | 自定义在线词典 | `VIEW` + `my_dict_url`（默认 `http://www.yourdictionary.com/%s`，`%s` 被 `Uri.encode(词)` 替换） | 同 |
| 以 `http` 开头的 URL（如中文 `http://dict.baidu.com/s?wd=%s&ie=utf-8`、`http://3g.dict.cn/s.php?q=%s`） | 在线词典 | `VIEW` | iframe/弹窗/新标签（受 `X-Frame-Options` 限制） |
| `USE_INTENT_DICT`(`*IndentDict`) | 「其它已安装应用」 | 动态保存 `dict.intent0/1`(包,类,名,类型)；类型 0=`ACTION_SEARCH`、1=`ACTION_SEND`、2=`ACTION_PROCESS_TEXT` | 不可 |
| `TRANSLATION_URL`(`https://translate.google.com/?sl=<SL>&tl=<TL>&text=%s`) | 翻译 | 若装了 Google 翻译 App 走 `translate.google.com/m/translate?q&tl&sl` 的 VIEW Intent，否则浏览器 | 见 DICT-004 |
| 维基 | `https://<UI语言>.wikipedia.org/wiki/%s`（`A.getWikiUrl` 8439） | `VIEW` | 同 |

> 设置里「词典」下拉（`dict_list`）：**英文**版=「ColorDict/BlueDict/GoldenDict、Oxford Dictionary、WordWeb App、Dictionary.com App、TheFreeDictionary.com App、ABBYY Lingvo App、自定义在线词典...」；**中文**版=「深蓝词典、欧路词典、MDict、ColorDict、有道词典（离线词典）、WordWeb词典（离线词典）、牛津词典（离线词典）、Dictionary.com（离线词典）、百度在线词典、海词在线词典、自定义在线词典...」，另加固定两项末尾「谷歌翻译」「其它已安装应用」。注意 zh 的 `dict_list`(11 项) 与 `dict_list_url`(8 项)条数不一致，`getDictUrl` 对越界索引回落到倒数第二项（存疑，见第 6 节）。

- **Web 建议**：内置「词典源」表 = `{id, 名称, urlTemplate, 方式: 'tab'|'iframe'|'popup'|'api'}`：必选项：Dictionary.com、Merriam-Webster、Oxford Learner's、Cambridge、Youdao(有道)、百度汉语/汉典、维基百科（按书语言选子域）、Google 翻译、Bing 词典、自定义（`%s`、`<SL>`、`<TL>` 占位符）；弹窗式（iframe）受 `X-Frame-Options/CSP frame-ancestors` 限制，**改用「服务端词典代理」把词条 HTML 抓取并清洗后以内联卡片展示**，或接开放词典 API（Free Dictionary API `dictionaryapi.dev`、Wiktionary REST、ECDICT 本地库 SQLite-WASM）。
- **可行性**：URL 跳转 `[浏览器]`；内联卡片 `[服务端]`：`GET /api/dict/lookup?q=&lang=&source=` → `{headword, phonetics, senses[], source}`（服务端负责抓取/缓存/CORS）；App Intent 类 `[不做: 浏览器无法调用本机词典 App]`。**优先级**：URL 模板 P0；内联卡片 P1；Intent 类不做

#### DICT-003 自定义词典与「设置」对话框
- **界面文案**：「自定义词典设置」(`customize_dictionary` / "Customize dictionary")，内容：可拖拽排序的选择条按钮列表（见 ANNO-002）；「词典1 (单击词典按键)」「词典2 (长按词典按键)」两个下拉（`single_tap_dict`/`long_tap_dict`）；「谷歌翻译」翻译源语言/目标语言下拉；复选「选词后立即打开词典」(`openDict`)、「单字查词」(`oneChar`，仅亚洲语言可见)；选「自定义在线词典...」弹窗「自定义在线词典(请用%s代替查询词语)」(`my_dict_hint`)。选「其它已安装应用」弹应用选择器并立刻试查。
- **行为**：确定后保存：`sourceLanguage`(默认 `auto`)、`destLanguage`(默认=UI 语言)、`dict_index`/`dict_index2`（特殊值：-1=翻译，-2=已安装应用）、`openDictDirect`、`oneCharDict`、`translateInited=true`；按钮顺序变化则隐藏当前选区。
- **源码**：`SelectBar.customizeSelectBar`（components/DragSort/SelectBar.java）；`A.getTranslationIndex/getTranslationAbbr`（语言列表 `R.array.translations/translations_abbr`，首项 `AUTO`）。
- **Web 建议**：设置页「词典与翻译」。语言列表可直接取 Google 翻译支持语言码。
- **可行性**：`[浏览器]`。**优先级**：P1

#### DICT-004 翻译
- 「翻译」按钮=`openDictUrl(TRANSLATION_URL, word)`：浏览器模板 `https://translate.google.com/?sl=<SL>&tl=<TL>&text=%s`。**Web 建议**：同 URL 在新标签；或服务端代理接 LibreTranslate/DeepL/Google Cloud Translation（需密钥）得到内联译文；段落/整页翻译原版无。
- **可行性**：URL `[浏览器]`；内联 `[服务端]`：`POST /api/translate {text,source,target}`。**优先级**：P1

#### DICT-005 维基百科、网络搜索
见 ANNO-002/012。**优先级**：P1

#### DICT-006 词典历史（生词本）
选择条「生词本」(`index 10`)、`showDictHistory`（22751）：列出历史词（`DICT_HISTORY_FILE` 的键，无序），点击用当前词典1查询；「清除历史」(`clear_dict_history`)。
- **Web 建议**：历史存时间、书名、上下文句子，可导出（生词本 CSV/Anki）。
- **可行性**：`[浏览器]`。**优先级**：P1

#### DICT-007 弹窗位置提示
原版把「选区所在高度」传给 ColorDict/Lingvo 以便弹窗不遮挡选区（`EXTRA_HEIGHT`/`EXTRA_GRAVITY`=屏幕上半部选区→弹窗置底，反之置顶）。**Web 建议**：气泡词典卡片避开选区（Floating UI `flip`）。**优先级**：P1

### 2.7 PDF 与 DJVU（PDF-）

#### PDF-001 打开、引擎与密码
- **行为**：`ActivityTxt.pdfOpen`（21373）：初始化 Radaee（`Global.Init`，失败提示「Incompatible device CPU: …」）、先 `A.SaveOptions`；PDF→`pdfOpen2`（14080）调用 `Document.Open(path, password)`：返回 -10「Access denied or invalid file path.」、-3「Damaged or invalid format.」、-2「Unknown encryption.」、-1 需要密码→**密码对话框**（标题「Need input password」、输入框、复选「保存密码」；密码用 `A.getEncryptText` 加密存 prefs `pdf` 的 `<路径>u`，是否保存 `<路径>s`；错误提示「Invalidated password.」）；DJVU>2MB 开线程加载并显示「加载中...」进度；CBZ/CBR 同样线程加载（COMIC-001）。
- **源码**：`ActivityTxt.pdfOpen` 21373、`pdfOpen2` 14080、`pdfCheckPassword` 13384；`PDFReader`(1692 行)。
- **Web 建议**：`pdfjs-dist`（`getDocument({url|data, password})`，捕获 `PasswordException`）；Worker 渲染；大文件用 range 请求。
- **可行性**：`[浏览器]`。**优先级**：P0

#### PDF-002 视图模式、渲染质量与页面选项
- **界面文案**（`PrefPdf`，标题「PDF 选项」）：「视图」(`pdf_view_mode`)：自动选择|单页模式|连续模式（带三张示意图可点选）；「渲染质量」(`pdf_render_quality`)：高|中|低；「页边颜色」(`pdf_margin_color`，默认 #FFC0C0C0；CBZ 默认白)；「统一所有页面尺寸以适配屏幕」(`pdf_unify_page_sizes`→`Global.fit_different_page_size`，改动会重启阅读器)；「在底部显示页面缩略图」(`pdf_thumbnail_list`→`pdf_show_thumb`)；「在进度栏显示文本重排按键」(`pdf_text_reflow_button`→`pdf_text_button`，默认 true)；「在进度栏显示标注按键」(`show_annotation_button`→`pdf_annot_button`，默认=是否 Pro)；「翻页动画」(`flip_animation`)+「速度」(`flip_speed`，0–50)+「重置:」（翻页动画跨设置见另一位）；「读取配色方案」(`load_from_theme`，选日/夜主题→`Global.pdf_theme`)；「控制选项」「其它选项」按钮跳转。隐藏项：双页(`dual_page`)、缺字体提示(`pdf_missed_font_hint`)、放大倍数滑块(`pdf_max_zoom`)。
- **行为**：`setGlobalValue`（15705）：渲染质量 高→`render_mode=2`、中→1、低→0；视图模式映射 Radaee `def_view`：**自动**=横屏→0(连续竖向滚动)/竖屏→3(逐页)；**单页**=横屏→1(横向翻页)/竖屏→3；**连续**=0。Radaee `PDFSetView` 的模式值（PDFLayoutView.java:2422）：`1`=`PDFLayoutHorz`(横向翻页)；`3`、`4`、`6`=`PDFLayoutDual`（第二参数 `boolean[]`：3=全 false、4=全 true、6=null，并传入 `Global.rtol`）；其它(含 0)=`PDFLayoutVert`(竖向连续)。Moon+ 只会选用 0/1/3；**3 的确切语义（推测为「逐页，单页占满」）与 4/6（双页并排/含封面页）的区别未核对**。
- **源码**：`PrefPdf`(361 行)、`ActivityTxt.setGlobalValue` 15705、`com.radaee.reader.PDFLayoutView.PDFSetView` 2422。
- **设置项**：`pdf_view_mode`(0)、`pdf_render_quality`(1=中)、`pdf_back_color`(#FFC0C0C0)、`cbz_back_color`(白)、`fit_different_page_size`(false)、`pdf_show_thumb`(false)、`pdf_text_button`(true)、`pdf_annot_button`、`flip_pdf`(0)、`pdf_scoll_lock`(false)、`pdf_font_hint`(false)。
- **Web 建议**：pdf.js `scale` + `devicePixelRatio` 控制清晰度（高=DPR×1.5 上限，低=DPR×0.75）；连续=垂直滚动（虚拟化页面，`IntersectionObserver` 懒渲染）、逐页=翻页容器；背景色即容器背景；「统一页面尺寸」=每页缩放到同宽。
- **可行性**：`[浏览器]`。**优先级**：P0

#### PDF-003 目录、书签、进度
- 目录：PDF `Document.GetOutlines()` 递归（`pdfAddTocTree` 13320；失败记入 `pdf_toc_failed` 防二次崩溃）；DJVU `getOutline()`（链接字符串转页号，上限末页）。进度/位置=页号（`A.lastPosition`）+页内偏移（`XPos{pageno,x,y}`，`PDFGetPos/PDFSetPos`），状态栏显示页码。书签=页级（位置存页号，名称含前缀文本）；统计字数惰性逐页取文本。
- **Web 建议**：`pdf.getOutline()`+`getDestination`→页码；位置存 `{page, yRatio}`；缩略图条用 `pdf.getPage(n).render` 低分辨率。
- **可行性**：`[浏览器]`。**优先级**：P0

#### PDF-004 PDF 文字选择与高亮写回
- **行为**：选择走 Radaee `zSetSelect`（页内字符序号 `selIndex1/2`，`selectedText` 内容用 `formatPdfCopyText` 整理）。高亮=`annotSetMarkup(type)`（类型：0 高亮、1 下划线、2 删除线、4 波浪线；对应 PDF 标注子类型 Highlight/Underline/StrikeOut/Squiggly，Radaee `Page.Annotation.GetType()` 9/10/12/11）**写入 PDF 文件**；同时 `pdfSaveHighlightNote` 写一条 DB 记录（`lastChapter=Page.note_start`(页内起始字符序号)、`lastSplitIndex=Page.note_end`(结束序号)、`lastPosition=页号`、`highlightLength=end-start`、`original`=选中文本、颜色/样式同文本书）。点击已有标注改色/删除直接操作 `Page.Annotation`（`SetFillColor/SetStrokeColor`）。笔记文字存为标注的 popup text（`SetPopupText`），点击可编辑（`pdfDoAnnotation` 21233）。**只在 `CanSave()`（未锁定）且 Pro 时可用**，否则提示「PDF文档处于锁定状态, 无法编辑」(`pdf_cannot_modify`)/「该功能只在专业版里可用」(`pro_only`)。
  - **保存策略**：`A.pdfAnnotUpdated` 置位后，`pdfSaveAnnotsForTime`（21527）每 ≥5 分钟（`DbxCredential.EXPIRE_MARGIN`=300000 ms）才 `Document.Save()`；退出/切换时 `pdfSaveAnnotsForSecurity`（21517）强制保存。
- **Web 建议**：**不要直接改 PDF**：把 PDF 标注存服务端/IndexedDB（`{page, quadPoints[], style, color, note}`），渲染时在 pdf.js 文本层上叠加 SVG；导出时可用 `pdf-lib` 生成带 `/Annots` 的副本（P2）。pdf.js 4.x 自带 AnnotationEditor（highlight/freetext/ink/stamp）可参考。
- **可行性**：叠加层 `[浏览器]`；写回文件 `[服务端]`/可选（`pdf-lib` 可在浏览器完成，但需把文件回写到存储：`PUT /api/books/{id}/file`）。**优先级**：叠加高亮 P1；写回 P2

#### PDF-005 PDF 标注工具栏（Pro）
- **行为**：顶栏标注按钮（`pdf_annot_button`）打开标注栏（`pdfInitAnnotButtons` 13733）：便笺(Note)、自由文本(Free text, 字号 `freeTextSize` 默认 18，可选 11 起)、手绘(Ink, 线宽 `inkWidth` 默认 4.0)、直线(Line)、箭头(Arrow)、矩形(Rect)、椭圆(Ellipse)、取消；属性栏：取消、粗细/字号、颜色(`inkColor`)、填充色(`fillColor`)、便笺文字(`apNote`)。记录最后用的工具 `lastAnnotType`。选中已有标注可改色/粗细/删除。Radaee 资源里还有印章/多边形/折线/签名按钮但主界面未启用。
- **设置项**：`Global.inkWidth`(4.0)、`freeTextSize`(18)、`inkColor`、`fillColor`、`lastAnnotType`。
- **Web 建议**：pdf.js AnnotationEditor（FreeText/Ink/Highlight/Stamp）或自绘 SVG 叠层（直线/箭头/矩形/椭圆/手绘/便笺）。
- **可行性**：`[浏览器]`。**优先级**：P2

#### PDF-006 文本重排模式（Text Reflow）
- **界面文案**：进度栏上的「文本重排」按钮（`chromeIv`，切换后图标变 `mrbookview2`）。
- **行为**：`pdfTextReflowSwitch`（14299）：`Global.textReflow` 切换；开启后隐藏 PDF 视图，把当前页文本经 `pdfCreateReflowTextForShow`（21220；PDF 用 `A.formatPdfReflowText`，DJVU 用 `formatDjvuReflowText`，经简繁转换，末尾追加 ` <页/总页>`）塞进文本阅读器（排版/主题/字号/TTS/选择/搜索全部可用），翻页即换页文本；再切回恢复页面视图并 `PDFGotoPage`。进入/退出会清空搜索结果；重排模式下 PDF 的锁定图标隐藏。
- **Web 建议**：pdf.js `getTextContent` → 段落重组（按 y 间距/行末标点/连字符合并，复刻 `formatPdfCopyText/ReflowText` 规则）→ 作为 HTML/文本书渲染。复杂版面效果不佳，需标注「实验」。
- **可行性**：`[浏览器]`。**优先级**：P1

#### PDF-007 PDF 夜间/主题
- `Global.pdf_theme`：0=普通(背景=`pdf_back_color`)、1=夜间（Radaee 反色渲染；`isNightState` 用它判断夜间）；一键日夜切换时同步切换（`clickDayNightButton` 2773）；「读取配色方案」选日/夜主题映射。DJVU/CBZ 夜间时背景纯黑。
- **Web 建议**：对 canvas 用 CSS `filter: invert(1) hue-rotate(180deg)`（保留图片需对 img 层再反色）或 pdf.js 渲染后像素反色；背景色独立设置。
- **可行性**：`[浏览器]`。**优先级**：P1

#### PDF-008 缩略图条、页面锁定、链接
- 缩略图条（底部，`pdf_show_thumb`，`PDFThumbView`，点击跳页）；**锁定**（`pdfLockIv`，`pdf_scoll_lock`）：锁定单一滚动方向防误触，右下角锁图标；PDF 链接（内部页跳转/外链）点击前记录「链接返回」（`beforePageJump`），链接高亮色 `Global.annotTransparencyColor`(prefs `pdfLinkColor`，默认 #200040FF 半透明蓝)。
- **Web 建议**：缩略图条 + 锁定=禁止横向/纵向惯性；pdf.js 的 `PDFLinkService` 处理内链，叠加高亮层。
- **可行性**：`[浏览器]`。**优先级**：P2

#### PDF-009 PDF 注释的云同步串格式（`#A*#`）
- 见 4.4.4；`PDFcreateNotesFromCloud`（`PDFReader.java:944`）/`PDFcreateTextFromNotes`/`PDFupdateNotesToFile`（只回写比 PDF 文件修改时间新的记录）。同步通道属书架与同步分区文档。
- **优先级**：P2

#### PDF-010 DJVU
- 引擎 `libmydjvu.so`+`org.djvu`（`DDocument/DPage/DLayoutView`），>2MB 线程加载；仅文本高亮（存 DB，不写文件）；选项里 `djvu_smooth`（抗锯齿，默认 true，文案「字体抗锯齿」`font_antialias`）；有目录（outline）与文本层（`ObjsGetText`），支持文本重排与 TTS。
- **Web 建议**：`djvu.js`（WASM，RussCoder/DjVu.js）渲染+文字层；性能弱，标 P2。服务端回退：转 PDF/PNG 切片。
- **可行性**：`[浏览器]`（djvu.js）/`[服务端]`（回退）。**优先级**：P2

### 2.8 漫画与图片（COMIC-）

#### COMIC-001 CBZ / CBR 打开
- **行为**：`.cbz/.cbr` 属 bookType 7，由 `PDFReader`+Radaee `CLayoutView/CDocument` 渲染（`isCbz`），**线程加载并显示进度**，不支持文本选择/标注/朗读/搜索/目录。页序由 Radaee 原生 `CDocument` 决定（排序规则未知，见第 6 节），画廊路径则用字典序 `Collections.sort`；封面=字典序第一张图（`getCbzCoverBitmap`）。zip/rar 引擎见 FMT-020。
- **Web 建议**：fflate/JSZip 解 zip；用**自然排序**（`localeCompare(undefined,{numeric:true})`）排序图片名（原版字典序会把 10 排在 2 前，建议修正）；过滤 `.png .jpg .jpeg .gif .webp .svg`（再加 `.avif`），忽略以 `.`/`__MACOSX` 开头；懒加载 `<img>`/`createImageBitmap`。
- **可行性**：`[浏览器]`。**优先级**：P0

#### COMIC-002 ComicInfo.xml 元数据
- `ComicInfo`（books/ComicInfo.java）：在压缩包里找名为 `ComicInfo.xml`（否则第一个 `.xml`），字符串方式读取 `Title/Series/Number/Count/Volume/Summary/Writer`：书名=Title，作者=Writer，简介=Summary，分类追加 `<Series>`、`#Volume#`。
- **Web 建议**：`DOMParser` 解析，支持标准 ComicInfo 字段（还可读 `Genre/Publisher/Year/Manga(=RightToLeft)/LanguageISO`）。
- **可行性**：`[浏览器]`。**优先级**：P1

#### COMIC-003 漫画阅读视图（Radaee CLayout）
- **界面文案**（`PrefPdf` 在 CBZ 下，标题「CBZ/CBR 选项」）：「视图」自动/单页/连续（同 PDF-002）；「字体抗锯齿」(`font_antialias`→`cbz_smooth`，默认 true=双线性平滑缩放)；「页边颜色」(`cbz_back_color`，默认白)；翻页动画；渲染质量与「统一页面尺寸」「缩略图」在 CBZ 下隐藏；无文本重排按钮。
- **行为**：沿用 PDF 的视图模式表（竖向连续/横向/逐页/双页）；Radaee 全局有 `rtol`(从右到左，`Global.rtol` 默认 false)用于双页布局，但**Moon+ 界面未暴露此开关**（存疑，见第 6 节）；缩放手势、双击由 Radaee 内部处理；点击区动作沿用「点击区」配置（上/下/左/右/中，见另一位）。
- **Web 建议**：**必须补充**「阅读方向 左→右 / 右→左（日漫）」「单页/双页（含封面单页）」「适应宽度/适应高度/适应屏幕/原始大小」「连续竖向滚动（长条漫）」；预加载前后 2 页；双击缩放循环；背景色。
- **可行性**：`[浏览器]`。**优先级**：P0

#### COMIC-004 图片画廊（PicGalleryShow）
- **入口**：点击/长按书内图片（`startImageGallery` 17086；`longTapImageFullScreen`=true 时长按）、文件管理器打开图片/zip 内图片/文件夹里的图片、PrefChapters 图片标签长按、网络书目封面。
- **行为**：
  - 图片列表：EPUB 等用 `ebook.getImageFileList()`；其他=同目录（或 zip/rar 同级）所有图片**字典序排序**（`createImagetFileList` 386，忽略 zip 内以 `.` 开头文件）；`singPicOnly` 只看单张。
  - 主体 `ViewPager` + 每页 `ComicView`（PhotoView 衍生，`ComicViewAttacher`）：缩放 **min 1.0 / mid 1.75 / max 3.0**，**双击循环**：当前<mid→mid；mid≤当前<max→max；否则→min（动画 200 ms）；双指缩放、拖动，边缘到达后再滑动翻页。
  - 底部**缩略图条**（`Gallery`，高度 `cbzThumbSize` dp，≤屏高/3），点击跳转；顶栏：返回、「第 N/总」标题、GIF 查看(`gif`，`PrefHtmlViewer` type 1)、分享(`shareIv`，保存临时图后 `ACTION_SEND image/png`)、日夜背景(`daynightIv`→`galleryWhiteBackground` 切换黑/白)、幻灯片(`playIv`，间隔 `gallerySlideshowInterval` 秒，默认 3)、选项(`optionIv`)。
  - **点击**：中间区域切换工具栏显隐；上/下/左/右区映射为「上一张/下一张」（`doTouchDown`→`A.doTapScreenTop/Bottom/Left/Right` 值 0=上一张、1=下一张，其余忽略；点击区几何见另一位）。
  - 选项对话框「菜单选项」：亮度（滑块 + 「自动」`galleryBrightnessValue=-100`）、「显示小型阅读状态栏」(`galleryShowStatusbar` 默认 true，状态栏含时间/章节/进度/电量)、「阅读时保持屏幕长亮」(`keepScreenAwakePic`)、「播放间隔」。
  - **进度记忆**：打开 zip/rar 图包时上次看到的图片存 prefs `cbz_progress`（键=包路径）。
  - 多线程把 zip/rar 全部图片解到缓存（`unzipImagesProc`/`unrarAll`，显示「加载中...」）。
- **源码**：`PicGalleryShow`(1543 行)：`createImagetFileList` 386、`initCbzBrowser` 603、`onClick` 1111；`components/picview/*`（`ComicViewAttacher` 944 行：`mMinScale=1.0, mMidScale=1.75, mMaxScale=3.0`，`ZOOM_DURATION=200`；`DefaultOnDoubleTapListener`）。
- **设置项**：`galleryShowStatusbar`(true)、`galleryWhiteBackground`(false)、`galleryBrightnessValue`(-100)、`gallerySlideshowInterval`(3)、`keepScreenAwakePic`、`fitImageToScreen`、`longTapImageFullScreen`(true)、`imageWhiteTransparent`(false)、`mult_touch`(false)。
- **Web 建议**：Lightbox（如 PhotoSwipe / 自写）：双击缩放循环（1→1.75→3→1）、捏合、拖动、键盘左右、幻灯片 `setInterval`、下载/分享（Web Share Files）；缩略图条用 `IntersectionObserver` 懒加载。
- **可行性**：`[浏览器]`。**优先级**：P1

#### COMIC-005 漫画进度、书签与阅读状态
- 位置=页码（0 基，`A.lastPosition`），书签=页级（见 ANNO-007），进度百分比=页/总页；`pdfSaveLastPosition`（14127）每次翻页写入位置，退出保存统计。
- **可行性**：`[浏览器]`。**优先级**：P0

### 2.9 其他内容处理（MISC-）

#### MISC-001 汉字简繁转换
- **界面文案**：视觉选项里「汉字繁简转换」(`chinese_fan2jian`，繁→简)、「汉字简繁转换」(`chinese_jian2fan`，简→繁)，**互斥**；开启时弹窗问「是否同时转换常见词汇? 比如 公事包->公文包 / 碧咸->贝克汉姆」（`jianFanWord`/`fanjianWord` = 是/否，对应词库 `Converter.loadLexemicMapping`；简→繁弹窗另注明「一对多的转换(比如发字)可能无法…」）。
- **行为**：`A.chineseJianFanConvert`（A.java:2149）= 先做「名字替换」(MISC-002)，竖排模式下替换引号/括号为竖排字符（`“‘〝`→`﹁`，`”’〞`→`﹂`，`( ) [ ]`→`︵ ︶ ﹁ ﹂` 对应码点），再按开关调用 `ChineseJianFanConvert.convertJian2Fan/convertFan2Jian`（库 `com.luhuiguo.chinese.ChineseUtils.toTraditional/toSimplified`；API<19 用内置单字表 `ft2jt/jt2ft`）；**仅当 UI 语言为中文、且两开关不同时开启时生效**。作用范围：正文显示文本（TXT/HTML/章节）、目录标题、搜索（先转换再匹配）、书签名、PDF 重排文本；**不修改原文件、不影响存储的标注原文**（标注 `original` 存的是转换后的显示文本——存疑）。
- **设置项**：`textJian2Fan`、`textFan2Jian`(false)、`jianFanWord`、`fanjianWord`(false)。
- **Web 建议**：`opencc-js`（含 `cn→tw/hk/twp` 地区词汇、仅字模式可选 `s2t`）；在显示层转换；搜索时对关键词与文本做同样转换；**标注 `original` 建议存「原文」**并在显示时转换。
- **可行性**：`[浏览器]`。**优先级**：P1

#### MISC-002 名字替换（Names replacement）
- **界面文案**：「名字替换」(`names_replacement`)，含「用正则表达式」开关，菜单位置「替换项显示在主菜单」(`replacement_in_menu`)。
- **行为**：`A.do_names_replacement`（A.java:3032，**Pro**）：先应用**本书**替换表（`getNamesReplacement(lastFile)`），再应用**全局**表，每条 `原文→替换`（正则开关用 `replaceAll`，错误忽略）；在 `chineseJianFanConvert` 链路最前（即所有显示文本）。
- **设置项**：`replace_regular`(false)、`replacement_in_menu`(true)。
- **Web 建议**：设置里的规则表（作用域：本书/全局，字面/正则，启用开关）；在渲染前对文本节点做替换（遍历 `TreeWalker`，不破坏标签/不跨节点）。
- **可行性**：`[浏览器]`。**优先级**：P2

#### MISC-003 日文注音（Aozora Ruby）与图片注记
- **行为**：`JpRubyTxt.dealJpRubyTxt`（components/JpRubyTxt.java）仅处理**TXT**：文本里含 `《` 与 `》` 或 `.jpg）` 才启动；`汉字《かな》`（括号内长度 2–11 字符，即 `i4>1 && i4<12`）→ 取《前**连续 CJK 统一汉字**（最多与读音等长的字符数；可向前跨已是 Ruby 的汉字）作为底文，生成 `Ruby(rt=读音, original=底文)` span，正文去掉《…》；相邻 Ruby 之间按读音/底文长度差补空格或 `INDENT_CHAR` 以免重叠；青空文库插图 `［＃…（xxx.jpg）…］`/`（xxx.jpg）` → 在**TXT 同目录**找该图片文件，替换成内嵌图片（居中，宽>屏宽的一半则居中、>屏宽则缩放）。`MyHtml.hasRuby` 记录是否有注音，TTS 用读音替换。HTML 书里的 `<ruby><rb><rt><rp>` 由 `HtmlToSpannedConverter` 原生支持。
- **Web 建议**：TXT 预处理成 `<ruby>漢字<rt>かな</rt></ruby>`（正则 `([一-鿿々〆ヶ]{1,10})《([^《》]{1,10})》`）；青空文库的 `｜漢字《かな》`（竖线明示底文起点）原版未处理，建议支持；图片按相对路径取（需用户选择文件夹/ZIP 内相对路径）。
- **可行性**：`[浏览器]`。**优先级**：P2

#### MISC-004 图片相关选项
见 FMT-010 设置项：「图片相关选项」(`image_display_options`)：「把所有图片扩大到屏幕宽度」「长按图片时用全屏模式打开」「全屏时使用白色背景(缺省为黑色)」「把图片里的白色背景替换成透明色」。**优先级**：P2

#### MISC-005 PrefImageBrowser1（封面/背景图选择器）
选书封面（PrefEditBook）、选主题背景图（PrefVisual）、书架（ActivityMain）用的图片网格选择器，**属于书架/主题分区**，这里仅交叉引用。**可行性**：`[不做: 归书架与主题分区]`。**优先级**：—

#### MISC-006 书籍信息对话框（交叉引用）
`ActivityTxt.do_book_info`（18000 行附近）显示书名-作者、文件名、位置、大小、总页数/字数/剩余字数等，字段细节归阅读器菜单分区；本文件只涉及其中字数统计（FMT-021）。**优先级**：—

#### MISC-007 速读（Speed reading）（交叉引用）
`PrefSpeedRead`/`doSpeedRead`：按 WPM（默认 200，字号 30，每次 1 词）逐词闪现，非本区范围，仅提示存在 `speedReadWPM/Size/Words`。**优先级**：—

#### MISC-008 PWA 文件打开与分享目标
- 原版靠 Android Intent（`VIEW`/`SEND`）。Web：manifest `file_handlers`（Chromium）、`share_target`（接收分享的文本/文件）、`launchQueue`；移动 Safari 仅文件选择器。
- **可行性**：`[浏览器]`（Chromium 为主）。**优先级**：P2

### 2.10 必须/建议走服务端的能力汇总

| 能力 | 条目 | 服务端需要提供 | 性质 |
|---|---|---|---|
| CHM 解包 | FMT-014 | `POST /api/convert/chm` → 目录 JSON(含层级)+资源文件夹+编码；实现可用 `chmlib`/`7z`/`extract_chmLib` | **必须**（浏览器无成熟库） |
| RAR/CBR 解压回退、超大压缩包 | FMT-020、COMIC-001 | 列表/取条目接口：`GET /api/archive/{id}/entries`、`GET /api/archive/{id}/entry?path=`（`unrar`/`7z`/`libarchive`） | 建议（浏览器可用 WASM `node-unrar-js`，大文件回退） |
| 词典内联卡片、词条抓取与清洗 | DICT-002 | `GET /api/dict/lookup?q&lang&source`（CORS 代理+缓存+清洗），可接 ECDICT/Wiktionary/Free Dictionary API | 建议（否则只能打开新标签） |
| 翻译 | DICT-004 | `POST /api/translate {text,source,target}`（LibreTranslate/DeepL/Google） | 可选 |
| TTS 后台/锁屏连续朗读与自然声音 | TTS-010、TTS-014 | `POST /api/tts/synthesize {text,voice,rate,pitch,lang}`→`audio/*`（可带词时间戳）、`GET /api/tts/voices` | 前台不需要；后台**必须** |
| Readwise 同步 | ANNO-011 | `POST /api/integrations/readwise/highlights`（服务端持 token 代发） | 可选 |
| 标注/书签/进度/设置的多端存储 | ANNO-009、ANNO-010 | 标注表(带 `updatedAt`/墓碑)、选择条/朗读过滤/词典设置的 KV 配置；`.mrexpt` 导入导出可在前端完成 | **必须**（要多端同步时） |
| PDF 标注写回文件 | PDF-004 | `PUT /api/books/{id}/file`（接收 `pdf-lib` 生成的新文件，保留版本） | 可选（建议默认只存叠加层） |
| DJVU 回退、ODT/RTF 转换 | PDF-010、FMT-015、FMT-016 | `POST /api/convert/{djvu-to-pdf\|odt-to-html\|rtf-to-html}`（`ddjvu`/`libreoffice`/`pandoc`） | 可选（浏览器 djvu.js/mammoth/rtf.js 可先做） |
| 超大 TXT（>200 MB）切块索引 | FMT-005 | 上传时服务端按块解码/建分章索引 | 可选 |

---

## 3. 设置项总表

> 字段名为 `A.java`（或 `Global`）里的静态字段；「存储键」为 SharedPreferences `OPTIONS_FILE` 中的键（`A.LoadOptions` A.java:1260–1735 读取、`SaveOptions` A.java:1738 写入）；颜色统一换成 `#AARRGGBB`。UI 位置里的「视觉选项/杂项/控制」属排版与设置分区，仅标注入口。

### 3.1 文本/格式

| 字段 | 存储键 | 默认值 | 含义 | UI 位置 |
|---|---|---|---|---|
| `textEncode` | `textEncode` | 空→亚洲语言 UI `AUTO` / 否则 `UTF-8` | 全局默认文本编码 | 视觉选项 · 文字编码 |
| 每文件编码 | prefs `file_encoding[路径]` | 无 | 单本书覆盖编码 | 同上（选择即写入） |
| `trimBlankSpace` | `trimBlankSpace` | false | 删除多余空格和空行 | 杂项 · 删除多余空格和空行 |
| `indentParagraph` | `indentParagraph` | 中文 UI=true | 段落首行缩进 | 杂项 · 段落首行缩进 |
| `indentLength` | `indentLength` | 2 | 缩进字符数（全角空格） | 视觉选项 |
| `txtChapterSplit` | `txtChapterSplit` | false | TXT 新章另起一页 | 杂项 |
| `chapterEndPrompt` | `chapterEndPrompt` | false | 章末显示「翻页加载下一章」提示 | 杂项 · 在章节结束处显示提示信息 |
| `maxHtmlChapterSize` | `maxHtmlChapterSize5` | 100000 | 单个 HTML 章拆分阈值（字符） | 杂项（高级） |
| `footnoteOnBottom` | `footnoteOnBottom` | false | 脚注直接显示在章内 | 杂项 · 在章节里直接显示注解内容 |
| `disableCSS` | `disableCSS3` | false | 禁用书内 CSS 总开关 | 杂项 · 禁用电子书内置的CSS样式表 |
| `cssFontStyle/cssFontSize/cssFontColor` | `cssFontStyle/cssFontSize2/cssFontColor` | false | 分项禁用 字体类型/大小/颜色 | 同上（子项） |
| `cssAlignment/cssJustify/cssIndent/cssLineSpace/cssOthers` | `cssAlignment/cssJustify/cssIndent2/cssLineSpace2/cssOthers` | false/**true**/false/false/false | 分项禁用 对齐/两端对齐/缩进/段间距/其它 | 同上 |
| `useCssFont` | `useCssFont` | false | 使用书内 CSS 指定字体 | 同上 |
| `disableLinkColor` | `disableLinkColor` | false | 禁用 CSS 指定链接色 | 同上 |
| `linkColor`/`linkColorNight`/`linkVisitedColor`/`…Night` | 同名 | `CSS.LINK_COLOR` | 链接颜色（日/夜/已访问） | 杂项 · 链接颜色 |
| `noteTextColor`/`noteBackColor`（+Night） | 同名 | `#FF111111` / `#FFF6EA8C` | 标注弹窗文字/背景色 | 杂项 · 标注弹窗颜色 |
| `useWebView` | `useWebView` | false | 用 WebView 渲染 | Chrome 按钮 |
| `textJian2Fan` / `textFan2Jian` | 同名 | false | 简→繁 / 繁→简（互斥） | 视觉选项 |
| `jianFanWord` / `fanjianWord` | 同名 | false | 转换时包含常见词汇 | 弹窗选择 |
| `names_replace_with_regular_expression` | `replace_regular` | false | 名字替换用正则 | 杂项 · 名字替换 |
| `replacement_in_main_menu` | `replacement_in_menu` | true | 替换入口放主菜单 | 同上 |
| `fixedBlockLength` | —(运行时) | 手机 2048 / 平板 4096 | TXT 块长（字符） | 无 |
| `BIG_FILESIZE` | 常量 | 1000000 | 大文件阈值 | 无 |

### 3.2 选择、标注、书签

| 字段 | 存储键 | 默认值 | 含义 | UI 位置 |
|---|---|---|---|---|
| `doLongTap` | `doLongTap` | 17（页面文字摘录） | 长按动作 | 控制选项 |
| `longTapInterval` | `longTapInterval` | 0.4（秒） | 长按判定时长 | 控制选项 |
| `oneCharDict` | `oneCharDict` | 亚洲语言 UI=true | 点中 CJK 字只选一个字 | 自定义词典设置 |
| `showMagnifier` | `showMagnifier` | 手机 true / 平板 false | 选择时放大镜 | 高亮对话框 |
| `highlightMode` | `highlightMode` | 0 | 当前样式 0高亮/1下划线/2删除线/3波浪线 | 高亮对话框、颜色模板 |
| `highlight_color` | `highlight_` | `#7700AAFF` | 高亮背景色 | 同上 |
| `underline_color` | `underline_color` | `#FF555555` | 下划线色 | 同上 |
| `strikethrough_color` | `strikethrough_color` | `#FF555555` | 删除线色 | 同上 |
| `squiggly_color` | `squiggly_color` | `#FF00FF00` | 波浪线色 | 同上 |
| `highlight_color1..5` | `highlight_1..5` | `#FF99AA77`/`#FFFF9200`/`#FFCC99C0`/`#88888888`/`#7700AAFF` | 预设色/最近色 | 颜色模板、高亮对话框 |
| `highlightStyleAsSelec` | `highlightStyleAsSelec` | false | 用最后样式高亮 | 高亮对话框 |
| `directHighlight` | `directHighlight` | false | 长按+拖动直接标注 | 高亮对话框 |
| `showColorTemplate` | `highlightColorTemplate` | true | 工具条上方颜色模板 | 高亮对话框 |
| `pdf_select_color` / `pdf_highlight_color` | `pdfSelColor4` | =`highlight_color` | PDF 高亮色 | PDF 高亮 |
| `bookmark_color` | `bookmark_color` | `#FFFF0000` | 书签颜色 | 书签对话框 |
| `bookmarkNoColor` | `bookmarkNoColor` | **true** | 书签不带颜色 | 书签对话框 |
| `bookmarkManually` | `bookmarkManually2` | true | 创建书签前输入名称 | 书签对话框/选项 |
| `bookmarkSortByDate` | `bookmarkSortByDate` | false | 书签/标注按时间排序 | 书签选项 |
| `showBookmarkIcon` | `showBookmarkIcon` | true | 右上角书签角标占位提示（创建一次书签后置 false） | 内部 |
| `chapterReversed` | `chapterReversed` | false | 目录/书签/图片倒序 | 目录面板 |
| `shareWithChapter` | `shareWithChapter` | true | 分享内容含章节 | 书签选项 |
| `syncReadWise`/`readWiseToken`/`readWiseUrl` | `syncReadWise`/`readWiseToken`/`readWiseUrl` | false/空/`https://readwise.io/api/v2/highlights/` | Readwise 同步 | 书签选项 |
| `highlightAllItems/Properties` | prefs `<路径hash>_highlight` | 空 | 本书「高亮所有同词」表 | 高亮对话框 |
| 选择条按钮 | 文件 `select_bar` | 见 ANNO-002 | 按钮顺序/勾选 | 自定义词典设置 |
| `share_export_path` | `share_export_path` | 默认下载目录 | `.mrexpt` 导出目录 | 导出对话框 |

### 3.3 搜索

| 字段 | 存储键 | 默认值 | 含义 | UI 位置 |
|---|---|---|---|---|
| `searchCaseSensitive` | `searchCaseSensitive` | false | 区分大小写 | 搜索 · 选项 |
| `searchWholeWord` | `searchWholeWord` | false | 单词模式（`\b`） | 搜索 · 选项 |
| `searchBackwardOnly` | `searchBackwardOnly` | false | 只搜已读（向后） | 搜索 · 选项 |
| `searchForwardOnly` | `searchForwardOnly` | false | 只搜未读（向前） | 搜索 · 选项 |
| `lastSearchKey` / 历史 | `lastSearchKey` / prefs `SEARCH_HISTORY_FILE` | 空 | 上次关键词/历史 | 搜索 |
| `MAX_RESULTS` | 常量 | 5000 | 结果上限 | 无 |

### 3.4 TTS

| 字段 | 存储键 | 默认值 | 含义 | UI 位置 |
|---|---|---|---|---|
| `tts_divide` | `tts_divide` | 1（句号级） | 0逗号/1句号/2整段/3整页 | TTS 选项 |
| `tts_speed` | `tts_speed` | 10 | 速度=值/10（滑块 0–40，>30 时步长 2，最高 50） | TTS 面板 |
| `tts_pitch` | `tts_pitch` | 10 | 音调=值/10（滑块 0–20） | TTS 面板 |
| 音量 | 系统媒体音量 | 系统值 | 滑块 0–15 | TTS 面板 |
| `tts_stop_enable` | `tts_stop_enable` | false | 定时停止 | TTS 选项 |
| `tts_stop_time` | `tts_stop_time2` | 10（分钟） | 定时停止分钟数 | TTS 选项 |
| `tts_interval_enable` | `tts_interval_enable` | false | 句间间隔 | TTS 更多选项 |
| `tts_interval_time` | `tts_interval_time` | 500（毫秒） | 句间间隔长度 | 同上 |
| `askForTts` | `askForTts` | true | 朗读前显示选项对话框 | TTS 选项/更多选项 |
| `firstTimeUseTts` | `firstTimeUseTts` | true | 首次使用引导 | 内部 |
| `disableAudioFocus` | `disableAudioFocus` | false | 不与其他音频 App 争焦点（可后台） | TTS 更多选项 |
| `tts_filter_with_regular_expression` | `tts_regular` | false | 朗读过滤用正则 | 朗读字符过滤 |
| 朗读过滤表 | 文件 `tts_filter` | 4 条（`—`、`-`、` '`、`' `→空格） | 过滤/替换规则 | 朗读字符过滤 |
| 耳机键动作 | `doHeadsetHook(O)`/`doMediaPlayPause(O)`/`doMediaPlayNext(O)`/`doMediaPlayPrevious(O)` | 见控制分区 | 耳机/媒体键映射 | 控制选项 |

### 3.5 词典与翻译

| 字段 | 存储键 | 默认值 | 含义 | UI 位置 |
|---|---|---|---|---|
| `dict_index` | `dict_index3` | 0 | 词典1（单击）；-1=翻译，-2=已安装应用 | 自定义词典设置 |
| `dict_index2` | `dict_index_l3` | -1 | 词典2（长按） | 同上 |
| `my_dict_url` | `my_dict_url` | `http://www.yourdictionary.com/%s` | 自定义在线词典模板 | 同上 |
| `sourceLanguage` | `sourceLanguage` | `auto` | 翻译源语言 | 同上 |
| `destLanguage` | `destLanguage` | UI 语言码 | 翻译目标语言 | 同上 |
| `openDictDirect` | `showDictDirect` | false | 选词后自动查词 | 同上 |
| `translateInited` | `translateInited4` | false | 是否已做过首次词典设置 | 内部 |
| `dict.intent0/1` | 文件 | 无 | 「其它已安装应用」选择 | 同上 |
| 词典历史 | prefs `DICT_HISTORY_FILE` | 空 | 查过的词 | 生词本 |

### 3.6 PDF / DJVU / 漫画 / 画廊

| 字段 | 存储键 | 默认值 | 含义 | UI 位置 |
|---|---|---|---|---|
| `pdf_view_mode` | `pdf_view_mode2` | 0 | 0自动/1单页/2连续 | PDF 选项 · 视图 |
| `pdf_render_quality` | `pdf_render_quality` | 1 | 0高/1中/2低 | PDF 选项 · 渲染质量 |
| `pdf_back_color` | `pdf_back_color3` | `#FFC0C0C0` | PDF 页边颜色 | PDF 选项 |
| `cbz_back_color` | `cbz_back_color` | `#FFFFFFFF` | CBZ 页边颜色 | PDF 选项(CBZ) |
| `Global.fit_different_page_size` | `fit_different_page_size` | false | 统一页面尺寸 | PDF 选项 |
| `pdf_show_thumb` | `pdf_show_thumb` | false | 底部缩略图 | PDF 选项 |
| `pdf_text_button` | `pdf_text_button2` | true | 进度栏文本重排按钮 | PDF 选项 |
| `pdf_annot_button` | `pdf_annot_button` | 是否 Pro | 进度栏标注按钮 | PDF 选项 |
| `pdf_scoll_lock` | `pdf_scoll_lock` | false | 滚动锁定 | PDF 锁图标 |
| `pdf_font_hint` | `miss_font_hint` | false(运行时) | 缺字体提示 | 隐藏 |
| `Global.pdf_theme` | `pdfTheme` | 0 | 0普通/1夜间 | 读取配色方案/日夜切换 |
| `Global.annotTransparencyColor` | `pdfLinkColor` | `#200040FF` | PDF 链接高亮色 | 内部 |
| `Global.inkWidth` / `freeTextSize` | `inkWidth` / `freeTextSize` | 4.0 / 18.0 | 手绘线宽 / 自由文本字号 | 标注栏 |
| `Global.inkColor` / `fillColor` | `inkColor2` / `fillColor` | Radaee 默认 | 手绘色 / 填充色 | 标注栏 |
| `lastAnnotType` | `lastAnnotType` | 0 | 上次用的标注工具 | 内部 |
| `djvu_smooth` / `cbz_smooth` | `djvu_smooth` / `cbz_smooth` | true | 抗锯齿/平滑缩放 | PDF 选项 |
| `flip_pdf` | `flip_pdf` | 0 | PDF 翻页动画 | PDF 选项（见排版分区） |
| `galleryShowStatusbar` | `galleryShowStatusbar` | true | 画廊小状态栏 | 画廊选项 |
| `galleryWhiteBackground` | `galleryWhiteBackground` | false | 画廊白底 | 画廊顶栏 |
| `galleryBrightnessValue` | `galleryBrightnessValue` | -100（自动） | 画廊亮度 | 画廊选项 |
| `gallerySlideshowInterval` | `gallerySlideshowInterval` | 3（秒） | 幻灯片间隔 | 画廊选项 |
| `keepScreenAwakePic` | `keepScreenAwakePic` | false | 画廊常亮 | 画廊选项 |
| `fitImageToScreen` | `fitImageToScreen` | false | 书内图片放大到屏宽 | 杂项 · 图片相关选项 |
| `longTapImageFullScreen` | `longTapImageFullScreen` | true | 长按图片全屏 | 同上 |
| `imageWhiteTransparent` | `imageWhiteTransparent` | false | 白底转透明 | 同上 |
| `mult_touch` | `mult_touch` | false | 多点触控（缩放字体等） | 控制选项 |
| `speedReadWPM/Size/Words` | 同名 | 200/30/1 | 速读（不在本区） | 速读 |
| 记住密码 | prefs `pdf`: `<路径>u`/`<路径>s` | 无 | PDF 密码（加密）/是否保存 | 密码对话框 |
| `cbz_progress` | prefs `cbz_progress[包路径]` | 第一张图 | 图包上次浏览图片 | 画廊 |

---

## 4. 关键算法与数据格式

### 4.1 TXT 编码检测（伪代码）

```text
detectEncoding(file):
  enc = prefs[file_encoding][file]                      # 每文件覆盖
  if enc is None or enc == "AUTO":
    if A.textEncode == "AUTO":
      enc = bomOrHtml(file)          # FF FE→UTF-16LE; FE FF→UTF-16BE; EF BB BF→UTF-8;
                                     # HTML 且头 4096 字符(UTF-8 解)含 charset=UTF-8 → UTF-8
      if enc == "":
        if country == "CN":              enc = "GB2312"
        elif country in {"TW","HK"}:     enc = "BIG5"
        else:
          enc = "UTF-8"
          if (lang=="ja" or country=="JP" or lang in {"ru","uk"}) and fffdCount(file, "UTF-8", 1024) > 5:
              enc = "SHIFT-JIS" if japanese else "Windows-1251"
    else: enc = A.textEncode
  if UI == zh:
      if score(file, enc) != 0: return enc
      best = detectChinese(file)  # 评分 UTF-8, UTF-16LE, GBK, BIG5；全等→""；并列优先 UTF-8>UTF-16LE>GBK>BIG5
      return enc if best == "" else best
  if UI == ko:
      if fffdCount(file, enc, 1024) > 5:
          if enc == "EUC-KR": return "UTF-8" if fffdCount(file,"UTF-8",1024) < 3 else enc     # 原码此分支有逻辑瑕疵，见第 6 节
          elif fffdCount(file, "EUC-KR", 1024) < 3: return "EUC-KR"
  return enc

score(file, enc):   # 头 4096 字符
  s = ("的" in t) + ("了" in t) + (("是" in t) if enc != "UTF-16LE") + ("在" in t)
```
> Web 实现请改为：BOM → UTF-8 严格校验 → 在 {gb18030, big5, shift_jis, euc-kr, windows-1251, …} 里按 `U+FFFD` 率与常用字命中率打分，**与 UI 语言解耦**。

### 4.2 TXT 自动分章

**总体**（A.getTxtChapters，A.java:6721）：

```text
chapters = detectByKeyword()
if UI is Chinese:
    c2 = detectByLineFeatures()
    if len(c2) > len(chapters): chapters = c2
else if len(chapters) > 10:
    avg = floor(sum(len(c.titleTrim)) / len(chapters))
    limit = (avg >= 10 ? avg : 10) * 2
    chapters = [c for c in chapters if len(c.titleTrim) <= limit]
```

**A. 关键字法 `getTxtChapters1`**（A.java:6780–7290）：

```text
K = "第"            if textCJK or isAsiaLanguage
    "Глава"         elif isRussian
    "chapter"       else                       # 非 CJK 时文本整体 lower() 后再找
maxLen = 80 if isAsiaLanguage else 100
PRE = { U+3000, U+00A0, ' ', '\t', '\n', '\r', '#', U+3010('【') }
for block i, each occurrence p of K:
    prev = block[i][p-1]  (p==0 时取上一块最后一个字符；文件最开头视为通过)
    if prev not in PRE: continue
    line = 含该 K 的整行（上一个 '\n' 之后到下一个 '\n'，可跨块）；len(line) < 3 → skip
    title = trimChapterTitle1(line)
    ok = (textCJK or isChinese) ? chapterLengthOk(title) && chineseChapterTagOk(title)
                                : (len(title) < maxLen and title.lower().indexOf(K) < len(title)/4)
    if ok and title != lastTitle:
        if chapters and (pos - chapters[-1].position) < 100: chapters.pop()     # removeTooCloseChapter
        chapters.append({title, position: priorLen(i) + p})

trimChapterTitle1(s):  s.replace(U+3000→' ', '\t'→' '); 当长度>3 时去掉开头的 ' '/NBSP/'\n'/'\r'；
                       若首个 '\n' 下标>3 则截断到它；trim()
chapterLengthOk(t):    len<3 → F；len<40 → T；len<80 且以 ']' ')' '）' 结尾 → T；否则 F
chineseChapterTagOk(t): i = t.indexOf("第")
    if len(t) > 18: sp = t.indexOf(' '); if sp == -1 or sp - i > 15: return False
    return i != -1 and any(hasTag(t, i, tag) for tag in ["卷","章","回","集","話","節","节","折"])
hasTag(t, i, tag): j = t.indexOf(tag, i); if j != -1: k = t.lastIndexOf("第", j); if k > i: i = k
                   return j > i and j - i < 9
trimChapterTitle2(t) → chapter_trim: 若不是以 '#' 开头并以 '#' 结尾：依次对 [] () （） 调 deleteChapterComment
                       (若 indexOf(open) > 3 且 indexOf(close) > indexOf(open)+5 则截到 open 之前)；
                       indentParagraph 时 ' +'→' '；trim()
```

**B. 行特征法 `getTxtChapters2`**（A.java:7290–7710，仅中文 UI；jadx 还原有条件极性噪声，以下为**语义级**概述，实现时需用样本校准）：

```text
sample = txts[1] if len(txts) > 1 else txts[0]
isTxtDoubleBreak(sample)                # 填充 txtDoubleBreak / txthasIndent
maxLine = 80 if "###" in sample else 40
NUM = "一二三四五六七八九十零〇" ∪ "0-9"                # isChapterNumber
four candidate pools: P1(数字序号), P2(数字/中文数字前缀), P3(孤立短行), P4(##…## 标记)
for each line (跨块拼接上一块末尾的残行), L = 行长:
    要求 1 ≤ L ≤ maxLine（L==1 时必须是 NUM 之一）
    tail = 去掉尾部 '\r'、' ' 后的最后一个字符
    markerLike = 行长≤6 且 以 "##" 开头、以 "##" 结尾                     # → P4
    titleLike  = markerLike or (tail 存在 and ( isEndChapterChar(tail) or (hasIndent and 行首非空白/Tab/U+3000) ))
               # isEndChapterChar(c) = c != '\n' and 类别(c) != OTHER_PUNCTUATION(24)  → 行不以 。，！？… 等标点结尾
    if not titleLike: continue
    first = 行内第一个不属于 PRE 集(U+3000/NBSP/空格/Tab/换行/#/【) 的字符; isNum = isChapterNumber(first)
    title = trimChapterTitle1(line)
    if markerLike:                      P4.add
    elif poolDigitsMode and title[0] in '0-9':        # 仅前若干块内启用
         要求 与 P1 末项的数字 a < b 且 b - a < 10（或 P1 为空）→ P1.add（间距<100 字符则替换上一个）
    elif poolPrefixMode:
         n = title 开头连续「其它字母(Unicode OTHER_LETTER)或〇」的个数
         if n < 4 and (n == 0 or isChapterNumber(title[n-1])): P2.add   # 如 "一、"/"十二 "/"001 "
    if poolShortLineMode and len(line) < 20 and not isNum 分支已收录
       and (hasIndent and 非缩进行  or  isEndChapterChar2(tail))        # tail 为 OTHER_LETTER/Tab/'】'/'）'/'#'
       and 该行前后均为空行（endsWithBreak 判定；双换行书需再向后多看一层）
       and 与 P3 末项间距 ≥ 200: P3.add
扫描提前结束条件：各池在前 100/300 块内仍为空则关闭该池；四池都关闭时 break。
选择（反编译顺序）：best = P1 ; if len(P1)>10 and len(P1)<=len(P2): best = P2
                    if len(best) < 4 and len(P3) > 4: best = P3
                    if len(P4) > 20 and len(P4) > len(best) (极性存疑): best = P4
                    if len(best) < 4: best = []
```
**特征词**：`isChapterNumber`=一二三四五六七八九十零〇 + 0–9（**不含 百/千/万**）；`isEndChapterChar2`=OTHER_LETTER/`\t`/`】`/`）`/`#`；`isPreChapterTag`=U+3000/U+00A0/空格/Tab/`\n`/`\r`/`#`/`【`。

**显示位置**：`TxTChapter.getDisplayPosition`(A.java:1155)：在显示文本块里搜索 `trimChapterTitle3(chapter)`（即显示变换后的标题）重新定位，找不到则取块末-100；与 `position`（原文偏移）并存。

### 4.3 TXT 块模型与位置换算

```text
raw     = 解码后整本字符串（保留 \r）
blocks  = raw 每 B 字符一块，B = 2048(手机) / 4096(平板)          # A.txts
disp(b) = trim?/indent? 变换后的块(换行已规整为 \n)               # A.txts2 (懒生成)
lastPosition  = 原文偏移（跨「去空白/缩进」开关稳定）
getTxtRealPos(displayOffsetInView):  视图里只加载相邻 3 块，偏移按「相邻块 raw/disp 长度差」线性补偿
getTxtChapterId(pos, ...):   在 chapters 里以 position 二分/邻近扫描（±300 字符容差，trim/indent 开启时 300，否则 100）
```
> Web：建议显式维护「显示偏移 ↔ 原文偏移」分段映射表，不依赖「仅邻块补偿」。

### 4.4 标注位置模型与数据格式

#### 4.4.1 位置三元组（`NoteInfo` 与 `A.Bookmark` 通用）

| 书类型 | `lastChapter` | `lastSplitIndex` | `lastPosition` | `highlightLength` |
|---|---|---|---|---|
| TXT(0) | `A.lastChapter`（实际恒 0，存疑） | `A.lastSplitIndex`（0） | **原文字符偏移**（`getTxtRealPos(hStart)`） | `hEnd-hStart`（显示长度） |
| HTML(1) | 0 | splitHtml 段号 | 该段 Spanned 内偏移 | 同左 |
| 章节书(100) | 章节序号 | 章内拆分段号（章>`maxHtmlChapterSize` 才>0） | **章（段）排版文本偏移**（含 U+FFFC 图片占位等） | 同左 |
| PDF 页面模式 | `Page.note_start`（页内起始字符序号） | `Page.note_end`（结束序号） | **页号**（0 基） | `end-start` |
| PDF 重排模式 | 页号（`A.lastPosition`） | **-1**（判别标志） | 重排文本内偏移 | 同左 |
| 书签行 | 同上 | 同上 | 同上 | **书签颜色**（0=无色）；`bookmark`=名称 |

- `getPreHighlight(offset)`（A.java:5986）：`splitIndex==-1`→按「页=lastChapter」与偏移区间命中；否则按 `(chapter, split)` 相等 + 区间 `[lastPosition, +highlightLength]` 命中。
- 位置**脆弱点**：章节书偏移依赖排版文本（CSS 开关、章末提示、图片占位会改变），故 `A.fixIndentBookmarkPos` 用书签名里的 8 字符文本就近重定位。

#### 4.4.2 `notes` 表（SQLite `mrbooks.db`，版本 7，BookDb.java:28–33）

```sql
create table notes (_id integer primary key autoincrement,
  book text, filename text, lowerFilename text,
  lastChapter NUMERIC, lastSplitIndex NUMERIC, lastPosition NUMERIC,
  highlightLength NUMERIC, highlightColor NUMERIC, time NUMERIC,
  bookmark text, note text, original text,
  underline NUMERIC, strikethrough NUMERIC, bak text);   -- bak="1" 表示波浪线(squiggly)，否则 "0"
-- 逻辑唯一键：(lowerFilename, lastChapter, lastSplitIndex, lastPosition)；书签另加 bookmark<>''
```
同库还有 `books`、`statistics(filename, usedTime, readWords, dates)`、`covers2`、`tmpbooks`（书架分区）。

#### 4.4.3 `.mrexpt` 文本格式（导出/导入/云同步标注共用）

```text
<原书文件字节数>
indent:<true|false>              # 导出时的 indentParagraph
trim:<true|false>                # 导出时的 trimBlankSpace
#                                # 每条记录以单独一行 "#" 开头，后跟 16 行（notes 表全部列，顺序同 DDL；文本里的 \n 换成 <BR>）
<_id>
<book>
<filename>
<lowerFilename>
<lastChapter>
<lastSplitIndex>
<lastPosition>
<highlightLength>
<highlightColor>                 # 有符号 int ARGB
<time>
<bookmark>
<note>
<original>
<underline>                      # 0/1
<strikethrough>                  # 0/1
<bak>                            # "1"=squiggly；墓碑记录为 "*DELETED*"
...重复
```
- 墓碑（`deletedNotesToText`）：`#`,`0`,`0`,`0`,`0`,章,split,位置,`0`,`0`,时间,书签名,笔记,`0`,`0`,`0`,`*DELETED*`。
- 导入：与书文件大小差 >100000 → 拒绝；对每条记录按 (章,split,位置[,是书签]) 查已有：已有且（墓碑 或 内容不同）→ 先删除；非墓碑 → `confirmNoteNotExistAgain` 后插入。
- **兼容提示**：偏移只在「同样的格式化设置(indent/trim)+同样的排版管线」下有意义；Web 导入应以 `original` 文本在目标章内**重新定位**。

#### 4.4.4 PDF 注释同步串（`#A*#` 格式）

```text
<页数>#A*#<页号>#A1#<时间戳ms>#A2#<起始字符序号>#A3#<结束字符序号>#A4#<颜色int>#A5#<类型>#A6#<笔记文字>#A7#<选中原文>[#A8#<书签名>]#A@#
...可重复多段
类型：0 高亮 / 1 下划线 / 2 删除线 / 3 波浪线（写入 Radaee 时 3 映射为 4）
```
- 首段前的页数必须等于本地 PDF 页数，否则整体拒绝导入；书签用 `#A8#` 非空表示（颜色放 `#A4#`，页放 `#A*#`）；`PDFupdateNotesToFile` 只把**时间戳 > PDF 文件 lastModified** 的标注写回文件（按页 `AddAnnotMarkup` + `SetPopupText`）。

#### 4.4.5 其它小文件/偏好格式

| 名称 | 格式 |
|---|---|
| `xml_files_folder/select_bar` | 每行 `索引*true\|false`；PROCESS_TEXT 应用行 `#<Activity类名>*true`；少于 11 个不同索引视为无效，恢复默认 |
| `xml_files_folder/tts_filter` | 每行 `原文#->#替换`（`indexOf("#->#")>0`） |
| `xml_files_folder/dict.intent0/1` | 4 行：包名、类名、标签、类型(0 SEARCH/1 SEND/2 PROCESS_TEXT) |
| prefs `DICT_HISTORY_FILE` | key=查过的词，value="" |
| prefs `<lastFile.hashCode()>_highlight` | key=词，value=`样式\|颜色int` |
| prefs `file_encoding` | key=路径，value=编码名 |
| prefs `cbz_progress` | key=包路径，value=最后浏览图片名 |
| prefs `isFootnoteEpub` | key=文件名，value=是否「脚注书」 |
| prefs `pdf_toc_failed`/`pdf_words_failed` | key=路径，崩溃保护标记 |

#### 4.4.6 建议的 Web 侧数据模型（不兼容但更稳）

```jsonc
Annotation {
  "id": "uuid", "bookId": "...", "kind": "highlight" | "note" | "bookmark",
  "style": 0,                       // 0高亮 1下划线 2删除线 3波浪线
  "color": "#7700AAFF",             // 8 位十六进制（含 alpha），书签可为 null
  "text": "选中原文(未做简繁转换)",
  "note": "…", "bookmarkName": "(12.3%) 页首文本...",
  "anchor": {
    "fmt": "txt" | "chapter" | "pdf" | "comic",
    // txt:     { start, end }                          解码后原文 UTF-16 偏移（与 Moon+ 同义）
    // chapter: { section, start, end, cfi?, quote:{prefix,exact,suffix} }   章内纯文本偏移 + CFI + W3C TextQuote
    // pdf:     { page, charStart, charEnd, rects?[] }
    // comic:   { page }
  },
  "createdAt": 0, "updatedAt": 0, "deleted": false      // 墓碑便于多端合并(对应 *DELETED*)
}
```
- 重新渲染/换字号/开关 CSS 后用 `quote` 做模糊重定位；`pdf` 用 `rects` 兜底；`.mrexpt` 导入时填 `fmt` 与 `quote.exact`（=`original`），偏移仅作提示。
- 书签唯一键 `(bookId, anchor起点)`，高亮唯一键同 Moon+（同位置只一条）。

### 4.5 UMD 二进制结构（`Umd.UMDDecoder.decode`，Umd.java:30–330）

```text
u32LE  magic = 0xDE9A9B89            # 读成有符号 int = -560292983
repeat:
  b = u8
  if b == 0x23 ('#'):                # 元数据/索引段
     tag = u16LE
     0x01: skip 2; u8 必须==1(文本型UMD，否则报「不是文本 umd」); skip 2
     0x02 标题 / 0x03 作者 / 0x04 年 / 0x05 月 / 0x06 日 / 0x07 性别(分类) / 0x08 出版商 / 0x09 发行商:
           skip 1; len = u8; 字符串 = UTF-16LE，共 (len-5)/2 个字符
     0x0A: skip 2; u32LE contentId
     0x0B: skip 2; u32LE contentLength(字节)  → 字符数 = /2
     0x0C: skip 2; u32LE fileSize ; **到此结束头部循环**
     0x81: skip 2; u32 id; skip 1; u32LE L; skip floor((L-9)/4)*4       # 分块偏移表，忽略
     0x82: skip 3; u32 id; skip 1; u32LE L; 读 L-9 字节 = 封面 JPG
     0x83: skip 2; u32 id; skip 1; u32LE L; n=(L-9)/4; offsets[i]=u32LE/2   # 各章起始(字符)
     0x84: skip 2; u32 id; skip 1; u32LE L; skip u32; 对每章: len=u8; 标题=UTF-16LE len/2 字符
     0x87: skip 4; u32 id; skip 1; u32LE L; skip L-9
     0xF1: skip 2; skip 16
     其它: 结束
  if b == 0x24 ('$'):                # 正文块
     skip u32 (块标识); L = u32LE; data = L-9 字节 zlib 压缩; inflate → UTF-16LE 文本; 去掉末尾 NUL; 追加到总文本
章 i 文本 = 总文本[offsets[i] : offsets[i+1]]（最后一章到末尾；offset 超出总长则空）；  → \n
```
> 注：Moon+ 解压缓冲为 `压缩长度×2`，压缩比>2 的块可能被截断（存疑）；Web 应流式 inflate 到结束。

### 4.6 章节书拼装与 EPUB 要点（伪代码）

```text
toc = parse(NCX or nav)             # 两者条数不同取多的
if toc empty: toc = spine 顺序，章名="1","2",…
if len(toc)==1: 尝试在首 40000/末 10000 字符里按 href="#id" 链接表切章（>3 个才采用）
for each toc[i] 对应 spine 区间 [a_i, a_{i+1}):
    chapter.text = 文件 a_i（若有 #id 则取到下一个 id 之前）
    + 区间内其余 spine 文件按序拼接（相隔>3 个则延迟加载，先放占位 #MORE#_i|j）
首个 toc 项之前的 spine 内容 → 插入「书名」章作为第 0 章
chapter 文本空(<200字符且无图) → <center><h2>章名</h2></center>
chapter 只含一张图(<600字符) → 全屏图
```

### 4.7 TTS 分句正则（`A.getTtsLines`）

```text
tts_divide = 0  逗号级: \(|\)|：|:|,|;|!|\. |\?|，|。|；|？|！|\t|\n|\r
tts_divide = 1  句号级: ;|!|\. |\?|。|；|？|！|\t|\n|\r          ← 默认；后台连续朗读(章节书)强制用它
tts_divide = 2  整段  : \n|\r
tts_divide = 3  整页  : 不切（整段文本一句；不高亮单句）
预处理: "Mr."→占位  "Mrs."→占位  "Dr."→占位（切完还原）；整页前先截掉章末提示及其后文本
每段修剪: 前缀去 [　 ,.;?:!，。；：？、！\t\n\r"“”'(){}[]「」『』] 之一；后缀去 [　 ”\t\n\r ,.;:(){}[]「」『』，。；"“”'（）] 之一；
          若修剪后紧邻原文的 ,.;，。；?？!！ 则计入 end
过滤: TtsLine.isAvialable(): end>start 且 (len>1 或 (len==1 且非 U+FFFC 且非 PUNCTUATIONS))
内容过滤: 先 Ruby 读音替换 → ttsFilters 顺序替换 → 「」→" ,’‘→空格, 换行→空格, 去首尾引号 → 含章末提示/HR 的整句清空
```

### 4.8 搜索摘要算法（`PrefSearch.getSentence`）

```text
pl = 亚洲手机30 / 亚洲平板60 / 其他手机60 / 其他平板100
excerpt = text[max(0,s-pl) : min(len,e+pl)]，命中处加粗(中文 UI 红色)
getSentence(excerpt, 命中起点偏移i, 命中后剩余长度i2):
   a = 第一个标点位置(punc=",.;?\"':(){}[]!，。；＂”“：？（）、！\n")；若 a==-1 或 a>i-10 → 第一个空格；仍不满足 → i<15 ? 0 : i-15
   b = 最后一个标点；若 b==-1 或 b-i2<10 → 最后一个空格；仍不满足 → (len-i2<15 ? len : i2+15)
   return "..." + excerpt[a:b].replace("\n　*","").replace("\n|\t","").trim() + "..."
结果尾部: <font color=#0000FF>(进度%)</font>  或 PDF: [页/总页]
```

### 4.9 书签名生成（`generateBookmarkName`）

```text
n = isChinese ? 60 : 100
文本书: s = 从当前页首行起始偏移取 n 个字符；若 len>=n：在 s 里按最后一个空格截断（若尾部不足 8 字符）；
        不足 n：取到文末；若全文<3 字符则用当前日期时间
PDF: s = 当前页重排文本前 n 字符，空则用页码
name = "(" + 进度% + ") " + s.replace("\n"," ").replace(U+3000," ").trim() + "..."
```

### 4.10 青空文库 Ruby 解析（`JpRubyTxt`）

```text
for 每个 "《...》": 读音 rt = 括号内容（长度 2..11 不含括号即 len(rt)∈[1,10]；否则当普通文本）
    底文 = 《前连续 CJK_UNIFIED_IDEOGRAPHS 最多 len(rt) 个字符（遇到非汉字即止）
    输出 Ruby{rt, 底文, start, end}（《…》被删除）；与上一 Ruby 紧邻时按 rt 与 底文*2 的长度差补空格/U+3000 防重叠
图片: 「（xxx.jpg）」可被 ［＃…］ 包裹(<100 字符内) → TXT 同目录找 xxx.jpg → 居中内嵌图（独占一行）
```

### 4.11 其它格式细节

- **分享文本**：见 ANNO-010。
- **HTML 拆分**：`createSplitHtmls`（A.java:2608）见 FMT-006。
- **文件名元数据**：`name = filenameWithoutExt.split(" - ")[0]`，`author = filenameWithoutExt` 在第一个 `" - "` 之后（要求后缀长度>3）。

---

## 5. 界面结构

### 5.1 选择工具条（长按选词后）

```
[ 选区高亮（半透明蓝）+ 起止拖动手柄(dot1/dot2) + 放大镜(手指上方) ]
┌ 颜色快速选择模板(可选，showColorTemplate) ─────────────┐
│ 上行：[高亮][下划线][删除线][波浪线][提示 ⓘ]               │
│ 下行：[色1][色2][色3][色4][色5]（长按改色）               │
└──────────────────────────────────────────────────────────┘
┌ 选择工具条 HighlightBar ─────────────────────────────────┐
│ [拷贝] [高亮] [标注] [词典]  [笔图标(PDF)] [⋯ 更多]        │   ← 前4个槽位=选择条设置里排在前面的4个已勾选项
└──────────────────────────────────────────────────────────┘
  「⋯」菜单：朗读(Pro) / 分享 / 搜索 / 翻译 / 维基百科 / 网络搜索 / 生词本 / <PROCESS_TEXT 应用> / 设置...
  长按「高亮」=按上次样式直接高亮；长按「词典」=词典2
高亮对话框（点「高亮」）：
  ○高亮 ■色 ○下划线 ■色 ○删除线 ■色 ○波浪线 ■色
  [最近色1][最近色2][最近色3]
  ☐使用最后标注类型来高亮文字 ☐允许长按+拖动直接标注 ☐启用放大镜 ☐显示颜色模板
  ☐高亮显示本书所有的"xxx"
  [确定] [取消 / 删除(已有标注)]
标注对话框(PrefEditNote)：多行输入 + [保存][取消|删除][颜色(已有标注)]
点击已有批注标记 → 气泡(PopupNoteLay)显示批注文字
```

### 5.2 目录面板（左滑出 85% 宽）

```
顶栏: [←返回] [排序↕(倒序)] [🗑删除(多选时)]
Tabs: 「目录」 | 「书签」(含 标注/高亮) | 「图片」(仅有图片时)
目录页: 当前章「章名 (n/N)」        [展开/折叠全部]
        ├ ▶ 第一卷（粗体，可展开）
        │   ├ 第一章 xxx            (PDF: 右侧页码)
        │   └ 第二章 yyy  √(当前)
书签页顶栏: [🔍搜索][🔖书签][📝标注][🖍高亮][🎨颜色][⬆导出][⚙选项]
   列表项(平板双列卡片): [图标] 正文(原文带样式色/书签名)   ⋮菜单
                                 批注文字
                                 2026-05-01 10:20
   底部: [增加新书签]（长按=不命名直接加）；空状态「尚无书签…」
   多选: 长按进入，右上「删除」
导出弹窗: 分享高亮与备注(TXT) / 分享高亮与备注(封面) / 导出到文件 / 从文件导入
图片页: 缩略图列表，点击定位，长按进画廊
```

### 5.3 搜索

```
全屏对话框「搜索」: [输入框(支持正则)] [搜索🔍] [历史🕘] [选项⚙]   进度圈(点=取消)
   标题「搜索结果: N」；列表(摘要，命中加粗红，尾部蓝色进度%)
   选项: ☐区分大小写 ☐单词模式 ☐只搜已读(向后) ☐只搜未读(向前)  提示「(支持正则表达式)」
阅读界面下方「搜索导航面板」: [≡列表] [上一个] i/N [下一个] [⮌返回] [✕关闭]
全文关键词持续高亮
```

### 5.4 TTS 面板与选项

```
TTS 面板(底部浮层):
   音量 ──●──   音调 ──●──   语速 ──●──        [重置:(速度/音调≠10时)]   [倒计时 mm:ss]
   [⏮上一页][◀上一句][▶/⏸][▶下一句][⏭下一页][⏹停止]  [⚙系统TTS设置][⋯更多]
TTS 选项对话框(开始朗读前): 内容划分[逗号|句号|整段|整页] ⚙  ☐自动停止朗读 [10]分钟  ☐不再询问  [开始朗读]
TTS 更多选项: 划分方式 / ☐朗读前显示选项对话框 / ☐自动停止+分钟 / ☐朗读间隔+毫秒 /
              ☐停止使用AudioFocus(允许后台) / 电池优化提示 / [朗读字符过滤…]
朗读按钮长按: 开始朗读 / 开始朗读(N分钟) / 朗读剪贴板文本
```

### 5.5 词典设置与查词

```
自定义词典设置: [选择条按钮可拖拽排序+勾选列表(前4项锁定)]
   词典1(单击词典按键) [下拉]    词典2(长按词典按键) [下拉]      谷歌翻译: 源语言 [下拉] 目标语言 [下拉]
   ☐选词后立即打开词典  ☐单字查词(亚洲语言)   [确定][取消]
   选「自定义在线词典...」→ 输入模板(%s)；选「其它已安装应用」→ 应用选择器
查词: 选区 →(词典按钮)→ 打开词典1；(长按)→ 词典2；(翻译)→ translate.google.com；(生词本)→ 历史列表
```

### 5.6 PDF / 漫画 / 画廊

```
PDF 顶栏(可见时): [← ] 书名 [文本重排] [标注(Pro)] [⋯]；底栏: 进度滑块+页码；可选缩略图条；右下角🔒锁定图标
PDF 选项: 视图[自动|单页|连续]三图示 / 渲染质量[高|中|低] / 页边颜色 / ☐统一页面尺寸 / ☐底部缩略图 /
          ☐进度栏文本重排按钮 / ☐进度栏标注按钮 / 翻页动画+速度+重置 / 读取配色方案 / [控制选项][其它选项]
PDF 标注栏: [便笺][自由文本][手绘][直线][箭头][矩形][椭圆][取消]   属性: [取消][粗细][颜色][填充色][便笺文字]
CBZ/CBR 选项: 视图 / ☐字体抗锯齿 / 页边颜色 / 翻页动画
图片画廊: 顶栏[返回][N/总][GIF][分享][日夜][幻灯片▶][选项]；主体 ViewPager(双击 1→1.75→3→1)；底部缩略图条
```

---

## 6. 存疑与未确认点

1. **TXT 行特征法（`getTxtChapters2`）条件极性**：jadx 对 `A.getTxtChapters2`（A.java:7290–8030）输出存在 `break; break;`、被提升的 `if` 与重复块，部分布尔条件极性无法确认（例如「候选行判定 `length2 <= i`」「4 个候选池的启用/终止条件 `z2/z3/z4/z`」「最终选择里 `arrayList7.size() > arrayList2.size() || ≤20`」）。第 4.2 节为**语义级**还原；落地前需用真实小说样本（含 `第X章`、`一、`、`001`、`Chapter 1`、`## 标题`、无章节短篇）回归，必要时回到字节码或动态抓取验证。
2. **`isTxtDoubleBreak` 里 `txthasIndent` 极性**：反编译为「`z2=true` 初值，`if (i3 > i2/i5) z2=false`」，与变量名相反；分章算法以 `txthasIndent && 行首非空白` 作为「非缩进行=标题」的依据，推测语义应为「全书存在段首缩进」。
3. **TXT 的 `lastChapter/lastSplitIndex`** 是否恒为 0/0，未逐路径确认（`A.lastChapter` 在 TXT 中未见赋值非零）。
4. **`getTxtChapters1` 的行提取**：反编译产物里 `substring(i4, iIndexOf3)` 的起点 `i4` 恒为 0（明显被化简破坏），语义按「所在行」还原；是否包含关键字前行内更早的文本（行首到 `第` 之间）未验证（`isPreCharOK` 仅要求前一字符是空白/`#`/`【`，实务上通常是行首）。
5. **韩语编码分支**（`detectKoreanEncode`）里 `if (str2.equals("EUC-KR")) { if (!str2.equals("UTF-8") && …UTF-8…<3) return "UTF-8" }` 条件冗余/可能笔误，行为仅对韩语 UI 生效。
6. **搜索输入的正则异常**：`Pattern.compile` 抛异常时，`startSearch` 线程里 catch 并仅记录日志，界面是否复位（输入框是否保持禁用）未确认。
7. **zh `dict_list` 与 `dict_list_url` 条数不一致**（11 vs 8）：中文版词典下拉的若干项（深蓝/欧路/MDict/…）与 `openDictUrl` 的标识映射关系需运行时核对；已知 `dict_list_url` 中文：ColorDict3, youdao, Merriam, Oxford, Dictionray.com, baidu URL, dict.cn URL, Customized。
8. **PDF 暗色（`pdf_theme=1`）的具体渲染**：由 Radaee 原生库完成（反色/暗化未见 Java 侧实现），Web 以 CSS 反色近似。
9. **漫画阅读方向/双页**：Radaee `Global.rtol` 存在但 Moon+ 界面未找到开关；`PDFSetView` 的模式 3/4/6（双页）在 `PrefPdf` 里 `dualPageB` 被隐藏。Moon+ 是否通过「控制选项」「翻页方向」间接支持日漫 RTL 未确认——Web 版应作为新增功能。
10. **CBZ/CBR 页面排序**：`CDocument`（Radaee 原生）内部排序规则未知；画廊路径是字典序（会 `10<2`）。
11. **DJVU 标注细节**：`djvuDoHighlight2` 的持久化位置模型（DJVU 页内字符序号 vs DB 列映射）未逐行核对，按 PDF 类推。
12. **Pro 限制范围**：已确认 Pro 限定：TTS（`do_speak`）、名字替换（`do_names_replacement`）、PDF 标注（`pdfInitAnnotButtons`/`hPen`）、`pdf_annot_button` 默认值；高亮/书签/搜索未见限制。Web 版是否沿用 Pro 概念由产品决定。
13. **标注 `original` 是否存转换后文本**：高亮时取 `selectedText`（来自已经 `chineseJianFanConvert` 的显示文本），故开启简繁转换时存的是**转换后**文本（推断，未做动态验证）。
14. **`getTxtRealPos` 的适用范围**：只使用相邻三个块作线性补偿，跨 trim/indent 差异超出相邻块（极端长段）时可能偏移；`displayPos` 回退逻辑（块末-100）说明作者也遇到过定位失败。
15. **UMD 解压缓冲**（`压缩长度×2`）可能截断高压缩比块，未用真实 UMD 验证。
16. **EPUB 的 `maxHtmlChapterSize` 与 `getMaxHtmlSize`**（`BIG_FILESIZE`/3,000,000）的关系：前者是**渲染拆分**，后者是**加载上限**（超过的章如何处理未跟踪）。
17. **在线词典接口**：原版只做 URL/Intent 跳转，**没有**内置查词 API；Web 版的服务端词典代理、翻译接口属新增设计，需另行选型与合规评估（版权/抓取条款）。
18. **耳机键动作值 19 的含义**：`headsetForSpeaking` 判断 `doHeadsetKey == 19`，但 `R.array.controls`（0–18）里没有第 19 项，推测来自耳机专用动作表（含「朗读」），需在 `PrefControl` 中核对。
19. **源码中未发现的功能**：OCR、划线导出为图片、生词本的释义存储、TTS 声音选择、章节级书签、自定义分章正则、搜索结果导出——原版均无，若需要属新增。
20. **书签角标占位的触发条件**：`ContentLay.drawBookmarks`（ContentLay.java:99）里 `z = A.showBookmarkIcon && activityTxt.dotVisible()`，而 `dotVisible()` 判断的是文本选择手柄 `dot1` 是否可见，与「书签角标常驻/随工具栏出现」的直觉不符，未能在静态代码里确认真实触发时机。
21. **覆盖度声明**：`ActivityTxt`/`A` 体量极大，本报告重点深读了 `selectText`、`doHButtonEvent`、`createBookmark`、TTS 链路、`openDictUrl`、`PrefChapters`、`PrefSearch`、`BookDb`（notes）、`Umd`、`Md/Rtf/Docx/Chm/Fb2/Epub`（元数据/目录/封面/章节拼装）、`PDFReader`（笔记同步串）、`PrefPdf`、`PicGalleryShow`、`ComicInfo`；`CSS.java`(1694 行)、`MyHtml/HtmlToSpannedConverter` 的完整标签/样式映射、`Epub.getCSS`、Radaee 内部手势与 `PDFLayoutView` 细节未逐行阅读。

