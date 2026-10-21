// 章节 HTML → SectionContent 的公共流水线：解析 → 抽出样式 → 轻量清理 → DOMPurify → 资源 URL 改写 → 序列化。
// charCount 用同一套解析与轻量清理后的 textOf（core/text.ts），保证与引擎拿到 bodyHtml 后算出的偏移基准一致。
import type { SectionContent } from '@/core/book';
import { textOf } from '@/core/text';
import { sanitizeElement } from './sanitize';

export interface BuildEnv {
  /** 资源引用（相对路径等）→ blob:/data: URL；返回 null 表示资源不存在（属性会被移除） */
  resolveResource?: (ref: string) => Promise<string | null>;
  /** <link rel=stylesheet href> → 已改写好的 CSS 文本；null = 忽略 */
  loadStylesheet?: (href: string) => Promise<string | null>;
  /** <style> 块与 style 属性里的 CSS 改写（url()、@import） */
  rewriteCss?: (css: string) => Promise<string>;
  /** 排在书内样式之前的附加样式（如 FB2 默认样式） */
  extraStyles?: string[];
  /** 解析之后、抽样式与清洗之前对文档做一次改写（MOBI 把 filepos/recindex/kindle: 引用改成相对路径等）。只能改属性、删整段元素，不能动文本节点 */
  prepare?: (doc: Document) => void | Promise<void>;
  lang?: string;
  dir?: 'ltr' | 'rtl';
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'command', 'keygen']);
// 自闭合的非空元素（<div/>、<a id="x"/>）在 text/html 里会被当成开始标签吞掉后面的内容，先展开
const SELF_CLOSE_RE = /<([a-zA-Z][\w:.-]*)((?:\s[^<>]*?)?)\s*\/>/g;

export function fixXhtml(src: string): string {
  return src
    .replace(/^﻿/, '')
    .replace(/<\?xml[^>]*\?>/i, '')
    .replace(SELF_CLOSE_RE, (m, name: string, attrs: string) => (VOID.has(name.toLowerCase()) || /^(svg|math)$/i.test(name) ? m : `<${name}${attrs}></${name}>`));
}

export function parseHtmlDocument(html: string, fragment = false): Document {
  const src = fixXhtml(html);
  return new DOMParser().parseFromString(fragment ? `<!doctype html><html><body>${src}</body></html>` : src, 'text/html');
}

const STRIP_FOR_TEXT = 'script,noscript,template,iframe,object,embed,frame,frameset,applet,style,link,meta,base';

/** 章节纯文本长度（与 load() 后 textOf(body) 同基准） */
export function countHtmlChars(html: string, fragment = false): number {
  const doc = parseHtmlDocument(html, fragment);
  const body = doc.body;
  body.querySelectorAll(STRIP_FOR_TEXT).forEach((n) => n.remove());
  return textOf(body).length;
}

const BODY_ATTRS = ['class', 'id', 'style', 'dir', 'lang', 'xml:lang', 'epub:type'];

const REF_ATTRS: { sel: string; attr: string }[] = [
  { sel: 'img', attr: 'src' },
  { sel: 'image', attr: 'href' },
  { sel: 'image', attr: 'xlink:href' },
  { sel: 'source', attr: 'src' },
  { sel: 'video', attr: 'src' },
  { sel: 'video', attr: 'poster' },
  { sel: 'audio', attr: 'src' },
  { sel: 'track', attr: 'src' },
];

const isLocalRef = (ref: string) => !!ref && !ref.startsWith('#') && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref);

async function rewriteResources(root: HTMLElement, env: BuildEnv): Promise<void> {
  const jobs: Promise<void>[] = [];
  const resolve = env.resolveResource;
  for (const { sel, attr } of REF_ATTRS) {
    root.querySelectorAll(sel).forEach((el) => {
      const ref = el.getAttribute(attr);
      if (ref === null) return;
      const v = ref.trim();
      if (!isLocalRef(v) || !resolve) return;
      jobs.push(
        resolve(v).then((url) => {
          if (url) el.setAttribute(attr, url);
          else el.removeAttribute(attr);
        }),
      );
    });
  }
  root.querySelectorAll('img[srcset],source[srcset]').forEach((el) => {
    const parts = (el.getAttribute('srcset') ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    jobs.push(
      (async () => {
        const out: string[] = [];
        for (const p of parts) {
          const [u, ...rest] = p.split(/\s+/);
          if (!isLocalRef(u)) {
            out.push(p);
            continue;
          }
          const url = resolve ? await resolve(u) : null;
          if (url) out.push([url, ...rest].join(' '));
        }
        if (out.length) el.setAttribute('srcset', out.join(', '));
        else el.removeAttribute('srcset');
      })(),
    );
  });
  if (env.rewriteCss) {
    const rw = env.rewriteCss;
    root.querySelectorAll('[style*="url("]').forEach((el) => {
      jobs.push(rw(el.getAttribute('style') ?? '').then((css) => el.setAttribute('style', css)));
    });
  }
  await Promise.all(jobs);
}

/** <pre>/<textarea> 起首的换行在解析时会被丢掉一个：序列化后补一个，保证重新解析后文本不变 */
function fixPreNewline(html: string): string {
  return html.replace(/(<(?:pre|textarea|listing)\b[^>]*>)\n/gi, '$1\n\n');
}

/**
 * 把一份 HTML（完整文档或 fragment）变成引擎可用的 SectionContent。
 * 偏移基准提醒：这里不得增删/拆分文本节点内容，只允许删除整段元素（脚本、样式等）。
 */
export async function buildSectionContent(html: string, env: BuildEnv = {}, fragment = false): Promise<SectionContent> {
  const doc = parseHtmlDocument(html, fragment);
  if (env.prepare) await env.prepare(doc);
  const body = doc.body;

  // 1) 样式：<style> 与 <link rel=stylesheet> 按文档顺序抽出
  const styles: string[] = [...(env.extraStyles ?? [])];
  const styleNodes = Array.from(doc.querySelectorAll('style, link'));
  for (const node of styleNodes) {
    const tag = node.localName.toLowerCase();
    if (tag === 'style') {
      const css = node.textContent ?? '';
      if (css.trim()) styles.push(env.rewriteCss ? await env.rewriteCss(css) : css);
    } else if (tag === 'link' && /\bstylesheet\b/i.test(node.getAttribute('rel') ?? '')) {
      const href = node.getAttribute('href');
      const css = href && env.loadStylesheet ? await env.loadStylesheet(href) : null;
      if (css) styles.push(css);
    }
    node.remove();
  }

  // 2) body 属性与语言/方向
  const root0 = doc.documentElement;
  const bodyAttrs: Record<string, string> = {};
  for (const n of BODY_ATTRS) {
    const v = body.getAttribute(n);
    if (v !== null && v !== '') bodyAttrs[n] = v;
  }
  const lang = body.getAttribute('lang') || body.getAttribute('xml:lang') || root0.getAttribute('lang') || root0.getAttribute('xml:lang') || env.lang || undefined;
  const dirAttr = (body.getAttribute('dir') || root0.getAttribute('dir') || '').toLowerCase();
  const dir = dirAttr === 'rtl' || dirAttr === 'ltr' ? dirAttr : env.dir;

  // 3) 清洗：body 子节点搬进 div 再就地过 DOMPurify（body 本身不能作为 IN_PLACE 根）
  const wrap = doc.createElement('div');
  while (body.firstChild) wrap.appendChild(body.firstChild);
  wrap.querySelectorAll(STRIP_FOR_TEXT).forEach((n) => n.remove());
  sanitizeElement(wrap);

  // 4) 资源改写（清洗之后做，blob: 是我们自己写入的可信值）
  await rewriteResources(wrap, env);

  const out: SectionContent = { bodyHtml: fixPreNewline(wrap.innerHTML), styles };
  if (Object.keys(bodyAttrs).length) out.bodyAttrs = bodyAttrs;
  if (lang) out.lang = lang;
  if (dir) out.dir = dir;
  return out;
}

/** 空章节占位 */
export function emptySection(): SectionContent {
  return { bodyHtml: '', styles: [] };
}
