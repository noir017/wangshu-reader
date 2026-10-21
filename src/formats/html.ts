// HTML / HTM / XHTML 单文件书（FMT-006）：编码检测 → 清洗（脚本全部丢弃）→ 按 h1 与大小切章，目录取 h1–h3。
import type { Book, BookProbe, FormatParser, OpenOptions } from '@/core/book';
import { textSettings } from '@/reader/settings';
import { decodeMarkup } from './encoding';
import { buildFlowBook, metaFromHead } from './lib/flow';
import { readBytes } from './lib/bytes';
import { buildSectionContent } from './lib/section';
import { metaFromFileName } from './lib/text';
import { htmlSettings } from './settings';

async function readHtml(file: Blob, opts: OpenOptions): Promise<string> {
  const hint = opts.encoding ?? textSettings.get().textEncode;
  return decodeMarkup(await readBytes(file), hint && hint !== 'auto' ? hint : undefined).text;
}

function metaOf(text: string, fileName: string) {
  const head = metaFromHead(text);
  const fm = metaFromFileName(fileName);
  return {
    title: head.title || fm.title,
    authors: head.author ? [head.author] : fm.authors,
    ...(head.description ? { description: head.description } : {}),
    ...(head.language ? { language: head.language } : {}),
  };
}

export const htmlParser: FormatParser = {
  format: 'html',
  extensions: ['html', 'htm', 'xhtml'],
  sniff(head) {
    const s = new TextDecoder('latin1').decode(head.subarray(0, 512)).toLowerCase();
    return /<!doctype html|<html[\s>]/.test(s);
  },
  async open(file, opts): Promise<Book> {
    const text = await readHtml(file, opts);
    // 单文件里的相对路径资源（图片、CSS）没处可取：直接丢掉引用，避免浏览器去请求应用自己的地址
    const content = await buildSectionContent(text, { resolveResource: async () => null, loadStylesheet: async () => null, rewriteCss: async (c) => c });
    return buildFlowBook({ format: 'html', metadata: metaOf(text, opts.fileName), content, maxChars: htmlSettings.get().maxChapterChars, splitAtH1: true });
  },
  async probe(file, opts): Promise<BookProbe> {
    const text = await readHtml(file.slice(0, 64 * 1024), opts);
    return { format: 'html', metadata: metaOf(text, opts.fileName), cover: null, size: { chars: Math.round(file.size * 0.5) } };
  },
};
