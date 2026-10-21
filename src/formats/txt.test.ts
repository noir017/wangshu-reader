import './testing/dom-shim';
import { describe, expect, it } from 'vitest';
import { textOfHtml } from '@/core/text';
import type { ReflowableBook } from '@/core/book';
import { openBook, probeBook, detectFormat } from './index';
import { buildTxtBook } from './txt';
import { asFile, encodeLegacy } from './testing/builders';
import { txtSettings } from './settings';

const open = async (content: string | Uint8Array, name = 'book.txt', extra?: Record<string, unknown>) => {
  const f = asFile(new Blob([content as BlobPart]), name);
  return (await openBook(f, { fileName: name, extra })) as ReflowableBook & { encoding: string };
};

const body = '这是一段用来填充章节内容的文字，它不包含任何会被误认为标题的特征。'.repeat(6);

describe('TXT 打开', () => {
  it('分章、目录与章节内容', async () => {
    const text = ['第一章 开始', body, '', '第二章 继续', body, '第三章 结束', body, '第四章 尾声', body].join('\n');
    const book = await open(text, '示例小说 - 某作者.txt');
    expect(book.format).toBe('txt');
    expect(book.metadata).toMatchObject({ title: '示例小说', authors: ['某作者'], language: 'zh' });
    expect(book.toc.map((t) => t.title)).toEqual(['第一章 开始', '第二章 继续', '第三章 结束', '第四章 尾声']);
    expect(book.toc.every((t) => t.level === 0)).toBe(true);
    expect(book.sections).toHaveLength(4);
    expect(book.sections[1].title).toBe('第二章 继续');
    const c = await book.sections[0].load();
    expect(c.bodyHtml).toContain('<p class="mr-title">第一章 开始</p>');
    expect(c.bodyHtml).toContain('<p class="mr-blank"><br></p>');
    expect(c.bodyAttrs).toEqual({ class: 'mr-txt' });
  });

  it('charCount 与 textOf(bodyHtml) 一致（含空行、缩进、注音）', async () => {
    const text = ['第一章 甲', '　　段落一，含<标签>&符号。', '', '    空格缩进的一行', '漢字《かんじ》と｜東京都《とうきょう》。', '   ', '第二章 乙', body, '第三章 丙', body, '第四章 丁', body, ''].join('\n');
    const book = await open(text);
    for (const s of book.sections) {
      const c = await s.load();
      expect(textOfHtml(c.bodyHtml).length).toBe(s.charCount);
    }
    const html = (await book.sections[0].load()).bodyHtml;
    expect(html).toContain('<span class="mr-ind">　　</span>段落一，含&lt;标签&gt;&amp;符号。');
    expect(html).toContain('<ruby>漢字<rt>かんじ</rt></ruby>と<ruby>東京都<rt>とうきょう</rt></ruby>');
  });

  it('注音可关闭', async () => {
    const book = await open('漢字《かんじ》\n'.repeat(3), 'a.txt', { aozoraRuby: false });
    expect((await book.sections[0].load()).bodyHtml).toContain('漢字《かんじ》');
  });

  it('大文件按 maxSectionChars 在行边界切段，标题不丢', async () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `第${i}行：${'字'.repeat(30)}`);
    const book = await open(lines.join('\n'), 'big.txt', { chapterMode: 'off', maxSectionChars: 20000 });
    expect(book.sections.length).toBeGreaterThan(3);
    let total = 0;
    let rows = 0;
    for (const s of book.sections) {
      expect(s.charCount).toBeLessThan(26000);
      const c = await s.load();
      rows += (c.bodyHtml.match(/<p/g) ?? []).length;
      total += s.charCount;
    }
    expect(rows).toBe(3000);
    expect(total).toBe(lines.join('').length);
    expect(book.toc).toEqual([]);
  });

  it('一整行没有换行的超长文本也会被切开', async () => {
    const text = '这是一句话。'.repeat(30000);
    const book = await open(text, 'oneline.txt', { chapterMode: 'off', maxSectionChars: 20000 });
    expect(book.sections.length).toBeGreaterThanOrEqual(9);
    expect(book.sections.reduce((n, s) => n + s.charCount, 0)).toBe(text.length);
  });

  it('前言（首章之前）单独成段，空白前言被丢弃', async () => {
    const t = ['作者：某某', '简介：很短', '', '第一章 甲', body, '第二章 乙', body, '第三章 丙', body, '第四章 丁', body].join('\n');
    const book = await open(t, '书名.txt');
    expect(book.sections).toHaveLength(5);
    expect(book.sections[0].id).toBe('c0');
    expect(book.toc).toHaveLength(4);
    expect(book.toc[0].section).toBe(1);
    const t2 = ['\n\n', '第一章 甲', body, '第二章 乙', body, '第三章 丙', body, '第四章 丁', body].join('\n');
    expect((await open(t2)).sections).toHaveLength(4);
  });

  it('编码：GBK / Big5 / UTF-16 自动检测，也可手动指定', async () => {
    const text = '第一章 山里的村庄\n我在山里走了很多天，终于看到了一座小村庄。村里的人们都很和气，他们说这里已经有几百年的历史了。\n'.repeat(5);
    const gbk = await open(encodeLegacy(text, 'gbk'));
    expect(gbk.encoding).toBe('gbk');
    expect(textOfHtml((await gbk.sections[0].load()).bodyHtml)).toContain('我在山里走了很多天');
    const forced = await open(encodeLegacy(text, 'gbk'), 'x.txt', undefined);
    expect(forced.encoding).toBe('gbk');
    // 指定错误编码 → 乱码但不崩
    const f = asFile(new Blob([encodeLegacy(text, 'gbk') as BlobPart]), 'x.txt');
    const wrong = (await openBook(f, { fileName: 'x.txt', encoding: 'windows-1252' })) as ReflowableBook & { encoding: string };
    expect(wrong.encoding).toBe('windows-1252');
    await expect(openBook(f, { fileName: 'x.txt', encoding: 'no-such-enc' })).rejects.toThrow(/编码|encoding/i);
  });

  it('CRLF / 孤立 CR 统一成换行；BOM 去掉', async () => {
    const book = await open('﻿第一行\r\n第二行\r第三行\n', 'a.txt');
    const html = (await book.sections[0].load()).bodyHtml;
    expect(html).toBe('<p>第一行</p><p>第二行</p><p>第三行</p>');
  });

  it('空文件、HTML 转义', async () => {
    const empty = await open('', 'empty.txt');
    expect(empty.sections).toHaveLength(1);
    expect(empty.sections[0].charCount).toBe(0);
    const html = await open('<script>alert(1)</script>', 'x.txt');
    expect((await html.sections[0].load()).bodyHtml).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('二进制文件拒绝；未知扩展名的文本按 TXT', async () => {
    const bin = new Uint8Array(200).map((_, i) => (i % 7 === 0 ? 0 : i));
    await expect(openBook(asFile(new Blob([bin]), 'a.bin'), { fileName: 'a.bin' })).rejects.toThrow();
    const t = await open('just text', 'readme.unknownext');
    expect(t.format).toBe('txt');
    expect(detectFormat('x.txt')?.format).toBe('txt');
  });

  it('probe：书名-作者、字数', async () => {
    const f = asFile(new Blob(['hello world foo bar\n你好世界']), '三体 - 刘慈欣.txt');
    const p = await probeBook(f, { fileName: f.name });
    expect(p.metadata).toMatchObject({ title: '三体', authors: ['刘慈欣'] });
    expect(p.size?.chars).toBe(4 + 4);
    expect(p.cover).toBeNull();
  });

  it('设置默认值与单本覆盖', async () => {
    expect(txtSettings.get().chapterMode).toBe('auto');
    const t = ['第一章 甲', body, '第二章 乙', body, '第三章 丙', body, '第四章 丁', body].join('\n');
    expect((await open(t, 'x.txt', { chapterMode: 'off' })).toc).toEqual([]);
    txtSettings.set({ chapterMode: 'off' });
    expect((await open(t)).toc).toEqual([]);
    txtSettings.set({ chapterMode: 'auto' });
    const direct = buildTxtBook(t.replace(/\r/g, ''), { fileName: 'a.txt' }, { encoding: 'utf-8', detected: false });
    expect(direct.toc).toHaveLength(4);
  });
});
