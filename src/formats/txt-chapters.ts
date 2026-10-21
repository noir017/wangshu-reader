// TXT 自动分章（FMT-003，spec §4.2）：关键字法 + 行特征法 + 自定义正则。
// 原版由界面语言决定走哪条分支，这里改成按文本内容判断（CJK/俄文占比）；其余语义照原版。
// 纯函数：输入已统一成 \n 的全文，输出章节（标题 + 标题行起始偏移）。

export interface TxtChapter {
  /** 清洗后的标题（chapter_trim） */
  title: string;
  /** 标题行在全文中的起始偏移 */
  pos: number;
}

export interface ChapterOptions {
  mode: 'auto' | 'keyword' | 'line' | 'regex' | 'off';
  regex?: string;
}

export interface ScriptProfile {
  cjk: boolean;
  /** 中文（CJK 且几乎没有假名/谚文）：只有它才跑行特征法 */
  chinese: boolean;
  russian: boolean;
}

/** 按内容判断语言类别（取头部 + 中段样本） */
export function profileText(text: string): ScriptProfile {
  const sample = text.length > 40000 ? text.slice(0, 20000) + text.slice(text.length >> 1, (text.length >> 1) + 20000) : text;
  let han = 0;
  let kana = 0;
  let hangul = 0;
  let cyr = 0;
  let latin = 0;
  for (const ch of sample) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x4e00 && cp <= 0x9fff) han++;
    else if (cp >= 0x3040 && cp <= 0x30ff) kana++;
    else if (cp >= 0xac00 && cp <= 0xd7af) hangul++;
    else if (cp >= 0x0400 && cp <= 0x04ff) cyr++;
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) latin++;
  }
  const letters = han + kana + hangul + cyr + latin || 1;
  const cjkN = han + kana + hangul;
  const cjk = cjkN / letters > 0.3;
  return { cjk, chinese: cjk && kana + hangul < han * 0.05, russian: !cjk && cyr / letters > 0.3 };
}

// ───────────────────────── 公共小函数（对应原版 A.* 同名方法） ─────────────────────────
const PRE_TAG = new Set(['　', ' ', ' ', '\t', '\n', '\r', '#', '【']);
const NUMBER_CHARS = new Set(Array.from('一二三四五六七八九十零〇0123456789'));

/** 章号字符：一二三四五六七八九十零〇 + 0-9（不含 百千万，与原版一致） */
export function isChapterNumber(c: string): boolean {
  return NUMBER_CHARS.has(c);
}

/** trimChapterTitle1：全角空格/制表符变空格，去掉开头空白（长度>3 时），trim */
export function trimChapterTitle1(s: string): string {
  let t = s.replace(/　/g, ' ').replace(/\t/g, ' ');
  if (t.length > 3) t = t.replace(/^[  \n\r]+/, '');
  const nl = t.indexOf('\n');
  if (nl > 3) t = t.slice(0, nl);
  return t.trim();
}

function deleteChapterComment(t: string, open: string, close: string): string {
  const i = t.indexOf(open);
  if (i > 3 && t.indexOf(close) > i + 5) return t.slice(0, i);
  return t;
}

/** trimChapterTitle2（chapter_trim）：删掉标题里位置>3 的 [..] (..) （..） 注释，压缩空格 */
export function trimChapterTitle2(s: string): string {
  let t = s;
  if (!(t.startsWith('#') && t.endsWith('#'))) {
    t = deleteChapterComment(t, '[', ']');
    t = deleteChapterComment(t, '(', ')');
    t = deleteChapterComment(t, '（', '）');
  }
  t = t.replace(/ +/g, ' ').trim();
  return t.length > 200 ? `${t.slice(0, 197)}...` : t;
}

export function chapterLengthOk(t: string): boolean {
  if (t.length < 3) return false;
  if (t.length < 40) return true;
  return t.length < 80 && /[\])）]$/.test(t);
}

function hasChapterTag(t: string, i: number, tag: string): boolean {
  const j = t.indexOf(tag, i);
  let start = i;
  if (j !== -1) {
    const k = t.lastIndexOf('第', j);
    if (k > start) start = k;
  }
  return j > start && j - start < 9;
}

const CN_TAGS = ['卷', '章', '回', '集', '話', '節', '节', '折'];
export function chineseChapterTagOk(t: string): boolean {
  const i = t.indexOf('第');
  if (t.length > 18) {
    const sp = t.indexOf(' ');
    if (sp === -1 || sp - i > 15) return false;
  }
  return i !== -1 && CN_TAGS.some((tag) => hasChapterTag(t, i, tag));
}

// ───────────────────────── 行索引 ─────────────────────────
interface LineIndex {
  starts: number[];
  ends: number[]; // 不含 \n
}

function indexLines(text: string): LineIndex {
  const starts: number[] = [];
  const ends: number[] = [];
  let p = 0;
  const n = text.length;
  while (p <= n) {
    let e = text.indexOf('\n', p);
    if (e < 0) e = n;
    starts.push(p);
    ends.push(e);
    p = e + 1;
    if (e === n) break;
  }
  return { starts, ends };
}

// ───────────────────────── A. 关键字法 getTxtChapters1 ─────────────────────────
function keywordChapters(text: string, prof: ScriptProfile): TxtChapter[] {
  const cjk = prof.cjk;
  const maxLen = cjk ? 80 : 100;
  const re = cjk ? /第/g : prof.russian ? /глава/gi : /chapter/gi;
  const out: (TxtChapter & { raw: string })[] = [];
  let lastTitle = '';
  const n = text.length;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const p = m.index;
    if (p > 0 && !PRE_TAG.has(text[p - 1])) continue;
    let ls = text.lastIndexOf('\n', p - 1) + 1;
    let le = text.indexOf('\n', p);
    if (le < 0) le = n;
    // 比原版严一点：关键字前面必须只有空白/#/【（即位于行首），避免正文里「 第三章 」这类行内提及被当成章节
    const lead = text.slice(ls, p);
    if (/[^\s　 #【]/.test(lead)) {
      re.lastIndex = le;
      continue;
    }
    const line = text.slice(ls, le).replace(/\r$/, '');
    re.lastIndex = le; // 同一行只处理一次
    if (line.length < 3) continue;
    const title = trimChapterTitle1(line);
    const ok = cjk ? chapterLengthOk(title) && chineseChapterTagOk(title) : title.length < maxLen && title.toLowerCase().indexOf(prof.russian ? 'глава' : 'chapter') < title.length / 4;
    if (!ok || title === lastTitle) continue;
    const pos = ls;
    // removeTooCloseChapter：与上一章间距 <100 字符则删掉上一章（目录页里连续列出的章节名只留最后一个）
    if (out.length && pos - out[out.length - 1].pos < 100) out.pop();
    out.push({ title: trimChapterTitle2(title), pos, raw: title });
    lastTitle = title;
  }
  let result: TxtChapter[] = out;
  if (!prof.cjk && result.length > 10) {
    const avg = Math.floor(out.reduce((s, c) => s + c.raw.length, 0) / out.length);
    const limit = (avg >= 10 ? avg : 10) * 2;
    result = out.filter((c) => c.raw.length <= limit);
  }
  return result.map(({ title, pos }) => ({ title, pos }));
}

// ───────────────────────── B. 行特征法 getTxtChapters2（仅中文） ─────────────────────────
const RE_PO = /\p{Po}/u;
const RE_LO = /\p{Lo}/u;
const BLOCK = 2048; // 原版手机端块长，原版用「前 100/300 块内仍为空就关闭该池」限制扫描

function isEndChapterChar(c: string): boolean {
  return c !== '\n' && !RE_PO.test(c);
}
function isEndChapterChar2(c: string): boolean {
  return RE_LO.test(c) || c === '\t' || c === '】' || c === '）' || c === '#';
}

function lineFeatureChapters(text: string): TxtChapter[] {
  const { starts, ends } = indexLines(text);
  const sampleStart = Math.min(text.length, BLOCK);
  const sample = text.slice(sampleStart, sampleStart + BLOCK * 2) || text.slice(0, BLOCK * 2);
  const maxLine = sample.includes('###') ? 80 : 40;

  // isTxtDoubleBreak / 有无缩进：样本里非空行占比
  const sLines = sample.split('\n').filter((l) => l.trim().length > 0);
  const indented = sLines.filter((l) => /^[ \t　 ]/.test(l)).length;
  const hasIndent = sLines.length > 0 && indented > sLines.length / 2;
  const doubleBreak = (sample.match(/\n\s*\n/g)?.length ?? 0) > sLines.length / 4;

  const P1: (TxtChapter & { num: number })[] = [];
  const P2: TxtChapter[] = [];
  const P3: TxtChapter[] = [];
  const P4: TxtChapter[] = [];
  let digitsOn = true;
  let prefixOn = true;
  let shortOn = true;
  let markerOn = true;

  const lineAt = (i: number) => text.slice(starts[i], ends[i]).replace(/\r$/, '');
  const isBlank = (i: number) => i < 0 || i >= starts.length || lineAt(i).trim() === '';

  for (let i = 0; i < starts.length; i++) {
    const pos = starts[i];
    const blk = Math.floor(pos / BLOCK);
    if (blk > 100 && markerOn && P4.length === 0) markerOn = false;
    if (blk > 300) {
      if (P1.length === 0) digitsOn = false;
      if (P2.length === 0) prefixOn = false;
      if (P3.length === 0) shortOn = false;
    }
    if (!digitsOn && !prefixOn && !shortOn && !markerOn) break;

    const raw = lineAt(i);
    const line = raw.replace(/[ \r]+$/, '');
    const L = line.length;
    if (L < 1 || L > maxLine) continue;
    if (L === 1 && !isChapterNumber(line)) continue;

    const tail = line[line.length - 1];
    const markerLike = L <= 6 && line.startsWith('##') && line.endsWith('##');
    const startsIndented = /^[ \t　 ]/.test(raw);
    const titleLike = markerLike || (!!tail && (isEndChapterChar(tail) || (hasIndent && !startsIndented)));
    if (!titleLike) continue;

    let fi = 0;
    while (fi < line.length && PRE_TAG.has(line[fi])) fi++;
    const first = line[fi] ?? '';
    const isNum = isChapterNumber(first);
    const title = trimChapterTitle1(line);
    if (!title) continue;

    if (markerLike) {
      if (markerOn) P4.push({ title: trimChapterTitle2(title), pos });
      continue;
    }
    // 池 1：以阿拉伯数字开头、序号递增的行（1 / 2 / 3 …）
    if (digitsOn && /^[0-9]/.test(title)) {
      const num = parseInt(title, 10);
      const last = P1[P1.length - 1];
      if (!last || (Number.isFinite(num) && last.num < num && num - last.num < 10)) {
        if (last && pos - last.pos < 100) P1.pop();
        P1.push({ title: trimChapterTitle2(title), pos, num });
        continue;
      }
    }
    // 池 2：数字/中文数字前缀（「一、」「十二 」「001 」）
    if (prefixOn) {
      let n = 0;
      while (n < title.length && (RE_LO.test(title[n]) || title[n] === '〇')) n++;
      if (n < 4 && (n === 0 || isChapterNumber(title[n - 1])) && (n > 0 || /^[0-9]/.test(title) || isNum)) {
        const last = P2[P2.length - 1];
        if (last && pos - last.pos < 100) P2.pop();
        P2.push({ title: trimChapterTitle2(title), pos });
        continue;
      }
    }
    // 池 3：前后都是空行的孤立短行（「楔子」「引子」类标题）
    if (shortOn && !isNum && L < 20 && ((hasIndent && !startsIndented) || isEndChapterChar2(tail))) {
      const around = isBlank(i - 1) && isBlank(i + 1) && (!doubleBreak || (isBlank(i - 2) || isBlank(i + 2)));
      const last = P3[P3.length - 1];
      if (around && (!last || pos - last.pos >= 200)) P3.push({ title: trimChapterTitle2(title), pos });
    }
  }

  // 原版这里的条件极性存疑（spec §6.1），语义取「数字序号池与前缀池谁多用谁」
  let best: TxtChapter[] = P2.length > P1.length ? P2 : P1;
  if (best.length < 4 && P3.length > 4) best = P3;
  if (P4.length > 20 && P4.length > best.length) best = P4;
  if (best.length < 4) best = [];
  return best.map(({ title, pos }) => ({ title, pos }));
}

// ───────────────────────── 自定义正则 ─────────────────────────
export function compileChapterRegex(src: string): RegExp | null {
  const s = src.trim();
  if (!s) return null;
  try {
    const m = /^\/(.+)\/([a-z]*)$/s.exec(s);
    return m ? new RegExp(m[1], m[2].replace(/[gy]/g, '')) : new RegExp(s, 'i');
  } catch {
    return null;
  }
}

function regexChapters(text: string, re: RegExp): TxtChapter[] {
  const { starts, ends } = indexLines(text);
  const out: TxtChapter[] = [];
  for (let i = 0; i < starts.length; i++) {
    const len = ends[i] - starts[i];
    if (len === 0 || len > 120) continue;
    const line = text.slice(starts[i], ends[i]).trim();
    if (line && re.test(line)) {
      const pos = starts[i];
      if (out.length && pos - out[out.length - 1].pos < 20) out.pop();
      out.push({ title: trimChapterTitle2(trimChapterTitle1(line)), pos });
    }
  }
  return out;
}

/** 入口（对应 A.getTxtChapters）。返回按 pos 升序的章节；没有或少于阈值返回 [] */
export function detectChapters(text: string, opts: ChapterOptions, prof = profileText(text)): TxtChapter[] {
  if (opts.mode === 'off' || text.length === 0) return [];
  if (opts.mode === 'regex') {
    const re = compileChapterRegex(opts.regex ?? '');
    if (re) return regexChapters(text, re);
    // 正则无效时退回自动
  }
  let chapters: TxtChapter[] = [];
  if (opts.mode !== 'line') chapters = keywordChapters(text, prof);
  if ((opts.mode === 'auto' || opts.mode === 'regex' || opts.mode === 'line') && prof.chinese) {
    const c2 = lineFeatureChapters(text);
    if (opts.mode === 'line' || c2.length > chapters.length) chapters = c2;
  }
  return chapters;
}
