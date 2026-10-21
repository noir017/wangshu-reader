// 生成联调用的样例书库：npx tsx server/scripts/make-sample-library.ts <输出目录>
// 书都是程序生成的最小样本（EPUB/FB2/CBZ/ZIP/TXT），RAR 样本需要自己放进去。
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { ZipWriter } from '../src/lib/zipwriter';

const out = process.argv[2];
if (!out) {
  console.error('用法: tsx server/scripts/make-sample-library.ts <输出目录>');
  process.exit(2);
}

/** 纯色 PNG */
function png(w: number, h: number, rgb: [number, number, number]): Buffer {
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

const mk = (...p: string[]) => {
  const d = path.join(out, ...p);
  mkdirSync(d, { recursive: true });
  return d;
};

async function main() {
  const books = mk('Books');
  mk('Upload');
  mk('.hidden');
  writeFileSync(path.join(out, '.hidden', 'secret.txt'), 'hidden');
  writeFileSync(path.join(books, 'hello.txt'), '你好，世界。\nHello, world.\n');
  writeFileSync(path.join(mk('中文目录'), '三体 - 刘慈欣.txt'), '科学边界\n');
  writeFileSync(path.join(books, 'readme.md'), '# Sample library\n');

  // EPUB（带封面）
  const ep = new ZipWriter(path.join(books, 'Alice.epub'));
  await ep.add('mimetype', Buffer.from('application/epub+zip'));
  await ep.add('META-INF/container.xml', Buffer.from('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), { compress: true });
  await ep.add(
    'OEBPS/content.opf',
    Buffer.from(
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:title>Alice</dc:title><dc:identifier id="id">alice</dc:identifier><dc:language>en</dc:language><meta name="cover" content="cov"/></metadata><manifest><item id="cov" href="images/cover.png" media-type="image/png"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="c1"/></spine></package>',
    ),
    { compress: true },
  );
  await ep.add('OEBPS/images/cover.png', png(200, 300, [200, 80, 60]));
  await ep.add('OEBPS/c1.xhtml', Buffer.from('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title></head><body><h1>Chapter 1</h1><p>Down the rabbit hole.</p></body></html>'), { compress: true });
  await ep.add('OEBPS/toc.ncx', Buffer.from('<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap><navPoint id="n1" playOrder="1"><navLabel><text>Chapter 1</text></navLabel><content src="c1.xhtml"/></navPoint></navMap></ncx>'), { compress: true });
  await ep.finish();

  // FB2（带封面）
  writeFileSync(
    path.join(books, 'story.fb2'),
    `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><genre>prose</genre><book-title>Story</book-title><coverpage><image l:href="#cover.png"/></coverpage></title-info></description><body><section><p>Once upon a time.</p></section></body><binary id="cover.png" content-type="image/png">${png(120, 180, [40, 120, 200]).toString('base64')}</binary></FictionBook>`,
  );

  // CBZ（页名自然排序：page2 在 page10 之前）
  const comics = mk('Comics');
  const cbz = new ZipWriter(path.join(comics, 'demo.cbz'));
  await cbz.add('page10.png', png(60, 90, [10, 10, 10]));
  await cbz.add('page2.png', png(60, 90, [250, 250, 0]));
  await cbz.add('page1.png', png(60, 90, [0, 200, 0]));
  await cbz.finish();

  // 带目录的 zip（压缩包内浏览）
  const bundle = new ZipWriter(path.join(comics, 'bundle.zip'));
  await bundle.add('vol1/001.png', png(40, 60, [90, 90, 200]));
  await bundle.add('vol1/002.png', png(40, 60, [200, 90, 200]));
  await bundle.add('notes/readme.txt', Buffer.from('notes in zip'), { compress: true });
  await bundle.add('top.txt', Buffer.from('top'), { compress: true });
  await bundle.finish();

  console.log(`样例书库已生成：${out}`);
}

void main();
