// 注意：happy-dom 对 DOMParser 文档的 Range 有 bug（见 AGENTS.md），这里全用全局 document 建节点
import { beforeEach, describe, expect, it } from 'vitest';
import { TextIndex } from './text-index';

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  root.innerHTML = '<p>Hello <b>big</b> world</p><p>第二段</p><style>x{}</style>';
  document.body.appendChild(root);
});

describe('TextIndex（基准偏移 ↔ DOM 位置）', () => {
  it('节点起点、总长、纯文本（跳过 style）', () => {
    const t = new TextIndex(root);
    expect(t.total).toBe(18);
    expect(t.starts).toEqual([0, 6, 9, 15]);
    expect(t.text()).toBe('Hello big world第二段');
  });

  it('locate：偏移 → 节点内位置；节点交界取后一个，end=true 取前一个', () => {
    const t = new TextIndex(root);
    expect(t.locate(2)).toMatchObject({ offset: 2 });
    expect(t.locate(2)!.node.data).toBe('Hello ');
    expect(t.locate(6)!.node.data).toBe('big');
    expect(t.locate(6)!.offset).toBe(0);
    const e = t.locate(6, true)!;
    expect(e.node.data).toBe('Hello ');
    expect(e.offset).toBe(6);
    expect(t.locate(18, true)!.node.data).toBe('第二段');
    expect(t.locate(999)!.offset).toBe(3); // 越界截到末尾
  });

  it('range / offsetsOfRange 互逆，跨节点', () => {
    const t = new TextIndex(root);
    const r = t.range(3, 12)!;
    expect(r.toString()).toBe('lo big wo');
    expect(t.offsetsOfRange(r)).toEqual({ start: 3, end: 12 });
    expect(t.offsetOfText(t.nodes[3], 1)).toBe(16);
    expect(t.offsetOfText(document.createTextNode('x'), 0)).toBe(-1);
  });

  it('offsetOfPoint：元素容器边界按子节点之前计', () => {
    const t = new TextIndex(root);
    const p2 = root.querySelectorAll('p')[1];
    expect(t.offsetOfPoint(p2, 0)).toBe(15);
    expect(t.offsetOfPoint(p2, 1)).toBe(18);
    expect(t.offsetOfPoint(root, 1)).toBe(15);
    expect(t.offsetOfPoint(root, 99)).toBe(18);
  });

  it('不等长替换（名字替换）：偏移始终以原文为基准', () => {
    const t = new TextIndex(root);
    // 「Hello 」整个节点被替换成显示文本 'Hi everyone ' ；原文 [2,4) 在显示里映射到被替换段的一端
    const node = t.nodes[0];
    node.data = 'Hi everyone ';
    t.setReplacements(0, [{ os: 0, oe: 5, ds: 0, de: 11 }]);
    expect(t.text()).toBe('Hello big world第二段'); // 原文不变
    // 原文 5（替换段之后）→ 显示 11
    expect(t.locate(5)!.offset).toBe(11);
    // 显示 11 → 原文 5
    expect(t.offsetOfText(node, 11)).toBe(5);
    // 替换段内部：靠前半段取原文起点，靠后半段取终点
    expect(t.offsetOfText(node, 2)).toBe(0);
    expect(t.offsetOfText(node, 9)).toBe(5);
    // 区间 [0,5) 对应整个替换后的文字
    expect(t.range(0, 5)!.toString()).toBe('Hi everyone');
  });
});
