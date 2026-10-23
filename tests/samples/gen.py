#!/usr/bin/env python3
"""生成程序化样书，和 fetch.sh 下载的真实样书放在一起（samples/books，不进 git）。
依赖：python3 标准库、7z、iconv、node（要先 npm ci，用项目依赖 opencc-js）。输入：fetch.sh 已下载的 Gutenberg 文件。
用法：python3 tests/samples/gen.py [样书目录，默认 <项目根>/samples/books]
幂等：重复运行会覆盖生成的文件，不动下载的文件。
"""
import base64
import io
import os
import re
import struct
import subprocess
import sys
import tempfile
import zipfile
import zlib
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'samples', 'books')
TMP = tempfile.mkdtemp()
os.chdir(D)


def read(p, mode='rb'):
    with open(p, mode) as f:
        return f.read()


def write(p, data):
    with open(p, 'wb') as f:
        f.write(data if isinstance(data, bytes) else data.encode('utf-8'))
    print('gen  ', p, os.path.getsize(p))


# ───────────────────────── 素材：Alice 文本与 EPUB 里的图片 ─────────────────────────
alice = read('pg11-alice.txt').decode('utf-8-sig')
body = alice[alice.index('CHAPTER I.'):alice.index('*** END OF')]
chapters = re.split(r'\n(?=CHAPTER [IVXL]+\.)', body)
chapters = [c.strip() for c in chapters if c.strip()]
ez = zipfile.ZipFile('pg11-alice.epub')
imgs = sorted(n for n in ez.namelist() if re.search(r'\.(jpe?g|png)$', n, re.I))
img_bytes = {n: ez.read(n) for n in imgs}
cover = next((img_bytes[n] for n in imgs if 'cover' in n.lower()), img_bytes[imgs[0]])
print('alice chapters', len(chapters), 'images', len(imgs))

# ───────────────────────── 中文编码变体 ─────────────────────────
hlm = read('pg24264-hongloumeng.txt').decode('utf-8-sig')
cut = hlm[:150_000]
cut = cut[: cut.rindex('\n') + 1]
write('hlm-trad-utf8bom.txt', b'\xef\xbb\xbf' + cut.encode('utf-8'))
write('hlm-trad-big5.txt', subprocess.run(['iconv', '-f', 'UTF-8', '-t', 'BIG5', '-c'], input=cut.encode('utf-8'), capture_output=True).stdout)
write('hlm-trad-utf16le.txt', b'\xff\xfe' + cut.encode('utf-16-le'))
# 简体：用 opencc-js（项目依赖）从繁体转，再转成 GBK
node = r"""
import * as OpenCC from 'opencc-js';
import fs from 'node:fs';
const c = OpenCC.Converter({ from: 'tw', to: 'cn' });
fs.writeFileSync(process.argv[2], c(fs.readFileSync(process.argv[1], 'utf8')));
"""
cut_path, simp_path = os.path.join(TMP, 'hlm-cut.txt'), os.path.join(TMP, 'hlm-simp.txt')
write(cut_path, cut)
# opencc-js 是项目依赖：以项目根为 cwd，用 -e 才能解析到 node_modules
subprocess.run(['node', '--input-type=module', '-e', node, cut_path, simp_path], cwd=ROOT, check=True)
simp = read(simp_path)
write('hlm-simp-gbk.txt', subprocess.run(['iconv', '-f', 'UTF-8', '-t', 'GBK', '-c'], input=simp, capture_output=True).stdout)
write('hlm-simp-gb18030-crlf.txt', subprocess.run(['iconv', '-f', 'UTF-8', '-t', 'GB18030', '-c'], input=simp.replace(b'\n', b'\r\n'), capture_output=True).stdout)

# 青空文库：zip 里的 Shift_JIS 文本另存一份裸 txt
kz = zipfile.ZipFile('aozora-kokoro.zip')
name = next(n for n in kz.namelist() if n.lower().endswith('.txt'))
write('aozora-kokoro-sjis.txt', kz.read(name))

# ───────────────────────── FB2 ─────────────────────────
def fb2_p(text):
    return '<p>' + escape(text) + '</p>'

secs = []
for i, ch in enumerate(chapters[:6]):
    lines = [l.strip() for l in ch.split('\n') if l.strip()]
    title = lines[0] + (' ' + lines[1] if len(lines) > 1 and lines[1].isupper() else '')
    paras = []
    buf = []
    for l in ch.split('\n')[2:]:
        if l.strip():
            buf.append(l.strip())
        elif buf:
            paras.append(' '.join(buf))
            buf = []
    if buf:
        paras.append(' '.join(buf))
    inner = ''.join(fb2_p(p) for p in paras[:14])
    if i == 0:
        inner = '<epigraph><p>Down the Rabbit-Hole</p><text-author>L. C.</text-author></epigraph>' + inner[:0] + inner + '<p>See note<a l:href="#n1" type="note">[1]</a> and<a l:href="#n2" type="note">[2]</a>.</p>'
    if i == 2:
        inner += '<poem><stanza><v>How doth the little crocodile</v><v>Improve his shining tail</v></stanza></poem>'
        sub = '<section><title><p>A subsection</p></title>' + fb2_p('Nested section text.') + '<image l:href="#cover.jpg"/></section>'
        inner += sub
    secs.append(f'<section id="ch{i+1}"><title><p>{escape(title)}</p></title>{inner}</section>')
fb2 = f'''<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>children</genre><genre>fantasy</genre><author><first-name>Lewis</first-name><last-name>Carroll</last-name></author>
<book-title>Alice's Adventures in Wonderland (FB2 sample)</book-title><annotation><p>Generated from the Project Gutenberg text for tests.</p></annotation>
<date value="1865-11-26">1865</date><lang>en</lang><sequence name="Alice" number="1"/><coverpage><image l:href="#cover.jpg"/></coverpage></title-info>
<publish-info><publisher>moonreader-web tests</publisher><year>2026</year><isbn>9780141439761</isbn></publish-info></description>
<body>{''.join(secs)}</body>
<body name="notes"><title><p>Notes</p></title>
<section id="n1"><title><p>1</p></title><p>First footnote text.</p></section>
<section id="n2"><title><p>2</p></title><p>Second footnote text.</p></section></body>
<binary id="cover.jpg" content-type="image/jpeg">{base64.b64encode(cover).decode()}</binary>
</FictionBook>'''
write('sample.fb2', fb2)
with zipfile.ZipFile('sample.fb2.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('sample.fb2', fb2)
print('gen   sample.fb2.zip')
# windows-1251 FB2（俄文，声明编码非 UTF-8）
ru = '<?xml version="1.0" encoding="windows-1251"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><author><first-name>Лев</first-name><last-name>Толстой</last-name></author><book-title>Война и мир (фрагмент)</book-title><lang>ru</lang></title-info></description><body><section><title><p>Глава первая</p></title><p>— Ну, князь, Генуя и Лукка стали не больше чем поместьями семейства Бонапарте.</p></section></body></FictionBook>'
write('sample-ru-cp1251.fb2', ru.encode('cp1251'))

# ───────────────────────── Markdown / HTML / RTF ─────────────────────────
md = '''# 第一章 开始

这是 **Markdown** 样书，含脚注[^1]、表格和代码。

| 列 A | 列 B |
|------|------|
| 1    | 2    |

```js
console.log("code block")
```

# 第二章 继续

~~删除线~~ 与 [链接](https://example.com)。

[^1]: 这是脚注内容。
'''
write('sample.md', md)
html = '''<!DOCTYPE html><html lang="zh"><head><meta charset="gbk"><title>HTML 样书 - 某作者</title><meta name="author" content="某作者"><style>p{text-indent:2em}</style>
<script>alert("should be removed")</script></head><body onload="alert(1)"><h1>第一章</h1><p onclick="alert(2)">中文内容，GBK 编码。<a href="javascript:alert(3)">坏链接</a></p><h1>第二章</h1><p>结尾。</p><img src="missing.png"></body></html>'''
write('sample-gbk.html', html.encode('gbk'))
def rtf_u(t):
    # RTF 的 \uN? 写法（N 为 UTF-16 码元，有符号 16 位）
    return ''.join(c if ord(c) < 128 else '\\u%d?' % ord(c) for c in t)

rtf = ('{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil\\fcharset134 SimSun;}}'
       '{\\info{\\title ' + rtf_u('RTF 样书') + '}{\\author ' + rtf_u('某作者') + '}}\\f0\\fs24 '
       '\\par ' + rtf_u('第一章 开始') + '\\par '
       "\\'d5\\'e2\\'ca\\'c7 GBK \\'b1\\'e0\\'c2\\'eb\\'b5\\'c4 RTF\\par "
       'Second paragraph with \\b bold\\b0  text.\\par}')
write('sample.rtf', rtf.encode('ascii'))

# ───────────────────────── DOCX / ODT ─────────────────────────
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
docx_doc = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 DOCX 样书</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">普通段落，</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>粗体</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>斜体</w:t></w:r><w:r><w:t>。脚注</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>列表项一</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>列表项二</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第二章</w:t></w:r></w:p>
<w:p><w:r><w:t>结尾段落。</w:t></w:r></w:p>
</w:body></w:document>'''
with zipfile.ZipFile('sample.docx', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/></Types>')
    z.writestr('word/document.xml', docx_doc)
    z.writestr('word/styles.xml', f'<?xml version="1.0"?><w:styles xmlns:w="{W}"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>')
    z.writestr('word/numbering.xml', f'<?xml version="1.0"?><w:numbering xmlns:w="{W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>')
    z.writestr('word/footnotes.xml', f'<?xml version="1.0"?><w:footnotes xmlns:w="{W}"><w:footnote w:id="2"><w:p><w:r><w:t>DOCX 脚注内容</w:t></w:r></w:p></w:footnote></w:footnotes>')
    z.writestr('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpg"/></Relationships>')
    z.writestr('word/media/image1.jpg', cover)
    z.writestr('docProps/core.xml', '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>DOCX 样书</dc:title><dc:creator>某作者</dc:creator></cp:coreProperties>')
print('gen   sample.docx')

odt_content = '''<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink">
<office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles>
<office:body><office:text>
<text:h text:outline-level="1">第一章 ODT 样书</text:h>
<text:p>普通段落，<text:span text:style-name="T1">粗体</text:span>，脚注<text:note text:id="ftn1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>ODT 脚注内容</text:p></text:note-body></text:note>。</text:p>
<text:list><text:list-item><text:p>列表项一</text:p></text:list-item><text:list-item><text:p>列表项二</text:p></text:list-item></text:list>
<text:p><draw:frame><draw:image xlink:href="Pictures/image1.jpg"/></draw:frame></text:p>
<text:h text:outline-level="1">第二章</text:h><text:p>结尾段落。</text:p>
</office:text></office:body></office:document-content>'''
with zipfile.ZipFile('sample.odt', 'w') as z:
    z.writestr(zipfile.ZipInfo('mimetype'), 'application/vnd.oasis.opendocument.text')
    z.writestr('content.xml', odt_content, zipfile.ZIP_DEFLATED)
    z.writestr('meta.xml', '<?xml version="1.0"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"><office:meta><dc:title>ODT 样书</dc:title><meta:initial-creator>某作者</meta:initial-creator></office:meta></office:document-meta>', zipfile.ZIP_DEFLATED)
    z.writestr('Pictures/image1.jpg', cover, zipfile.ZIP_DEFLATED)
    z.writestr('Thumbnails/thumbnail.png', base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), zipfile.ZIP_DEFLATED)
print('gen   sample.odt')

# ───────────────────────── UMD（布局同 Umd.java / spec §4.5） ─────────────────────────
def utf16(s):
    return s.encode('utf-16-le')

def umd(title, author, chs):
    out = bytearray()
    out += struct.pack('<I', 0xDE9A9B89)
    out += b'\x23\x01\x00\x00\x00\x01\x00\x00'
    for tag, s in ((2, title), (3, author), (4, '2026'), (5, '10'), (6, '21'), (7, '小说'), (8, 'moonreader-web')):
        b = utf16(s)
        out += bytes([0x23, tag, 0, 0, len(b) + 5]) + b
    texts = [c[1].replace('\n', ' ') for c in chs]
    offs, acc = [], 0
    for t in texts:
        offs.append(acc * 2)
        acc += len(t)
    out += b'\x23\x0b\x00\x00\x00' + struct.pack('<I', acc * 2)
    z = zlib.compress(utf16(''.join(texts) + '\0'))
    out += b'\x24' + struct.pack('<II', 0x2000, len(z) + 9) + z
    def seg(tag, skip, payload, sid):
        nonlocal out
        out += bytes([0x23, tag, 0]) + bytes([0] * (skip - 1) + [1]) + struct.pack('<I', sid) + b'\x24' + struct.pack('<II', sid, len(payload) + 9) + payload
    seg(0x82, 3, cover, 0x1001)
    seg(0x83, 2, b''.join(struct.pack('<I', o) for o in offs), 0x1002)
    tb = b''.join(bytes([len(utf16(c[0]))]) + utf16(c[0]) for c in chs)
    seg(0x84, 2, tb, 0x1003)
    out += b'\x23\x0c\x00\x00\x00' + struct.pack('<I', 0)
    return bytes(out)

write('sample.umd', umd('UMD 样书', '某作者', [
    ('第一章 开始', '第一章 开始\n这是第一章的正文，用来测试 UMD 解析。\n第二段文字。'),
    ('第二章 继续', '第二章 继续\n这是第二章。' + '内容重复。' * 50),
    ('尾声', '尾声\n完。'),
]))

# ───────────────────────── CBZ / CB7 / 各种压缩包 ─────────────────────────
FONT = {
    '0': ['01110','10001','10011','10101','11001','10001','01110'], '1': ['00100','01100','00100','00100','00100','00100','01110'],
    '2': ['01110','10001','00001','00010','00100','01000','11111'], '3': ['11110','00001','00001','01110','00001','00001','11110'],
    '4': ['00010','00110','01010','10010','11111','00010','00010'], '5': ['11111','10000','11110','00001','00001','10001','01110'],
    '6': ['00110','01000','10000','11110','10001','10001','01110'], '7': ['11111','00001','00010','00100','01000','01000','01000'],
    '8': ['01110','10001','10001','01110','10001','10001','01110'], '9': ['01110','10001','10001','01111','00001','00010','01100'],
}

def make_png(n, w=300, h=450):
    """纯色背景 + 大号页码的 PNG（不依赖 PIL）"""
    bg = [(235, 245, 255), (255, 240, 220), (230, 255, 230), (255, 230, 240), (240, 235, 255), (255, 255, 215)][n % 6]
    rows = []
    label = str(n)
    scale = 18
    gw = len(label) * 6 * scale
    ox, oy = (w - gw) // 2, (h - 7 * scale) // 2
    for y in range(h):
        row = bytearray([0])
        for x in range(w):
            c = bg
            if x < 4 or y < 4 or x >= w - 4 or y >= h - 4:
                c = (60, 60, 60)
            else:
                gx, gy = (x - ox) // scale, (y - oy) // scale
                if 0 <= gy < 7 and gx >= 0 and gx // 6 < len(label) and gx % 6 < 5 and FONT[label[gx // 6]][gy][gx % 6] == '1':
                    c = (30, 30, 120)
            row += bytes(c)
        rows.append(bytes(row))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')

page_png = {i: make_png(i) for i in (1, 2, 3, 4, 5, 10, 11)}
cinfo = '<?xml version="1.0"?><ComicInfo><Title>Alice 漫画样本</Title><Series>Alice</Series><Number>1</Number><Volume>1</Volume><Summary>程序生成的 CBZ（页面为生成的 PNG，第 6 页为 Gutenberg 的 Alice 封面 JPEG）。</Summary><Writer>Lewis Carroll</Writer><Genre>Fantasy</Genre><LanguageISO>en</LanguageISO></ComicInfo>'
with zipfile.ZipFile('sample.cbz', 'w', zipfile.ZIP_STORED) as z:
    z.writestr('ComicInfo.xml', cinfo)
    z.writestr('__MACOSX/._001.png', b'junk')
    for i in (1, 2, 3, 4, 5):
        z.writestr(f'Alice/{i:03d}.png', page_png[i])
    z.writestr('Alice/006.jpg', cover)
print('gen   sample.cbz')
with zipfile.ZipFile('sample-manga-rtl.cbz', 'w', zipfile.ZIP_STORED) as z:
    z.writestr('ComicInfo.xml', '<?xml version="1.0"?><ComicInfo><Title>右开本样本</Title><Manga>YesAndRightToLeft</Manga></ComicInfo>')
    # 故意用会打乱字典序的页名：page1, page2, page10, page11
    for i in (1, 2, 10, 11):
        z.writestr(f'page{i}.png', page_png[i])
print('gen   sample-manga-rtl.cbz')
cb7src = os.path.join(TMP, 'cb7src')
os.makedirs(cb7src, exist_ok=True)
for i in (1, 2, 3, 4):
    write(os.path.join(cb7src, f'{i:03d}.png'), page_png[i])
for ext in ('sample.cb7', 'sample-images.7z'):
    if os.path.exists(ext):
        os.remove(ext)
    subprocess.run(['7z', 'a', '-t7z', '-bso0', '-bsp0', ext, os.path.join(cb7src, '*')], check=True)
    print('gen  ', ext, os.path.getsize(ext))

epub_bytes = read('pg11-alice.epub')
with zipfile.ZipFile('zip-single-epub.zip', 'w', zipfile.ZIP_STORED) as z:
    z.writestr('readme.txt', 'This archive holds exactly one book.')
    z.writestr('Alice in Wonderland - Lewis Carroll.epub', epub_bytes)
with zipfile.ZipFile('zip-two-books.zip', 'w', zipfile.ZIP_STORED) as z:
    z.writestr('a.epub', epub_bytes)
    z.writestr('b.txt', read('pg11-alice.txt'))
with zipfile.ZipFile('zip-images-only.zip', 'w', zipfile.ZIP_STORED) as z:
    for i in (1, 2, 3, 4, 5):
        z.writestr(f'{i}.png', page_png[i])
print('gen   zip-*.zip')
# 中文文件名、没有 UTF-8 标志位（GBK 编码的文件名）的 zip：
# python 的 zipfile 遇到非 ASCII 文件名一律写 UTF-8 并置标志位，所以先用同长度的 ASCII 占位名建包，再把字节替换成 GBK
gbk_name = '红楼梦 - 曹雪芹.txt'.encode('gbk')
placeholder = b'X' * len(gbk_name)
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(placeholder.decode('ascii'), subprocess.run(['iconv', '-f', 'UTF-8', '-t', 'GBK', '-c'], input=simp[:60000], capture_output=True).stdout)
raw = buf.getvalue()
assert raw.count(placeholder) == 2
write('zip-gbk-name.zip', raw.replace(placeholder, gbk_name))

# 纯 PalmDOC（TEXtREAd）
def palmdoc(text):
    data = text.encode('latin-1', 'replace')
    rec = data  # compression=1（不压缩）
    r0 = struct.pack('>HHIHHHH', 1, 0, len(data), 1, 4096, 0, 0)
    hdr = bytearray(78 + 16 + 2)
    hdr[0:8] = b'PalmDoc'
    hdr[60:68] = b'TEXtREAd'
    struct.pack_into('>H', hdr, 76, 2)
    struct.pack_into('>I', hdr, 78, len(hdr))
    struct.pack_into('>I', hdr, 86, len(hdr) + len(r0))
    return bytes(hdr) + r0 + rec
write('sample-palmdoc.prc', palmdoc(alice[alice.index('CHAPTER I.'):][:20000]))
print('done')
