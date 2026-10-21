// 需要服务端的格式（FMT-014 CHM、FMT-020 CBR/CB7、PDF-010 DJVU）：把原文件交给服务端转成浏览器能读的格式，再走对应解析器。
//   CHM → EPUB；CBR/CB7 → CBZ；DJVU → PDF（服务端要有 djvulibre）。服务端没配置/不可用时抛 ServerRequiredError（中文提示）。
// 书的 format 保持原格式名（界面上显示 CHM/CBR/DJVU）。probe 在服务端不可用时退回「只用文件名」，保证导入书架不被卡住。
import type { Book, BookFormat, BookProbe, FormatParser, OpenOptions } from '@/core/book';
import type { ServerFeature } from '@shared/api';
import { openCbz, probeCbz } from './cbz';
import { openEpub, probeEpub } from './epub';
import { BookOpenError } from './errors';
import { ascii, startsWithAscii } from './lib/bytes';
import { convertViaServer, type ConvertTarget } from './lib/convert';
import { metaFromFileName } from './lib/text';
import { openPdf, probePdf } from './pdf';

interface ServerSpec {
  format: BookFormat;
  extensions: string[];
  label: string;
  to: ConvertTarget;
  feature?: ServerFeature;
  sniff?: FormatParser['sniff'];
  openInner: (blob: Blob, opts: OpenOptions) => Promise<Book>;
  probeInner: (blob: Blob, opts: OpenOptions) => Promise<BookProbe>;
  /** probe 是否也要转换（DJVU→PDF 整本转换太重，导入时只用文件名） */
  probeConverts: boolean;
}

function fileNameProbe(format: BookFormat, opts: OpenOptions): BookProbe {
  const m = metaFromFileName(opts.fileName);
  return { format, metadata: { title: m.title, authors: m.authors }, cover: null };
}

function makeServerParser(s: ServerSpec): FormatParser {
  const convert = (file: Blob, opts: OpenOptions) => convertViaServer(file, opts.fileName, s.to, { label: s.label, feature: s.feature, signal: opts.signal });
  return {
    format: s.format,
    extensions: s.extensions,
    needsServer: true,
    sniff: s.sniff,
    async open(file, opts) {
      const inner = await s.openInner(await convert(file, opts), opts);
      return { ...inner, format: s.format } as Book;
    },
    async probe(file, opts) {
      if (!s.probeConverts) return fileNameProbe(s.format, opts);
      try {
        const p = await s.probeInner(await convert(file, opts), opts);
        return { ...p, format: s.format };
      } catch (e) {
        if (e instanceof BookOpenError && e.code === 'server') return fileNameProbe(s.format, opts);
        throw e;
      }
    },
  };
}

export const chmParser = makeServerParser({
  format: 'chm',
  extensions: ['chm'],
  label: 'CHM',
  to: 'epub',
  sniff: (head) => startsWithAscii(head, 'ITSF'),
  openInner: openEpub,
  probeInner: probeEpub,
  probeConverts: true,
});

export const cbrParser = makeServerParser({
  format: 'cbr',
  extensions: ['cbr'],
  label: 'CBR',
  to: 'cbz',
  openInner: openCbz,
  probeInner: probeCbz,
  probeConverts: true,
});

export const cb7Parser = makeServerParser({
  format: 'cb7',
  extensions: ['cb7'],
  label: 'CB7',
  to: 'cbz',
  openInner: openCbz,
  probeInner: probeCbz,
  probeConverts: true,
});

export const djvuParser = makeServerParser({
  format: 'djvu',
  extensions: ['djvu', 'djv'],
  label: 'DJVU',
  to: 'pdf',
  feature: 'convert.djvu',
  sniff: (head) => ascii(head, 0, 8) === 'AT&TFORM',
  openInner: openPdf,
  probeInner: probePdf,
  probeConverts: false,
});
