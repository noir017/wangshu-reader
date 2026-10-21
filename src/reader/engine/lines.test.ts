import { describe, expect, it } from 'vitest';
import { estimatePage, estimatePages, lastPageTop, lastShownLine, lineAt, mergeBoxes, nextPageTop, oneLineTag, pageClipHeight, prevPageTop, snapToLineTop, type LineBox } from './lines';

/** n 行，每行 20px 高，从 y=0 开始 */
const mk = (n: number, h = 20): LineBox[] => Array.from({ length: n }, (_, i) => ({ top: i * h, bottom: (i + 1) * h }));

describe('oneLineTag（A.oneLineTag）', () => {
  it('行距 <0：1 − lineSpace/10，封顶 1', () => {
    expect(oneLineTag(-5, false)).toBe(1);
    expect(oneLineTag(-2, true)).toBeCloseTo(1, 5);
    expect(oneLineTag(-0.5, false)).toBeCloseTo(1, 5);
  });
  it('行距 >=0：(≥2 ? .75 : .82) + (亚洲 .1 : .08)', () => {
    expect(oneLineTag(3, true)).toBeCloseTo(0.85, 5);
    expect(oneLineTag(3, false)).toBeCloseTo(0.83, 5);
    expect(oneLineTag(1, true)).toBeCloseTo(0.92, 5);
    expect(oneLineTag(0, false)).toBeCloseTo(0.9, 5);
  });
});

describe('整行翻页', () => {
  it('窗口底边不切行：页高 100 恰好 5 行', () => {
    const lines = mk(30);
    expect(nextPageTop(lines, 0, 100, 0.85)).toBe(100);
    expect(nextPageTop(lines, 100, 100, 0.85)).toBe(200);
  });
  it('露出不足 oneLineTag 的行顺延到下一页', () => {
    const lines = mk(30);
    // 页高 110：第 6 行（100..120）只露出 10/20=0.5 < 0.85 → 下一页从第 6 行起
    expect(nextPageTop(lines, 0, 110, 0.85)).toBe(100);
    // 页高 118：露出 18/20=0.9 ≥ 0.85 → 算显示，下一页从第 7 行起
    expect(nextPageTop(lines, 0, 118, 0.85)).toBe(120);
  });
  it('ink 字形盒优先：行盒虽然超出，只要字形被盖住就算显示', () => {
    const lines: LineBox[] = [
      { top: 0, bottom: 20, ink: 16 },
      { top: 20, bottom: 40, ink: 36 },
    ];
    expect(lastShownLine(lines, 0, 38, 0.85)).toBe(1);
    expect(lastShownLine(lines, 0, 30, 0.85)).toBe(0);
  });
  it('图片等不可拆分块必须整块落进窗口', () => {
    const lines: LineBox[] = [{ top: 0, bottom: 20 }, { top: 20, bottom: 220, atomic: true }, { top: 220, bottom: 240 }];
    expect(lastShownLine(lines, 0, 100, 0.85)).toBe(0);
    expect(nextPageTop(lines, 0, 100, 0.85)).toBe(20);
    expect(lastShownLine(lines, 20, 250, 0.85)).toBe(2);
  });
  it('章末返回 null', () => {
    const lines = mk(8);
    expect(nextPageTop(lines, 0, 100, 0.85)).toBe(100);
    expect(nextPageTop(lines, 100, 100, 0.85)).toBeNull();
  });
  it('keepOne：下一页首行 = 上页末行', () => {
    const lines = mk(30);
    expect(nextPageTop(lines, 0, 100, 0.85, true)).toBe(80);
  });
  it('向上翻页与向下互逆（整行页）', () => {
    const lines = mk(30);
    expect(prevPageTop(lines, 200, 100, 0.85)).toBe(100);
    expect(prevPageTop(lines, 100, 100, 0.85)).toBe(0);
    expect(prevPageTop(lines, 0, 100, 0.85)).toBeNull();
  });
  it('向上翻页：页高不是行高整数倍时，上一页末行必须保留', () => {
    const lines = mk(30);
    // 页高 110 → 每页 5 整行；从第 10 行(200)往回，应落在能装下第 9 行为页末的最靠前页顶
    const top = prevPageTop(lines, 200, 110, 0.85)!;
    expect(top).toBeLessThan(200);
    const last = lastShownLine(lines, top, 110, 0.85);
    expect(lines[last].bottom).toBeGreaterThanOrEqual(200 - 0.01);
  });
  it('章内最后一页的窗口顶', () => {
    const lines = mk(23);
    const top = lastPageTop(lines, 100, 0.85);
    expect(lastShownLine(lines, top, 100, 0.85)).toBe(22);
    expect(nextPageTop(lines, top, 100, 0.85)).toBeNull();
    expect(lastPageTop([], 100, 0.85)).toBe(0);
  });
  it('往返不丢行：连续向下再连续向上回到起点', () => {
    const lines = mk(57);
    const fwd: number[] = [0];
    for (let y: number | null = 0; (y = nextPageTop(lines, y, 130, 0.85)) !== null; ) fwd.push(y);
    const back: number[] = [fwd[fwd.length - 1]];
    for (let y: number | null = back[0]; (y = prevPageTop(lines, y, 130, 0.85)) !== null; ) back.push(y);
    expect(back[back.length - 1]).toBe(0);
    // 向上走过的每一页都没有跳过任何行：相邻页顶之间的行都能装进一页
    for (let i = 0; i + 1 < back.length; i++) expect(lastShownLine(lines, back[i + 1], 130, 0.85)).toBeGreaterThanOrEqual(lineAt(lines, back[i]) - 1);
  });
});

describe('行表', () => {
  it('mergeBoxes 把同一行的多个 inline 片段合并', () => {
    const out = mergeBoxes([
      { top: 0, bottom: 20, ink: 15 },
      { top: 2, bottom: 22, ink: 17 },
      { top: 20, bottom: 40, ink: 35 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].bottom).toBe(22);
    expect(out[0].ink).toBe(17);
  });
  it('不可拆分块吞掉与它重叠的行（表格行里交错的多行文字）', () => {
    const out = mergeBoxes([
      { top: 100, bottom: 170, atomic: true },
      { top: 101, bottom: 150, ink: 145, inkTop: 105 },
      { top: 130, bottom: 164, ink: 158, inkTop: 135 },
      { top: 170, bottom: 190, ink: 187, inkTop: 173 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ top: 100, bottom: 170, atomic: true });
    expect(out[1].top).toBe(170);
  });
  it('lineAt / snapToLineTop', () => {
    const lines = mk(10);
    expect(lineAt(lines, 0)).toBe(0);
    expect(lineAt(lines, 25)).toBe(1);
    expect(lineAt(lines, 500)).toBe(10);
    expect(snapToLineTop(lines, 25)).toBe(20);
    expect(snapToLineTop(lines, 5)).toBe(0);
    expect(snapToLineTop(lines, 9999)).toBe(180);
    expect(snapToLineTop([], 10)).toBe(0);
  });
});

describe('页码（STATUS-001 / §4.2）', () => {
  it('页数：整除时不多一页', () => {
    expect(estimatePages(1000, 100)).toBe(10);
    expect(estimatePages(1001, 100)).toBe(10);
    expect(estimatePages(1002, 100)).toBe(11);
    expect(estimatePages(1, 100)).toBe(1);
  });
  it('当前页 = floor(total·(y + H/5)/h)+1，末页强制 = total', () => {
    expect(estimatePage(0, 1000, 100, false)).toBe(1);
    expect(estimatePage(100, 1000, 100, false)).toBe(2);
    expect(estimatePage(900, 1000, 100, true)).toBe(10);
    expect(estimatePage(99999, 1000, 100, false)).toBe(10);
  });
});

describe('pageClipHeight：页底裁剪线', () => {
  it('普通行：裁到最后一个显示行的字形底', () => {
    const lines: LineBox[] = Array.from({ length: 30 }, (_, i) => ({ top: i * 20, bottom: i * 20 + 20, ink: i * 20 + 17, inkTop: i * 20 + 3 }));
    // 页高 100：第 5 行(80..100，ink 97) 显示；第 6 行(100..120) 的字形顶 103 在窗口外
    expect(pageClipHeight(lines, 0, 100, 0.85)).toBe(97);
    expect(pageClipHeight(lines, 0, 1000, 0.85)).toBeLessThanOrEqual(1000);
  });
  it('图片块：整块的底', () => {
    const lines: LineBox[] = [{ top: 0, bottom: 20, ink: 17, inkTop: 3 }, { top: 20, bottom: 120, atomic: true }, { top: 120, bottom: 140, ink: 137, inkTop: 123 }];
    expect(pageClipHeight(lines, 0, 130, 0.85)).toBe(120);
  });
  it('紧凑标题：下一行字形顶压进上一行字形底时，裁剪线退到下一行字形顶', () => {
    const lines: LineBox[] = [
      { top: 0, bottom: 50, ink: 44, inkTop: 2 },
      { top: 30, bottom: 64, ink: 56, inkTop: 36 }, // 字形顶 36 < 上一行字形底 44
    ];
    // 窗口 [0,48)：第 0 行 ink 44 ≤ 48 显示；第 1 行 top 30 < 48 但 ink 56 > 48 → 不显示
    expect(pageClipHeight(lines, 0, 48, 0.85)).toBe(36);
  });
  it('窗口之后没有行时返回整页高度', () => {
    expect(pageClipHeight([{ top: 0, bottom: 20 }], 500, 100, 0.85)).toBe(100);
  });
});
