// 书内 CSS 改写：url() 与 @import 里的相对路径改成 blob:/data:，远程资源一律丢弃（不让书悄悄联网）。
export interface CssEnv {
  /** 相对引用 → blob:/data: URL；null = 资源不存在 */
  resolveUrl: (ref: string) => Promise<string | null>;
  /** 读取并（递归）处理被 @import 的样式表，返回处理后的文本；null = 忽略 */
  importCss?: (ref: string, depth: number) => Promise<string | null>;
}

const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s][^)]*?))\s*\)/gi;
const IMPORT_RE = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s][^)]*?))\s*\)|"([^"]*)"|'([^']*)')\s*([^;{]*);?/gi;
const EMPTY_URL = 'url("data:,")';

const isRemote = (ref: string) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(ref) || /^(?:https?|ftp|file):/i.test(ref);
const isInline = (ref: string) => /^(?:data|blob):/i.test(ref) || ref.startsWith('#');

async function replaceAsync(src: string, re: RegExp, fn: (m: RegExpExecArray) => Promise<string>): Promise<string> {
  const matches: { m: RegExpExecArray; out: Promise<string> }[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) matches.push({ m, out: fn(m) });
  if (!matches.length) return src;
  let out = '';
  let last = 0;
  for (const { m, out: p } of matches) {
    out += src.slice(last, m.index) + (await p);
    last = m.index + m[0].length;
  }
  return out + src.slice(last);
}

export async function rewriteCss(css: string, env: CssEnv, depth = 0): Promise<string> {
  let text = css.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // @import 先处理：内联被引用样式（深度 ≤ 3，防循环引用）
  text = await replaceAsync(text, IMPORT_RE, async (m) => {
    const ref = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').trim();
    if (!ref || isRemote(ref) || !env.importCss || depth >= 3) return '';
    return (await env.importCss(ref, depth + 1)) ?? '';
  });
  const cache = new Map<string, Promise<string | null>>();
  return replaceAsync(text, URL_RE, async (m) => {
    const ref = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!ref || isInline(ref)) return m[0];
    if (isRemote(ref)) return EMPTY_URL;
    let p = cache.get(ref);
    if (!p) {
      p = env.resolveUrl(ref);
      cache.set(ref, p);
    }
    const url = await p;
    return url ? `url("${url}")` : EMPTY_URL;
  });
}
