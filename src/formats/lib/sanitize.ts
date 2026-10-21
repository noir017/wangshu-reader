// 章节 HTML 清洗：DOMPurify（白名单）+ 一层自己的兜底检查。
// 保留 epub:type、svg、mathml、ruby；去掉脚本、事件属性、javascript: 链接、iframe/object/embed 等。
// 注意：DOMPurify 在 happy-dom 下会因 Node.prototype.nodeName 的实现差异整体失灵，单测里用 ../testing/dom-shim 先打补丁。
import DOMPurify from 'dompurify';

const PURIFY_CONFIG = {
  IN_PLACE: true,
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  ADD_TAGS: ['rb', 'rtc'],
  ADD_ATTR: ['epub:type', 'xlink:href', 'xlink:title', 'xml:lang', 'xml:space', 'srcset', 'poster', 'controls', 'loop', 'preload', 'colspan', 'rowspan'],
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'option', 'link', 'meta', 'base', 'frame', 'frameset', 'applet', 'noscript', 'template'],
  // DOMPurify 的 DOM 防篡改会把 id="title"/"images"/"links" 这类常见锚点删掉，破坏书内跳转；
  // 改由下面 harden() 只处理真正会覆盖 document 属性的 name 属性
  SANITIZE_DOM: false,
  ALLOW_DATA_ATTR: true,
  KEEP_CONTENT: true,
} as const;

const KILL_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'frame', 'frameset', 'applet', 'base', 'meta', 'link', 'noscript', 'template']);
const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'data', 'background', 'srcset'];
/** document 上的具名访问会被这些元素的 name 属性覆盖（DOM clobbering） */
const NAME_CLOBBER = new Set(['img', 'embed', 'object', 'form', 'iframe', 'input', 'select', 'textarea', 'button', 'a', 'area']);

/** 浏览器解析 URL 时会忽略的空白/控制/零宽字符（javascript: 里夹这些字符是常见绕过手法） */
const INVISIBLE = new RegExp(
  `[${[
    [0x00, 0x20],
    [0x7f, 0x9f],
    [0x200b, 0x200f],
    [0x2028, 0x202f],
    [0xfeff, 0xfeff],
  ]
    .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`)
    .join('')}]+`,
  'g',
);

function cleanUrl(v: string): string {
  return v.replace(INVISIBLE, '').toLowerCase();
}

function unsafeUrl(tag: string, value: string): boolean {
  const v = cleanUrl(value);
  if (v.startsWith('javascript:') || v.startsWith('vbscript:')) return true;
  if (v.startsWith('data:')) {
    // 只允许图片/音视频/字体类 data URI 出现在媒体标签上，链接上的 data: 一律拒绝
    if (tag === 'a' || tag === 'area') return true;
    return !/^data:(image|audio|video|font|application\/font)/.test(v);
  }
  return false;
}

/** 兜底：DOMPurify 之后再走一遍，保证最基本的几条不依赖单一实现 */
export function harden(root: Element): void {
  const all = Array.from(root.querySelectorAll('*'));
  for (const el of all) {
    const tag = (el.localName || el.tagName).toLowerCase();
    if (KILL_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    if (tag === 'use') {
      const h = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
      if (!h.startsWith('#')) {
        el.remove();
        continue;
      }
    }
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on')) {
        el.removeAttribute(a.name);
      } else if (URL_ATTRS.includes(n)) {
        if (n === 'srcset' ? a.value.split(',').some((p) => unsafeUrl(tag, p.trim().split(/\s+/)[0] ?? '')) : unsafeUrl(tag, a.value)) el.removeAttribute(a.name);
      } else if (n === 'style') {
        const v = cleanUrl(a.value);
        if (v.includes('expression(') || v.includes('javascript:') || v.includes('behavior:') || v.includes('-moz-binding')) el.removeAttribute(a.name);
      } else if (n === 'name' && NAME_CLOBBER.has(tag) && tag !== 'a') {
        el.removeAttribute(a.name);
      }
    }
  }
}

/**
 * 就地清洗 root（root 必须是白名单内的普通元素，如 div）。
 * DOMPurify 的就地模式在「树一直在变」时会抛 TypeError 并把 root 清空（fail closed）；happy-dom 里元素数上千就会触发，
 * 浏览器里不应出现，但章节清洗失败等于整章空白，所以先备份、失败时改走「字符串进、字符串出」的路径。
 */
export function sanitizeElement(root: HTMLElement): void {
  const backup = root.innerHTML;
  try {
    DOMPurify.sanitize(root, PURIFY_CONFIG as never);
  } catch {
    const { IN_PLACE: _inPlace, ...config } = PURIFY_CONFIG;
    root.innerHTML = String(DOMPurify.sanitize(backup, config as never));
  }
  harden(root);
}
