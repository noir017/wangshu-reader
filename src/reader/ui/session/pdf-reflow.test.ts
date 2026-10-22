import { describe, expect, it } from 'vitest';
import type { FixedBook, FixedPageText } from '@/core/book';
import { textOf } from '@/core/text';
import { canReflow, isReflowed, reflowFixedBook, reflowPageHtml } from './pdf-reflow';

/** 按行造文字层：每行一个块，left/right/top 归一化坐标，行高 0.02 */
function page(lines: Array<[text: string, left: number, right: number, top: number, h?: number]>): FixedPageText {
  let text = '';
  const items: FixedPageText['items'] = [];
  lines.forEach(([s, l, r, top, h = 0.02], i) => {
    const start = text.length;
    text += s;
    if (s) items.push({ start, end: text.length, x: l, y: top, w: r - l, h });
    if (i < lines.length - 1) text += '\n';
  });
  return { text, items };
}

function render(html: string): HTMLDivElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

/** 用户看到的段落文字（隐藏 span 不算） */
const visible = (div: HTMLElement) =>
  [...div.querySelectorAll('p')].map((p) => {
    const c = p.cloneNode(true) as HTMLElement;
    for (const h of c.querySelectorAll('span')) if ((h as HTMLElement).style.display === 'none') h.remove();
    return (c.textContent ?? '').replace(/\s+/g, ' ').trim();
  });

describe('reflowPageHtml（PDF-006，照 A.formatPdfReflowText）', () => {
  it('文本节点逐字等于原页文字：偏移基准不变（固定版式下的进度、标注在重排里位置照旧）', () => {
    const t = page([
      ['Dynamic languages such as JavaScript are more diffi-', 0.1, 0.9, 0.1],
      ['cult to compile than statically typed ones.', 0.1, 0.6, 0.12],
      ['', 0, 0, 0],
      ['中文段落第一行写满了整整一行的文字内容', 0.1, 0.9, 0.2],
      ['接着第二行。', 0.1, 0.3, 0.22],
    ]);
    const div = render(reflowPageHtml(t.text, t.items));
    expect(textOf(div)).toBe(t.text);
  });

  it('写满的行接上下一行：西文以空格相隔，行末连字符去掉，汉字直接接；没写满的行结束段落', () => {
    const t = page([
      ['We present a trace-based compilation tech-', 0.1, 0.9, 0.1],
      ['nique for dynamic languages that reconciles', 0.1, 0.89, 0.12],
      ['speed of compilation.', 0.1, 0.4, 0.14],
      ['静读天下是一款功能强大的电子书阅读器，支', 0.1, 0.9, 0.16],
      ['持多种格式。', 0.1, 0.3, 0.18],
    ]);
    expect(visible(render(reflowPageHtml(t.text, t.items)))).toEqual([
      'We present a trace-based compilation technique for dynamic languages that reconciles speed of compilation.',
      '静读天下是一款功能强大的电子书阅读器，支持多种格式。',
    ]);
  });

  it('行距明显变大、字高不同（标题）都分段', () => {
    const t = page([
      ['1. Introduction', 0.1, 0.9, 0.1, 0.03],
      ['Dynamic languages such as JavaScript, Python, and Ruby, are pop-', 0.1, 0.9, 0.14],
      ['ular since they are expressive and easy to use by everyone here.', 0.1, 0.9, 0.16],
      ['A new paragraph after a big vertical gap starts right here now.', 0.1, 0.9, 0.24],
    ]);
    expect(visible(render(reflowPageHtml(t.text, t.items)))).toEqual([
      '1. Introduction',
      'Dynamic languages such as JavaScript, Python, and Ruby, are popular since they are expressive and easy to use by everyone here.',
      'A new paragraph after a big vertical gap starts right here now.',
    ]);
  });

  it('两栏排版：左栏的行按左栏宽度判断是否写满', () => {
    const t = page([
      ['left column line one that is full', 0.08, 0.47, 0.1],
      ['left column line two is also full', 0.08, 0.46, 0.12],
      ['right column starts here and is full', 0.53, 0.92, 0.1],
    ]);
    expect(visible(render(reflowPageHtml(t.text, t.items)))).toEqual(['left column line one that is full left column line two is also full right column starts here and is full']);
  });

  it('没有几何信息：按行末标点分段；HTML 特殊字符被转义', () => {
    const html = reflowPageHtml('a < b and\nc > d.\nnext <tag>');
    const div = render(html);
    expect(textOf(div)).toBe('a < b and\nc > d.\nnext <tag>');
    expect(visible(div)).toEqual(['a < b and c > d.', 'next <tag>']);
  });
});

describe('reflowFixedBook', () => {
  const texts = ['first page text.', 'second page\ntext.'];
  const fixed = {
    kind: 'fixed',
    format: 'pdf',
    metadata: { title: 'T', authors: [] },
    toc: [{ title: 'Intro', level: 0, section: 1 }],
    pageCount: 2,
    getPageSize: async () => ({ width: 100, height: 100 }),
    renderPage: async () => ({}) as CanvasImageSource,
    getPageText: async (i: number) => ({ text: texts[i], items: [] }),
    getCover: async () => null,
    destroy: () => undefined,
  } as unknown as FixedBook & { getPageText: NonNullable<FixedBook['getPageText']> };

  it('一页一章，目录照搬，章节文字与页文字相同，页尾页码不产生文本节点', async () => {
    const b = reflowFixedBook(fixed);
    expect(b.kind).toBe('reflowable');
    expect(b.sections.map((s) => s.title)).toEqual(['1/2', 'Intro']);
    expect(b.toc).toBe(fixed.toc);
    const c = await b.sections[1].load();
    const div = render(c.bodyHtml);
    expect(textOf(div)).toBe(texts[1]);
    expect(div.querySelector('.mr-reflow-page')?.getAttribute('data-p')).toBe('<2/2>');
    expect(c.styles.join('')).toContain('content:attr(data-p)');
  });

  it('canReflow / isReflowed', () => {
    expect(canReflow(fixed)).toBe(true);
    expect(canReflow({ ...fixed, format: 'cbz' })).toBe(false);
    expect(canReflow({ kind: 'fixed', format: 'pdf' })).toBe(false);
    expect(isReflowed(reflowFixedBook(fixed))).toBe(true);
    expect(isReflowed({ kind: 'reflowable', format: 'epub' })).toBe(false);
  });
});
