import { beforeEach, describe, expect, it, vi } from 'vitest';
import { putFont } from '@/storage/db';
import { ensureFont, warnFontFailed } from './fonts';

const toast = vi.fn();
vi.mock('@/ui', async (orig) => ({ ...(await orig<typeof import('@/ui')>()), toast: (...a: unknown[]) => toast(...a) }));

beforeEach(() => toast.mockClear());

describe('字体降级（集成缺口 A6：/api/fonts 会列出 .ttc，@font-face 加载失败要降级并提示）', () => {
  it('内置字体族直接可用', async () => {
    expect(await ensureFont('serif')).toBe('serif');
    expect(await ensureFont('')).toBe('serif');
    expect(await ensureFont('Noto Sans')).toBe('"Noto Sans", serif');
  });

  it('用户字体解码失败：回退 serif，只提示一次，.ttc 给出转换建议', async () => {
    // happy-dom 没有 FontFace，等同于浏览器解码失败
    await putFont({ id: 'ttc1', family: '宋体集合', fileName: 'simsun.ttc', blob: new Blob([new Uint8Array([0x74, 0x74, 0x63, 0x66])]), addedAt: 1 });
    expect(await ensureFont('font:ttc1')).toBe('serif');
    expect(await ensureFont('font:ttc1')).toBe('serif');
    expect(toast).toHaveBeenCalledTimes(1);
    expect(String(toast.mock.calls[0][0])).toContain('宋体集合');
    expect(String(toast.mock.calls[0][0])).toContain('.ttc');
  });

  it('quiet：只为渲染示例预载时失败不打扰', async () => {
    await putFont({ id: 'ttc2', family: '黑体集合', fileName: 'hei.ttc', blob: new Blob([]), addedAt: 2 });
    expect(await ensureFont('font:ttc2', { quiet: true })).toBe('serif');
    expect(toast).not.toHaveBeenCalled();
  });

  it('找不到的字体记录回退 serif', async () => {
    expect(await ensureFont('font:nope')).toBe('serif');
  });

  it('非 ttc 字体失败的提示不带 ttc 建议', () => {
    expect(warnFontFailed('k-ttf', 'Foo', 'foo.ttf')).toBe('serif');
    expect(String(toast.mock.calls[0][0])).not.toContain('.ttc');
  });
});
