import { beforeEach, describe, expect, it } from 'vitest';
import { convertKeepLength, hideBlankLines, replaceNames } from './transforms';

describe('名字替换（MISC-002）', () => {
  it('字面替换，登记分段映射', () => {
    const r = replaceNames('孔子说：孔子云', [{ from: '孔子', to: '孔夫子' }])!;
    expect(r.text).toBe('孔夫子说：孔夫子云');
    expect(r.segs).toEqual([
      { os: 0, oe: 2, ds: 0, de: 3 },
      { os: 4, oe: 6, ds: 5, de: 8 },
    ]);
  });
  it('正则 + 捕获组；写错的正则被忽略；disabled 的规则不生效', () => {
    expect(replaceNames('abc123', [{ from: '(\\d+)', to: '<$1>', regex: true }])!.text).toBe('abc<123>');
    expect(replaceNames('abc', [{ from: '(', to: 'x', regex: true }])).toBeNull();
    expect(replaceNames('abc', [{ from: 'a', to: 'x', enabled: false }])).toBeNull();
    expect(replaceNames('abc', [{ from: '', to: 'x' }])).toBeNull();
  });
  it('字面量里的正则元字符被转义', () => {
    expect(replaceNames('a.b a+b', [{ from: 'a.b', to: 'X' }])!.text).toBe('X a+b');
  });
  it('重叠匹配：最早的赢，不重叠', () => {
    const r = replaceNames('abcd', [{ from: 'abc', to: '1' }, { from: 'bcd', to: '2' }])!;
    expect(r.text).toBe('1d');
  });
  it('没有匹配返回 null', () => {
    expect(replaceNames('hello', [{ from: 'zzz', to: 'x' }])).toBeNull();
  });
});

describe('简繁转换必须保持长度（MISC-001）', () => {
  it('等长结果直接用', () => {
    expect(convertKeepLength((s) => s.replace('谈', '談'), '谈笑')).toBe('談笑');
  });
  it('词组替换变长：退回逐字，仍不等长的字保持原样', () => {
    const conv = (s: string) => (s === '公文包' ? '公事包A' : s.replace(/文/g, '文文'));
    // 整体不等长 → 逐字：「文」被换成两个字，不等长，保持原样
    expect(convertKeepLength(conv, '公文包')).toBe('公文包');
  });
  it('空串', () => {
    expect(convertKeepLength((s) => s + 'x', '')).toBe('');
  });
});

describe('去空行（TYPO-009）：只隐藏，不改文本节点', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  it('空段落与连续 <br> 被标记隐藏；带图的块保留', () => {
    document.body.innerHTML = '<p>a</p><p> </p><p><img src="x"></p><div></div><p>b<br><br>c</p>';
    hideBlankLines(document);
    const ps = document.querySelectorAll('p');
    expect(ps[0].classList.contains('mr-hide')).toBe(false);
    expect(ps[1].classList.contains('mr-hide')).toBe(true);
    expect(ps[2].classList.contains('mr-hide')).toBe(false);
    expect(document.querySelector('div')!.classList.contains('mr-hide')).toBe(true);
    const brs = document.querySelectorAll('br');
    expect(brs[0].classList.contains('mr-hide')).toBe(false);
    expect(brs[1].classList.contains('mr-hide')).toBe(true);
  });
});
