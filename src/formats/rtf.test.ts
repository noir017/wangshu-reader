import './testing/dom-shim';
import { describe, expect, it } from 'vitest';
import type { ReflowableBook } from '@/core/book';
import { textOfHtml } from '@/core/text';
import { detectFormat, openBook, probeBook } from './index';
import { parseRtf } from './rtf';
import { asFile, u8 } from './testing/builders';

const open = (rtf: string, name = 'a.rtf') => openBook(asFile(new Blob([u8(rtf)] as BlobPart[]), name), { fileName: name }) as Promise<ReflowableBook>;
const u = (s: string) => [...s].map((c) => `\\u${c.charCodeAt(0) > 32767 ? c.charCodeAt(0) - 65536 : c.charCodeAt(0)}?`).join('');

describe('RTF 文本抽取（FMT-016）', () => {
  it('识别格式', () => {
    expect(detectFormat('a.rtf')?.format).toBe('rtf');
    expect(detectFormat('noext', u8('{\\rtf1\\ansi hello}'))?.format).toBe('rtf');
  });

  it('段落、制表、常见符号、转义字符、\\uN 与替代字符', () => {
    const r = parseRtf(`{\\rtf1\\ansi\\deff0 Hello\\par World\\tab tab\\line L2\\par \\{brace\\} \\\\ \\emdash\\bullet \\ldblquote q\\rdblquote ${u('中文')}\\par}`);
    expect(r.text).toBe('Hello\nWorld\ttab\nL2\n{brace} \\ —•“q”中文\n');
  });

  it('\\uN 为负数（>32767 的码点）、\\ucN 控制替代字符个数', () => {
    expect(parseRtf('{\\rtf1 \\u-10179?\\u-8704?x}').text).toContain('👍'.slice(0, 0) + String.fromCharCode(55357));
    expect(parseRtf('{\\rtf1\\uc2 \\u20013??abc}').text).toBe('中abc');
  });

  it("\\'hh 按 ansicpg / 字体 fcharset 解码（GBK、Shift_JIS、windows-1251）", () => {
    expect(parseRtf("{\\rtf1\\ansi\\ansicpg936 \\'d6\\'d0\\'ce\\'c4}").text).toBe('中文');
    expect(parseRtf("{\\rtf1\\ansi{\\fonttbl{\\f0\\fcharset128 MS;}}\\f0 \\'93\\'fa\\'96\\'7b}").text).toBe('日本');
    expect(parseRtf("{\\rtf1\\ansi\\ansicpg1251 \\'cf\\'f0\\'e8\\'e2\\'e5\\'f2}").text).toBe('Привет');
  });

  it('跳过字体表/颜色表/样式表/图片/页眉页脚/\\* 目标', () => {
    const r = parseRtf('{\\rtf1{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0\\green0\\blue0;}{\\stylesheet{\\s1 Normal;}}{\\*\\generator Word}{\\pict\\wmetafile8 ABCDEF}{\\header HEADER}正文 text{\\footnote FOOT}}');
    expect(r.text.trim()).toBe('正文 text');
  });

  it('\\info 里的标题与作者', async () => {
    const b = await open(`{\\rtf1\\ansi{\\info{\\title ${u('书名')}}{\\author ${u('某人')}}}${u('第一章 开始')}\\par 正文\\par}`, 'x.rtf');
    expect(b.metadata).toMatchObject({ title: '书名', authors: ['某人'] });
    expect(b.format).toBe('rtf');
  });

  it('抽出的文本走 TXT 分章：生成目录', async () => {
    const body = Array.from({ length: 6 }, (_, i) => `${u(`第${'一二三四五六'[i]}章 标题`)}\\par ${'正文内容。'.repeat(60)}\\par `).join('');
    const b = await open(`{\\rtf1\\ansi ${body}}`);
    expect(b.toc.length).toBe(6);
    for (const s of b.sections) expect(textOfHtml((await s.load()).bodyHtml).length).toBe(s.charCount);
  });

  it('没有元数据 → 文件名；probe；不是 RTF → 报错', async () => {
    const b = await open('{\\rtf1 abc}', '书名 - 作者.rtf');
    expect(b.metadata).toMatchObject({ title: '书名', authors: ['作者'] });
    expect(await probeBook(asFile(new Blob([u8('{\\rtf1 abc def}')] as BlobPart[]), 'x.rtf'), { fileName: 'x.rtf' })).toMatchObject({ format: 'rtf', cover: null, size: { chars: 2 } });
    await expect(open('plain text, not rtf')).rejects.toMatchObject({ code: 'unsupported' });
  });
});
