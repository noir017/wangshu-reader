// 测试用：程序化生成样书（EPUB / 压缩包）与旧式编码字节。不进生产包。
import JSZip from 'jszip';

export function u8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export async function zipBlob(files: Record<string, string | Uint8Array>, opts: { storeFirst?: string } = {}): Promise<Blob> {
  const z = new JSZip();
  if (opts.storeFirst) z.file(opts.storeFirst, files[opts.storeFirst], { compression: 'STORE' });
  for (const [k, v] of Object.entries(files)) if (k !== opts.storeFirst) z.file(k, v);
  const bytes = await z.generateAsync({ type: 'uint8array' });
  return new Blob([bytes as BlobPart]);
}

export function asFile(blob: Blob, name: string): File {
  return new File([blob], name);
}

export interface EpubChapter {
  id: string;
  file: string; // 相对 OEBPS/
  body?: string;
  head?: string;
  title?: string;
  linear?: boolean;
  raw?: string; // 整个文件原文（覆盖 body/head）
}

export interface EpubSpec {
  version?: '2' | '3';
  title?: string;
  authors?: string[];
  language?: string;
  publisher?: string;
  description?: string;
  subjects?: string[];
  identifier?: string;
  extraMetadata?: string;
  chapters: EpubChapter[];
  files?: Record<string, string | Uint8Array>;
  extraManifest?: string;
  ncx?: string | boolean;
  nav?: string | boolean;
  guide?: string;
  spineAttrs?: string;
  metaFiles?: Record<string, string>;
  /** manifest 里 cover 图片 item 的额外属性 */
  coverProps?: boolean;
}

const xhtml = (c: EpubChapter) =>
  c.raw ??
  `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${c.title ?? c.id}</title>${c.head ?? ''}</head><body>${c.body ?? ''}</body></html>`;

export async function buildEpub(spec: EpubSpec): Promise<Blob> {
  const v3 = (spec.version ?? '3') === '3';
  const files: Record<string, string | Uint8Array> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  };
  for (const [k, v] of Object.entries(spec.metaFiles ?? {})) files[`META-INF/${k}`] = v;
  const items: string[] = [];
  const refs: string[] = [];
  for (const c of spec.chapters) {
    files[`OEBPS/${c.file}`] = xhtml(c);
    items.push(`<item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`);
    refs.push(`<itemref idref="${c.id}"${c.linear === false ? ' linear="no"' : ''}/>`);
  }
  for (const [k, v] of Object.entries(spec.files ?? {})) files[`OEBPS/${k}`] = v;
  let ncxItem = '';
  if (spec.ncx) {
    files['OEBPS/toc.ncx'] = typeof spec.ncx === 'string' ? spec.ncx : '';
    ncxItem = '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>';
  }
  let navItem = '';
  if (spec.nav) {
    files['OEBPS/nav.xhtml'] = typeof spec.nav === 'string' ? spec.nav : '';
    navItem = '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>';
  }
  files['OEBPS/content.opf'] = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${v3 ? '3.0' : '2.0'}" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<dc:identifier id="bookid">${spec.identifier ?? 'urn:uuid:12345678-1234-1234-1234-123456789abc'}</dc:identifier>
<dc:title>${spec.title ?? ''}</dc:title>
${(spec.authors ?? []).map((a) => `<dc:creator>${a}</dc:creator>`).join('')}
${spec.language ? `<dc:language>${spec.language}</dc:language>` : ''}
${spec.publisher ? `<dc:publisher>${spec.publisher}</dc:publisher>` : ''}
${spec.description ? `<dc:description>${spec.description}</dc:description>` : ''}
${(spec.subjects ?? []).map((s) => `<dc:subject>${s}</dc:subject>`).join('')}
${spec.extraMetadata ?? ''}
</metadata>
<manifest>${items.join('')}${ncxItem}${navItem}${spec.extraManifest ?? ''}</manifest>
<spine${spec.ncx ? ' toc="ncx"' : ''}${spec.spineAttrs ? ` ${spec.spineAttrs}` : ''}>${refs.join('')}</spine>
${spec.guide ? `<guide>${spec.guide}</guide>` : ''}
</package>`;
  return zipBlob(files, { storeFirst: 'mimetype' });
}

/** 1x1 PNG */
export const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

// ───────────────────────── 旧式编码（测试时反向构造字节） ─────────────────────────
const encMaps = new Map<string, Map<string, number[]>>();

function buildMap(enc: string): Map<string, number[]> {
  const m = new Map<string, number[]>();
  const dec = new TextDecoder(enc);
  const put = (bytes: number[]) => {
    const s = dec.decode(Uint8Array.from(bytes));
    if (s.length >= 1 && !s.includes('�') && !m.has(s)) m.set(s, bytes);
  };
  for (let b = 0x80; b <= 0xff; b++) put([b]);
  const leads: [number, number][] = enc === 'shift_jis' ? [[0x81, 0x9f], [0xe0, 0xfc]] : [[0x81, 0xfe]];
  for (const [lo, hi] of leads) {
    for (let a = lo; a <= hi; a++) {
      for (let b = 0x40; b <= 0xfe; b++) put([a, b]);
    }
  }
  return m;
}

/** 把字符串编码成 gbk/big5/shift_jis/euc-kr/euc-jp/windows-1251/koi8-r 字节（ASCII 原样）；不在编码里的字符抛错 */
export function encodeLegacy(text: string, enc: string): Uint8Array {
  let map = encMaps.get(enc);
  if (!map) {
    map = buildMap(enc);
    encMaps.set(enc, map);
  }
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) {
      out.push(cp);
      continue;
    }
    const b = map.get(ch);
    if (!b) throw new Error(`字符 ${ch} 不在 ${enc} 里`);
    out.push(...b);
  }
  return Uint8Array.from(out);
}

export function encodeUtf16(text: string, le: boolean, bom: boolean): Uint8Array {
  const n = text.length;
  const out = new Uint8Array((n + (bom ? 1 : 0)) * 2);
  const dv = new DataView(out.buffer);
  let o = 0;
  if (bom) {
    dv.setUint16(0, 0xfeff, le);
    o = 2;
  }
  for (let i = 0; i < n; i++) dv.setUint16(o + i * 2, text.charCodeAt(i), le);
  return out;
}
