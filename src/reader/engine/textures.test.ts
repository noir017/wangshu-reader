import { describe, expect, it } from 'vitest';
import { resolveBackground, textureById, TEXTURES, userImageBackground } from './textures';

describe('内置纹理清单', () => {
  it('id 唯一、以 tex: 开头、均色是合法十六进制、css 末层是均色', () => {
    expect(TEXTURES.length).toBeGreaterThanOrEqual(30);
    const ids = new Set<string>();
    for (const t of TEXTURES) {
      expect(t.id.startsWith('tex:')).toBe(true);
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      expect(t.avgColor).toMatch(/^#[0-9A-F]{6}$/i);
      expect(t.css.endsWith(t.avgColor)).toBe(true);
      expect(t.name).toBeTruthy();
    }
  });
  it('规格 §5.3 的小图实测均色', () => {
    expect(textureById('tex:page301')?.avgColor).toBe('#065C87');
    expect(textureById('page302')?.avgColor).toBe('#1F4742');
    expect(textureById('tex:nope')).toBeUndefined();
  });
  it('大图纹理带暗角，小图纹理带噪点', () => {
    expect(textureById('readbg_12')!.css).toContain('radial-gradient');
    expect(textureById('readbg_00')!.css).toContain('data:image/svg+xml');
  });
});

describe('背景解析（THEME-006）', () => {
  it('位图宽高都 <100 平铺，否则拉伸铺满', () => {
    expect(userImageBackground('u', 50, 50)).toContain('repeat');
    expect(userImageBackground('u', 99, 99)).toContain('repeat');
    expect(userImageBackground('u', 100, 50)).toContain('100% 100%');
    expect(userImageBackground('u', 50, 100)).toContain('100% 100%');
  });
  it('不用图 / 图 id 为空 / 找不到 → 纯色', async () => {
    expect(await resolveBackground({ useImage: false, image: 'tex:page301', color: '#123456' })).toBe('#123456');
    expect(await resolveBackground({ useImage: true, image: '', color: '#123456' })).toBe('#123456');
    expect(await resolveBackground({ useImage: true, image: 'tex:nope', color: '#123456' })).toBe('#123456');
    expect(await resolveBackground({ useImage: true, image: 'img:missing', color: '#123456' })).toBe('#123456');
  });
  it('内置纹理 → 它的 css', async () => {
    const css = await resolveBackground({ useImage: true, image: 'tex:readbg_12', color: '#000' });
    expect(css).toBe(textureById('readbg_12')!.css);
  });
});
