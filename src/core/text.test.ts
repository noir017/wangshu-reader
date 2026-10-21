import { describe, expect, it } from 'vitest';
import { locateOffset, offsetsOfRange, rangeFromOffsets, textOf, textOfHtml, textWithBreaks } from './text';

// 用全局 document：happy-dom 对 DOMParser 生成的文档做 Range 边界比较时有 bug（会把 Range 折叠）
function body(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.replaceChildren(el);
  return el;
}

describe('core/text', () => {
  it('拼接文本节点并跳过 script/style', () => {
    const b = body('<p>甲乙</p><style>p{}</style><p>丙<b>丁</b></p><script>x()</script>');
    expect(textOf(b)).toBe('甲乙丙丁');
    expect(textOfHtml('<p>ab</p><p>c</p>')).toBe('abc');
  });

  it('段落边界', () => {
    const b = body('<p>甲乙</p><p>丙<b>丁</b></p><div>戊</div>');
    expect(textWithBreaks(b)).toEqual({ text: '甲乙丙丁戊', breaks: [2, 4] });
  });

  it('偏移与 Range 往返', () => {
    const b = body('<p>Hello <i>wor</i>ld</p><p>again</p>');
    const r = rangeFromOffsets(b, 4, 13)!;
    // 不用 r.toString()：happy-dom 跨节点 Range 的 toString 不可靠
    expect([(r.startContainer as Text).data, r.startOffset, (r.endContainer as Text).data, r.endOffset]).toEqual([
      'Hello ', 4, 'again', 2,
    ]);
    expect(offsetsOfRange(b, r)).toEqual({ start: 4, end: 13 });
  });

  it('元素容器边界', () => {
    const b = body('<p>ab</p><p>cd<i>ef</i></p>');
    const p2 = b.children[1];
    const r = b.ownerDocument.createRange();
    r.setStart(p2, 1); // 'cd' 之后
    r.setEnd(b, 2); // body 末尾
    expect(offsetsOfRange(b, r)).toEqual({ start: 4, end: 6 });
  });

  it('节点交界取后一个节点开头，end 模式取前一个末尾', () => {
    const b = body('<p>ab<i>cd</i></p>');
    expect(locateOffset(b, 2)!.node.data).toBe('cd');
    expect(locateOffset(b, 2, true)!.node.data).toBe('ab');
    expect(locateOffset(b, 4)!.offset).toBe(2);
  });
});
