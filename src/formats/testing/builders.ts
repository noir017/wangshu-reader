// 测试用：程序化生成样书（EPUB / 压缩包）与旧式编码字节。不进生产包。
import { zlibSync } from 'fflate';
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

// ───────────────────────── UMD（spec §4.5，字节布局与 Umd.java 一致） ─────────────────────────

export interface UmdSpec {
  title?: string;
  author?: string;
  year?: string;
  month?: string;
  day?: string;
  gender?: string;
  publisher?: string;
  /** 章节标题与正文（正文里的 \n 会被写成 U+2029） */
  chapters: { title: string; text: string }[];
  cover?: Uint8Array;
  /** 1 = 文本，其他值 = 漫画 UMD（应被拒绝） */
  type?: number;
}

export function buildUmd(spec: UmdSpec): Uint8Array {
  const out: number[] = [];
  const u32 = (n: number) => out.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
  const bytes = (b: ArrayLike<number>) => out.push(...Array.from(b));
  const utf16 = (s: string) => {
    const b = encodeUtf16(s, true, false);
    return b;
  };
  u32(0xde9a9b89);
  // # 01：文本型
  out.push(0x23, 0x01, 0x00, 0, 0, spec.type ?? 1, 0, 0);
  const strTag = (tag: number, s?: string) => {
    if (s === undefined) return;
    const b = utf16(s);
    out.push(0x23, tag, 0x00, 0x00, b.length + 5);
    bytes(b);
  };
  strTag(2, spec.title);
  strTag(3, spec.author);
  strTag(4, spec.year);
  strTag(5, spec.month);
  strTag(6, spec.day);
  strTag(7, spec.gender);
  strTag(8, spec.publisher);

  const texts = spec.chapters.map((c) => c.text.replace(/\n/g, '\u2029'));
  const offsets: number[] = [];
  let acc = 0;
  for (const t of texts) {
    offsets.push(acc * 2);
    acc += t.length;
  }
  out.push(0x23, 0x0b, 0x00, 0, 0);
  u32(acc * 2);

  let id = 0x1000;
  const segment = (tag: number, skipBefore: number, payload: Uint8Array) => {
    out.push(0x23, tag, 0x00);
    for (let i = 0; i < skipBefore; i++) out.push(i === skipBefore - 1 ? 1 : 0);
    u32(id);
    out.push(0x24);
    u32(id);
    u32(payload.length + 9);
    bytes(payload);
    id++;
  };
  const le32 = (nums: number[]) => {
    const b = new Uint8Array(nums.length * 4);
    const dv = new DataView(b.buffer);
    nums.forEach((n, i) => dv.setUint32(i * 4, n, true));
    return b;
  };
  // 正文：一块 zlib（UTF-16LE，末尾补 NUL）
  const all = encodeUtf16(`${texts.join('')}\0`, true, false);
  const z = zlibSync(all);
  out.push(0x24);
  u32(0x2000);
  u32(z.length + 9);
  bytes(z);
  if (spec.cover) segment(0x82, 3, spec.cover);
  segment(0x83, 2, le32(offsets));
  // 0x84：标题表 —— 每章 (len u8, utf16)；段头里的 L 之后直接是标题（Umd.java 没有额外跳过 4 字节）
  const titleBytes: number[] = [];
  for (const c of spec.chapters) {
    const b = utf16(c.title);
    titleBytes.push(b.length, ...Array.from(b));
  }
  segment(0x84, 2, Uint8Array.from(titleBytes));
  out.push(0x23, 0x0c, 0x00, 0, 0);
  u32(0);

  return Uint8Array.from(out);
}

// ───────────────────────── MOBI6（PalmDOC，未加密） ─────────────────────────
export interface MobiSpec {
  title?: string;
  author?: string;
  /** 原始 HTML（全部），字节按 utf-8 */
  html: string;
  /** 资源记录（图片等），recindex 从 1 开始 */
  resources?: Uint8Array[];
  /** 0 = 无 DRM */
  encryption?: number;
  /** 1 = 不压缩，2 = PalmDOC */
  compression?: 1 | 2;
  /** EXTH 封面偏移（资源序号，0 起） */
  coverOffset?: number;
  isbn?: string;
}

/** 最朴素的 PalmDOC 压缩：只用「空格+字符」与字面量（足够覆盖解压器的主要分支） */
export function palmdocCompress(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === 0x20 && i + 1 < src.length && src[i + 1] >= 0x40 && src[i + 1] <= 0x7f) {
      out.push(src[i + 1] ^ 0x80);
      i += 2;
    } else if (c >= 0x80 || c === 0 || c < 9) {
      // 8 位字节、0、1..8：用「后面跟 n 字节」的字面量段
      let n = 1;
      while (n < 8 && i + n < src.length && (src[i + n] >= 0x80 || src[i + n] < 9)) n++;
      out.push(n, ...Array.from(src.subarray(i, i + n)));
      i += n;
    } else {
      out.push(c);
      i++;
    }
  }
  return Uint8Array.from(out);
}

export function buildMobi6(spec: MobiSpec): Uint8Array {
  const text = new TextEncoder().encode(spec.html);
  const RS = 4096;
  const compression = spec.compression ?? 2;
  const recs: Uint8Array[] = [];
  for (let pos = 0; pos < text.length; ) {
    let end = Math.min(pos + RS, text.length);
    // 不要把 UTF-8 多字节字符切在记录边界上（trailingFlags=0，没有尾部字节）
    while (end < text.length && (text[end] & 0xc0) === 0x80) end++;
    const chunk = text.subarray(pos, end);
    recs.push(compression === 2 ? palmdocCompress(chunk) : chunk.slice());
    pos = end;
  }
  if (!recs.length) recs.push(new Uint8Array());
  const title = new TextEncoder().encode(spec.title ?? '');
  const exth: number[] = [];
  const exthRec = (type: number, data: Uint8Array) => {
    const len = 8 + data.length;
    exth.push((type >>> 24) & 255, (type >>> 16) & 255, (type >>> 8) & 255, type & 255, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...Array.from(data));
  };
  let exthCount = 0;
  const be32 = (n: number) => Uint8Array.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  if (spec.author) (exthRec(100, new TextEncoder().encode(spec.author)), exthCount++);
  if (spec.isbn) (exthRec(104, new TextEncoder().encode(spec.isbn)), exthCount++);
  if (spec.coverOffset !== undefined) (exthRec(201, be32(spec.coverOffset)), exthCount++);
  const exthBlock = exthCount ? Uint8Array.from([0x45, 0x58, 0x54, 0x48, ...Array.from(be32(12 + exth.length)), ...Array.from(be32(exthCount)), ...exth]) : new Uint8Array();
  const pad = (4 - (exthBlock.length % 4)) % 4;

  // 记录 0：PalmDOC 头(16) + MOBI 头(232) + EXTH + 标题
  const mobiLen = 232;
  const r0len = 16 + mobiLen + exthBlock.length + pad + title.length + 2;
  const r0 = new Uint8Array(r0len);
  const dv = new DataView(r0.buffer);
  dv.setUint16(0, compression, false);
  dv.setUint32(4, text.length, false);
  dv.setUint16(8, recs.length, false);
  dv.setUint16(10, RS, false);
  dv.setUint16(12, spec.encryption ?? 0, false);
  r0.set(new TextEncoder().encode('MOBI'), 16);
  dv.setUint32(20, mobiLen, false);
  dv.setUint32(24, 2, false);
  dv.setUint32(28, 65001, false);
  dv.setUint32(32, 0x1234, false);
  dv.setUint32(36, 6, false); // version
  dv.setUint32(84, 16 + mobiLen + exthBlock.length + pad, false); // titleOffset
  dv.setUint32(88, title.length, false);
  dv.setUint8(94, 0);
  dv.setUint8(95, 9); // en
  dv.setUint32(108, recs.length + 1, false); // resourceStart
  dv.setUint32(112, 0xffffffff, false);
  dv.setUint32(128, exthCount ? 0x40 : 0, false); // exthFlag
  dv.setUint32(240, 0, false); // trailingFlags
  dv.setUint32(244, 0xffffffff, false); // indx
  r0.set(exthBlock, 16 + mobiLen);
  r0.set(title, 16 + mobiLen + exthBlock.length + pad);

  const records = [r0, ...recs, ...(spec.resources ?? [])];
  const header = new Uint8Array(78 + records.length * 8 + 2);
  const hv = new DataView(header.buffer);
  header.set(new TextEncoder().encode((spec.title ?? 'book').slice(0, 31)), 0);
  header.set(new TextEncoder().encode('BOOKMOBI'), 60);
  hv.setUint16(76, records.length, false);
  let off = header.length;
  records.forEach((r, i) => {
    hv.setUint32(78 + i * 8, off, false);
    hv.setUint32(78 + i * 8 + 4, i * 2, false);
    off += r.length;
  });
  const out = new Uint8Array(off);
  out.set(header, 0);
  let o = header.length;
  for (const r of records) (out.set(r, o), (o += r.length));
  return out;
}

// ───────────────────────── PNG（漫画页测试：宽高可控，不依赖解码器） ─────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** 纯色 PNG（合法文件，可被真实解码器读取） */
export function makePng(width: number, height: number, rgb: [number, number, number] = [200, 220, 255]): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = new Uint8Array(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y++) raw.set(row, y * row.length);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}

// ───────────────────────── PDF（手写的最小 PDF：Helvetica 文本页 + 书签 + 文档信息） ─────────────────────────
export interface PdfSpec {
  /** 每页的文本行 */
  pages: string[][];
  /** 用未内嵌的 CID 字体 STSong-Light + UniGB-UCS2-H 写中文（要靠 pdf.js 随包的 CMap 才能抽出文字） */
  cjk?: boolean;
  size?: [number, number];
  info?: { Title?: string; Author?: string; Subject?: string; Keywords?: string };
  /** 书签：title/页下标/层级（0 起，按文档顺序，层级只能逐级加深） */
  outline?: { title: string; page: number; level: number }[];
}

export function buildPdf(spec: PdfSpec): Uint8Array {
  const [w, h] = spec.size ?? [612, 792];
  const objs: string[] = [];
  const add = (body: string) => objs.push(body) && objs.length; // 返回对象号（从 1 起）
  const n = spec.pages.length;
  // 对象号规划：1 catalog，2 pages，3 font，4 info，5 outlines，然后每页 (page, content)，最后书签项
  const pageObj = (i: number) => 6 + i * 2;
  const outlineBase = 6 + n * 2;
  const outline = spec.outline ?? [];
  let outlineItems: string[] = [];
  add(`<< /Type /Catalog /Pages 2 0 R${outline.length ? ' /Outlines 5 0 R' : ''} >>`);
  add(`<< /Type /Pages /Kids [${spec.pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${n} /MediaBox [0 0 ${w} ${h}] >>`);
  add(
    spec.cjk
      ? '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [ << /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /DW 1000 >> ] >>'
      : '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  );
  const esc = (s: string) => `(${s.replace(/[\\()]/g, '\\$&')})`;
  add(`<< ${Object.entries(spec.info ?? {}).map(([k, v]) => `/${k} ${esc(v)}`).join(' ')} >>`);
  // outlines
  if (outline.length) {
    const kids: number[][] = []; // 每项的子项下标
    const parent: number[] = [];
    const stack: number[] = [];
    outline.forEach((o, i) => {
      stack.length = o.level;
      parent[i] = o.level === 0 ? -1 : stack[o.level - 1];
      stack[o.level] = i;
      kids[i] = [];
      if (parent[i] >= 0) kids[parent[i]].push(i);
    });
    const tops = outline.map((_, i) => i).filter((i) => parent[i] < 0);
    add(`<< /Type /Outlines /First ${outlineBase + tops[0]} 0 R /Last ${outlineBase + tops[tops.length - 1]} 0 R /Count ${outline.length} >>`);
    // 页面与内容对象先占位，书签项后加
    outlineItems = outline.map((o, i) => {
      const sibs = parent[i] < 0 ? tops : kids[parent[i]];
      const k = sibs.indexOf(i);
      const kid = kids[i];
      return `<< /Title ${esc(o.title)} /Parent ${parent[i] < 0 ? 5 : outlineBase + parent[i]} 0 R${k > 0 ? ` /Prev ${outlineBase + sibs[k - 1]} 0 R` : ''}${k < sibs.length - 1 ? ` /Next ${outlineBase + sibs[k + 1]} 0 R` : ''}${kid.length ? ` /First ${outlineBase + kid[0]} 0 R /Last ${outlineBase + kid[kid.length - 1]} 0 R /Count ${kid.length}` : ''} /Dest [${pageObj(o.page)} 0 R /Fit] >>`;
    });
  } else add('null');
  spec.pages.forEach((lines, i) => {
    add(`<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObj(i) + 1} 0 R >>`);
    const show = (l: string) => (spec.cjk ? `<${[...l].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('')}>` : esc(l));
    const stream = `BT /F1 18 Tf 72 ${h - 100} Td 24 TL ${lines.map((l) => `${show(l)} Tj T*`).join(' ')} ET`;
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  for (const o of outlineItems) add(o);

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((b, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${b}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${Object.keys(spec.info ?? {}).length ? ' /Info 4 0 R' : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
