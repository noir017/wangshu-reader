// 文本小工具：转义、文件名元数据、字数、ISBN、描述清洗
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

/** 去目录、去扩展名（含 .fb2.zip）。ZIP 内路径带 '?' 时取 '?' 之后（压缩包内文件） */
export function baseNameNoExt(fileName: string): string {
  let n = fileName.split('?').pop() ?? fileName;
  n = n.split(/[\\/]/).pop() ?? n;
  n = n.replace(/\.fb2\.zip$/i, '');
  const i = n.lastIndexOf('.');
  return i > 0 ? n.slice(0, i) : n;
}

/** FMT-018：「书名 - 作者」文件名规则（按第一个 " - " 切分） */
export function metaFromFileName(fileName: string): { title: string; authors: string[] } {
  const base = baseNameNoExt(fileName).trim();
  const i = base.indexOf(' - ');
  if (i > 0) {
    const title = base.slice(0, i).trim();
    const author = base.slice(i + 3).trim();
    if (title) return { title, authors: author ? [author] : [] };
  }
  return { title: base, authors: [] };
}

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/gu;
const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

/** FMT-021 字数：CJK/假名/谚文按字，其他按词 */
export function countWords(text: string): number {
  let n = 0;
  const cjk = text.match(CJK_RE);
  if (cjk) n += cjk.length;
  const rest = cjk ? text.replace(CJK_RE, ' ') : text;
  const words = rest.match(WORD_RE);
  if (words) n += words.length;
  return n;
}

/** FMT-022：在 OPF/正文文本里找 ISBN（ISBN 标记后第一个 >…<，只含数字和连字符且 <30 字符；或 urn:isbn:/isbn: 前缀） */
export function extractIsbn(text: string): string | null {
  const m1 = /isbn[^<>]{0,40}>\s*(?:urn:isbn:|isbn:?\s*)?([0-9Xx][0-9Xx\- ]{8,28})\s*</i.exec(text);
  const m2 = /(?:urn:isbn:|isbn[:：]?\s*)([0-9][0-9Xx\- ]{8,28})/i.exec(text);
  const raw = (m1?.[1] ?? m2?.[1])?.trim();
  if (!raw || raw.length >= 30) return null;
  const digits = raw.replace(/[\s-]/g, '');
  return /^(\d{9}[\dXx]|\d{13})$/.test(digits) ? digits.toUpperCase() : null;
}

/** HTML 片段 → 纯文本（简介等），折叠空白 */
export function htmlToPlain(html: string): string {
  if (!html) return '';
  if (!/[<&]/.test(html)) return html.replace(/\s+/g, ' ').trim();
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n')}`, 'text/html');
  return (doc.body.textContent ?? '').replace(/[ \t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** 多个候选取第一个非空 */
export function firstNonEmpty<T extends string>(...xs: (T | null | undefined)[]): T | undefined {
  for (const x of xs) if (x && x.trim()) return x;
  return undefined;
}
