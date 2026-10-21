// 测试与样例书库用的小样本生成器：纯色 PNG、zip、带封面的 EPUB。
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { ZipWriter } from './lib/zipwriter';

/** 纯色 PNG */
export function png(w: number, h: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export interface ZipItem {
  name: string;
  data: Buffer | string;
  compress?: boolean;
}

/** 按顺序把条目写成 zip 文件（第一个条目是 mimetype 时 EPUB 也合规） */
export async function writeZip(file: string, items: ZipItem[]): Promise<void> {
  mkdirSync(path.dirname(file), { recursive: true });
  const z = new ZipWriter(file);
  for (const it of items) await z.add(it.name, Buffer.isBuffer(it.data) ? it.data : Buffer.from(it.data), { compress: it.compress ?? !Buffer.isBuffer(it.data) });
  await z.finish();
}

/** 带封面图的最小 EPUB（EPUB 2 的 <meta name="cover">） */
export async function writeEpub(file: string, title: string, cover: Buffer): Promise<void> {
  await writeZip(file, [
    { name: 'mimetype', data: 'application/epub+zip', compress: false },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    {
      name: 'OEBPS/content.opf',
      data: `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:identifier id="id">x</dc:identifier><meta name="cover" content="cov"/></metadata><manifest><item id="cov" href="img/cover.png" media-type="image/png"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
    },
    { name: 'OEBPS/img/cover.png', data: cover },
    { name: 'OEBPS/c1.xhtml', data: '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>hi</p></body></html>' },
  ]);
}
