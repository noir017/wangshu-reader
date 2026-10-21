// XML/HTML 文档的宽松访问：不依赖命名空间 API（happy-dom 等实现对 getElementsByTagNameNS 不可靠），
// 一律按「去掉前缀的小写本地名」匹配，所以 dc:title、opf:meta、l:href 都能直接用。

export function localName(el: Element): string {
  const n = el.localName || el.tagName;
  return n.slice(n.lastIndexOf(':') + 1).toLowerCase();
}

/** 解析 XML。常见的小毛病（未转义的 &、实体）自动修复一次；仍失败则退到 HTML 解析器（标签名小写） */
export function parseXml(text: string): Document {
  const src = text.replace(/^﻿/, '');
  const tryParse = (s: string): Document | null => {
    const doc = new DOMParser().parseFromString(s, 'application/xml');
    return doc.getElementsByTagName('parsererror').length || !doc.documentElement ? null : doc;
  };
  const doc = tryParse(src);
  if (doc) return doc;
  const fixed = src.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, '&amp;');
  const doc2 = fixed === src ? null : tryParse(fixed);
  if (doc2) return doc2;
  return new DOMParser().parseFromString(src, 'text/html');
}

/** 全部后代元素中本地名为 name 的（name 小写） */
export function descendants(root: Element | Document, name: string): Element[] {
  const out: Element[] = [];
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) if (localName(all[i]) === name) out.push(all[i]);
  return out;
}

export function firstDescendant(root: Element | Document, name: string): Element | null {
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) if (localName(all[i]) === name) return all[i];
  return null;
}

export function childElements(el: Element, name?: string): Element[] {
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (!name || localName(c) === name) out.push(c);
  return out;
}

export function firstChild(el: Element, name: string): Element | null {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (localName(c) === name) return c;
  return null;
}

/** 取属性：先精确名，再按本地名（忽略前缀）匹配，如 attr(el,'href') 能取到 xlink:href / l:href */
export function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  const direct = el.getAttribute(name);
  if (direct !== null) return direct;
  const target = name.slice(name.lastIndexOf(':') + 1).toLowerCase();
  for (const a of Array.from(el.attributes)) {
    const n = a.name;
    if (n.slice(n.lastIndexOf(':') + 1).toLowerCase() === target) return a.value;
  }
  return null;
}

/** 文本内容：折叠空白并 trim */
export function textOfEl(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}
