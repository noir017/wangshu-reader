// 自然排序（10 排在 2 之后）、HTML 转义与清洗。
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

export function escapeXml(s: string): string {
  // XML 1.0 不允许大部分控制字符
  // eslint-disable-next-line no-control-regex
  return escapeHtml(s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/g, ''));
}

const ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'i', 'em', 'strong', 'u', 's', 'sub', 'sup', 'small', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'span', 'div', 'blockquote', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'tr', 'td', 'th', 'thead', 'tbody',
]);
const DROP_WITH_CONTENT = /^(script|style|iframe|object|embed|noscript|template|svg|math)$/;
const VOID_TAGS = new Set(['br']);
/** class 白名单：词典卡片自己会给的样式钩子，其余属性一律丢弃 */
const KEEP_CLASS = /^(?:mr-[a-z0-9_-]+)$/;

/**
 * 把不可信的 HTML 片段清洗成只含白名单标签的安全片段：
 * - 标签不在白名单 → 去掉标签保留文字（链接 <a> 因此变成纯文字）；script/style 等连内容一起丢；
 * - 所有属性丢弃（只保留 mr- 开头的 class）；文本里孤立的 < > 一律转义。
 * 不用 DOM 库：先按 <…> 切词再逐个处理，输出里的尖括号只可能来自白名单标签。
 */
export function sanitizeHtml(html: string): string {
  const out: string[] = [];
  const stack: string[] = [];
  let skipUntil: string | null = null;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>|<|>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const text = (s: string) => out.push(s.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  while ((m = re.exec(html))) {
    if (skipUntil === null && m.index > last) text(html.slice(last, m.index));
    else if (skipUntil !== null) {
      /* 被丢弃的内容 */
    }
    last = re.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    if (m[0] === '<' || m[0] === '>') {
      if (skipUntil === null) text(m[0]);
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (skipUntil !== null) {
      if (closing && tag === skipUntil) skipUntil = null;
      continue;
    }
    if (DROP_WITH_CONTENT.test(tag)) {
      if (!closing && !m[3].trim().endsWith('/')) skipUntil = tag;
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (closing) {
      const i = stack.lastIndexOf(tag);
      if (i >= 0) {
        // 补齐中间没闭合的标签，保证输出是良构的
        while (stack.length > i) out.push(`</${stack.pop()}>`);
      }
      continue;
    }
    if (VOID_TAGS.has(tag)) {
      out.push(`<${tag}>`);
      continue;
    }
    const cls = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3]);
    const kept = (cls?.[1] ?? cls?.[2] ?? '')
      .split(/\s+/)
      .filter((c) => KEEP_CLASS.test(c))
      .join(' ');
    out.push(kept ? `<${tag} class="${kept}">` : `<${tag}>`);
    if (!m[3].trim().endsWith('/')) stack.push(tag);
  }
  if (skipUntil === null && last < html.length) text(html.slice(last));
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('');
}

/** HTML → 纯文字（简单版，给词典摘要/UI 用） */
export function htmlToText(html: string): string {
  return sanitizeHtml(html)
    .replace(/<\/(p|div|li|tr|h[1-6])>|<br>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 把长文本按段落/句子边界切成 ≤ max 字符的块；各块直接拼接等于原文（不丢空白），翻译长文用。
 */
export function chunkText(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const win = rest.slice(0, max);
    let cut = win.lastIndexOf('\n\n');
    if (cut < max * 0.3) cut = win.lastIndexOf('\n');
    if (cut < max * 0.3) cut = Math.max(...['。', '！', '？', '!', '?', '. ', '；', ';'].map((d) => win.lastIndexOf(d)));
    if (cut < max * 0.3) cut = win.lastIndexOf(' ');
    if (cut < max * 0.3) cut = max - 1;
    out.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  if (rest) out.push(rest);
  return out;
}
