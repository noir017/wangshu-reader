// 极简 XML 解析器：只给 WebDAV 的 PROPFIND 响应和 OPDS/Atom 订阅源用。
// 不依赖 DOMParser，在 happy-dom、Worker、浏览器里行为一致（happy-dom 对命名空间支持不可靠）。
// 不做校验：容忍常见的脏数据（站点 XML 里夹杂的非法字符、未闭合标签），尽量解析出东西。

export interface XNode {
  /** 带前缀的原始名，如 `d:href` */
  name: string;
  /** 去掉前缀后的名字（小写），匹配时用它 */
  local: string;
  attrs: Record<string, string>;
  children: (XNode | string)[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function localName(name: string): string {
  const i = name.indexOf(':');
  return (i >= 0 ? name.slice(i + 1) : name).toLowerCase();
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

/** 解析 XML 文本，返回根元素；没有任何元素时返回 null */
export function parseXml(xml: string): XNode | null {
  // `<?xml` 之前的垃圾字符（原 app 的 resetInputStream 同样处理）
  const start = xml.indexOf('<');
  if (start < 0) return null;
  const src = xml.slice(start);
  const root: XNode = { name: '#root', local: '#root', attrs: {}, children: [] };
  const stack: XNode[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!(?:DOCTYPE|doctype)[^>]*(?:\[[\s\S]*?\])?[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (t: string, raw = false) => {
    if (!t) return;
    stack[stack.length - 1].children.push(raw ? t : decodeEntities(t));
  };
  while ((m = re.exec(src))) {
    if (m.index > last) pushText(src.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] !== undefined) {
      pushText(m[1], true);
    } else if (m[2] !== undefined) {
      // 结束标签：向上找最近的同名节点（容忍未闭合的子节点）
      const want = m[2];
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === want) {
          stack.length = i;
          break;
        }
      }
    } else if (m[3] !== undefined) {
      const node: XNode = { name: m[3], local: localName(m[3]), attrs: parseAttrs(m[4] ?? ''), children: [] };
      stack[stack.length - 1].children.push(node);
      if (m[5] !== '/') stack.push(node);
    }
  }
  if (last < src.length) pushText(src.slice(last));
  return root.children.find((c): c is XNode => typeof c !== 'string') ?? null;
}

export function childrenOf(n: XNode, local?: string): XNode[] {
  return n.children.filter((c): c is XNode => typeof c !== 'string' && (!local || c.local === local));
}

export function child(n: XNode, local: string): XNode | undefined {
  return childrenOf(n, local)[0];
}

/** 节点内全部文本（递归） */
export function textOf(n: XNode | undefined): string {
  if (!n) return '';
  let out = '';
  for (const c of n.children) out += typeof c === 'string' ? c : textOf(c);
  return out;
}

export function childText(n: XNode, local: string): string {
  return textOf(child(n, local)).trim();
}

/** 把节点内部内容序列化回 XML/HTML 文本（Atom `type="xhtml"` 的 content 用） */
export function innerXml(n: XNode): string {
  let out = '';
  for (const c of n.children) {
    if (typeof c === 'string') out += c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    else {
      const attrs = Object.entries(c.attrs)
        .map(([k, v]) => ` ${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
        .join('');
      out += c.children.length ? `<${c.name}${attrs}>${innerXml(c)}</${c.name}>` : `<${c.name}${attrs}/>`;
    }
  }
  return out;
}

export function* walk(n: XNode): Generator<XNode> {
  yield n;
  for (const c of n.children) if (typeof c !== 'string') yield* walk(c);
}
