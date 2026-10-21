import { describe, expect, it } from 'vitest';
import { placeNear } from './position';

const vp = { width: 400, height: 800 };
const size = { width: 200, height: 100 };

describe('placeNear', () => {
  it('上方空间够就放上面，居中对齐锚点', () => {
    const p = placeNear({ left: 100, right: 200, top: 400, bottom: 420 }, size, vp, { prefer: 'above' });
    expect(p.side).toBe('above');
    expect(p.top).toBe(400 - 8 - 100);
    expect(p.left).toBe(50);
  });
  it('上方不够翻到下方', () => {
    const p = placeNear({ left: 100, right: 200, top: 50, bottom: 70 }, size, vp, { prefer: 'above' });
    expect(p.side).toBe('below');
    expect(p.top).toBe(78);
  });
  it('左右夹在视口内、上下夹在视口内', () => {
    const p = placeNear({ left: 380, right: 400, top: 790, bottom: 800 }, size, vp);
    expect(p.left).toBe(400 - 200 - 6);
    expect(p.top).toBeLessThanOrEqual(800 - 100 - 6);
    expect(placeNear({ left: 0, right: 10, top: 300, bottom: 310 }, size, vp).left).toBe(6);
  });
  it('auto：优先下方（不遮挡阅读起点）', () => {
    expect(placeNear({ left: 100, right: 200, top: 300, bottom: 320 }, size, vp).side).toBe('below');
  });
});
