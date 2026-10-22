// 界面语言默认值：一律简体中文，不看浏览器语言；只有手动选过英文的才是英文。
import { afterEach, describe, expect, it, vi } from 'vitest';

async function freshAppSettings(stored?: unknown) {
  vi.resetModules();
  localStorage.clear();
  if (stored) localStorage.setItem('mr.settings.v1', JSON.stringify(stored));
  return (await import('./app-settings')).appSettings;
}

describe('界面语言默认值', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('英文浏览器首次打开也是简体中文', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    expect((await freshAppSettings()).get().language).toBe('zh');
  });

  it('老用户：存过别的设置、但没手动选过语言 → 中文', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    const s = await freshAppSettings({ app: { serverUrl: 'http://x' }, 'library.shelf': { sortBy: 2 } });
    expect(s.get().language).toBe('zh');
  });

  it('手动选过英文的保持英文', async () => {
    expect((await freshAppSettings({ app: { language: 'en' } })).get().language).toBe('en');
  });
});
