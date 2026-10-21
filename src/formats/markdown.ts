// Markdown（FMT-017）：marked（GFM：表格/删除线/自动链接）+ 脚注；每个 h1 一章（至少 2 个 h1 才分章）。
// 原版 flexmark 的 escapeHtml(true) 会把行内 HTML 当文本；这里让它按 HTML 渲染，但最终都过 DOMPurify，不会带脚本。
import { marked } from 'marked';
import type { Book, BookProbe, FormatParser, OpenOptions } from '@/core/book';
import { textSettings } from '@/reader/settings';
import { decodeAuto } from './encoding';
import { buildFlowBook } from './lib/flow';
import { readBytes } from './lib/bytes';
import { buildSectionContent } from './lib/section';
import { escapeAttr, metaFromFileName } from './lib/text';
import { htmlSettings } from './settings';

/** 脚注：[^id] 引用与 [^id]: 定义。按首次引用顺序编号；代码块（```）内不处理 */
export function applyFootnotes(src: string): string {
  const defs = new Map<string, string>();
  const parts = src.split(/(^```[\s\S]*?^```|^~~~[\s\S]*?^~~~)/m);
  const defRe = /^\[\^([^\]\s]+)\]:[ \t]*(.*(?:\n(?:[ \t]{2,}|\t).*)*)$/gm;
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(defRe, (_m, id: string, text: string) => {
      defs.set(id, text.replace(/\n[ \t]+/g, '\n').trim());
      return '';
    });
  }
  if (!defs.size) return src;
  const order: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/\[\^([^\]\s]+)\](?!:)/g, (m, id: string) => {
      if (!defs.has(id)) return m;
      if (!order.includes(id)) order.push(id);
      const n = order.indexOf(id) + 1;
      return `<sup class="fnref"><a epub:type="noteref" id="fnref-${escapeAttr(id)}" href="#fn-${escapeAttr(id)}">${n}</a></sup>`;
    });
  }
  const items = order
    .map((id) => `<li epub:type="footnote" id="fn-${escapeAttr(id)}">${marked.parseInline(defs.get(id)!, { async: false }) as string} <a epub:type="backlink" href="#fnref-${escapeAttr(id)}">↩</a></li>`)
    .join('');
  return `${parts.join('')}\n\n<section class="footnotes" epub:type="footnotes"><hr><ol>${items}</ol></section>\n`;
}

export function renderMarkdown(src: string): string {
  return marked.parse(applyFootnotes(src.replace(/\r\n?/g, '\n')), { async: false, gfm: true }) as string;
}

async function readMd(file: Blob, opts: OpenOptions): Promise<string> {
  const hint = opts.encoding ?? textSettings.get().textEncode;
  // 原版默认 UTF-8；这里自动检测（UTF-8 有效时就是 UTF-8）
  return decodeAuto(await readBytes(file), hint).text;
}

export const markdownParser: FormatParser = {
  format: 'md',
  extensions: ['md', 'markdown', 'mkd'],
  async open(file, opts): Promise<Book> {
    const html = renderMarkdown(await readMd(file, opts));
    const content = await buildSectionContent(html, { resolveResource: async () => null }, true);
    const meta = metaFromFileName(opts.fileName);
    return buildFlowBook({ format: 'md', metadata: { title: meta.title, authors: meta.authors }, content, maxChars: htmlSettings.get().maxChapterChars, splitAtH1: true });
  },
  async probe(file, opts): Promise<BookProbe> {
    const meta = metaFromFileName(opts.fileName);
    return { format: 'md', metadata: { title: meta.title, authors: meta.authors }, cover: null, size: { chars: file.size } };
  },
};
