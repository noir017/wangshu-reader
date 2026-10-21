import './testing/dom-shim';
import { describe, expect, it } from 'vitest';
import type { ReflowableBook } from '@/core/book';
import { applyFootnotes, renderMarkdown } from './markdown';
import { detectFormat, openBook, probeBook } from './index';
import { asFile, u8 } from './testing/builders';

const open = (md: string, name = 'a.md') => openBook(asFile(new Blob([u8(md)] as BlobPart[]), name), { fileName: name }) as Promise<ReflowableBook>;
const long = '正文内容。'.repeat(40);

describe('Markdown（FMT-017）', () => {
  it('识别格式', () => {
    for (const e of ['md', 'markdown', 'mkd']) expect(detectFormat(`a.${e}`)?.format).toBe('md');
  });

  it('GFM：表格、删除线、代码块、自动链接、列表', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n~~删~~ https://example.com\n\n```js\nlet x = 1\n```\n\n- 一\n- 二\n');
    expect(html).toContain('<table>');
    expect(html).toContain('<del>删</del>');
    expect(html).toContain('<pre><code class="language-js">');
    expect(html).toContain('<ul>');
    expect(html).toContain('href="https://example.com"');
  });

  it('脚注：按首次引用编号，代码块里的 [^1] 不处理，未定义的引用保持原样', () => {
    const out = applyFootnotes('正文[^b]和[^a]，又见[^b]。\n\n```\n[^a]\n```\n\n[^a]: 注 A\n[^b]: 注 B\n');
    expect(out).toMatch(/id="fnref-b"[^>]*>1<\/a>/);
    expect(out).toMatch(/id="fnref-a"[^>]*>2<\/a>/);
    expect(out).toContain('<li epub:type="footnote" id="fn-b">');
    expect(out).toContain('```\n[^a]\n```');
    expect(applyFootnotes('只有引用[^x]')).toBe('只有引用[^x]');
  });

  it('每个 h1 一章（至少 2 个 h1 才分章），目录 = 标题', async () => {
    const b = await open(`# 第一章\n\n${long}\n\n## 小节\n\n${long}\n\n# 第二章\n\n${long}\n`);
    expect(b.sections).toHaveLength(2);
    expect(b.toc.map((t) => [t.title, t.level])).toEqual([
      ['第一章', 0],
      ['小节', 1],
      ['第二章', 0],
    ]);
    expect(b.metadata.title).toBe('a');
  });

  it('文首无标题的内容跟第一章同属一节；单个 h1 不分章', async () => {
    const b = await open(`前言文字\n\n# 唯一\n\n${long}\n`);
    expect(b.sections).toHaveLength(1);
  });

  it('脚注可通过 getFootnote 取出；内部链接可解析', async () => {
    const b = await open(`# 一\n\n${long}[^1]\n\n# 二\n\n${long}\n\n[^1]: 脚注内容\n`);
    const r = b.resolveHref('#fn-1', 0);
    expect(r).not.toBeNull();
    expect(await b.getFootnote!('#fn-1', 0)).toContain('脚注内容');
  });

  it('原始 HTML 过 DOMPurify：脚本与事件属性被去掉，其余行内 HTML 保留', async () => {
    const b = await open(`# 一\n\n<script>alert(1)</script><b onclick="x()">粗</b><span>行内</span>\n\n# 二\n\n[坏](javascript:alert(1))`);
    const html = (await b.sections[0].load()).bodyHtml + (await b.sections[1].load()).bodyHtml;
    expect(html).not.toMatch(/<script|onclick|javascript:/i);
    expect(html).toContain('<b>粗</b>');
  });

  it('文件名「书名 - 作者」；probe', async () => {
    const f = asFile(new Blob([u8('# t')] as BlobPart[]), '笔记 - 我.md');
    expect((await openBook(f, { fileName: '笔记 - 我.md' })).metadata).toMatchObject({ title: '笔记', authors: ['我'] });
    expect(await probeBook(f, { fileName: '笔记 - 我.md' })).toMatchObject({ format: 'md', cover: null });
  });
});
