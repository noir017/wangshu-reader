import { beforeEach, describe, expect, it } from 'vitest';
import { textSettings, themeSettings } from '@/reader/settings';
import { uiSettings } from '../ui-settings';
import { BUILTIN_THEMES, DAY_THEME, NIGHT_THEME, TEMP_THEME, argbToHex, sortThemeNames } from './builtin';
import {
  autoThemeDecision,
  curThemeHash,
  cycleThemes,
  deleteTheme,
  getTheme,
  getThemeOfBook,
  isWhiteFont,
  loadTheme,
  loadThemeForBook,
  renameTheme,
  saveTheme,
  setDayNightTheme,
  themeList,
} from './theme-manager';

beforeEach(() => {
  textSettings.reset();
  themeSettings.reset();
  uiSettings.reset();
});

describe('内置 14 套主题（THEME-001，spec §5.2）', () => {
  it('共 14 套，名称与顺序正确', () => {
    expect(BUILTIN_THEMES.map((t) => t.name).sort()).toHaveLength(14);
    expect(themeList().map((t) => t.name)).toEqual([
      'Day Theme',
      'Night Theme',
      'Day 1',
      'Day 2',
      'Day 3',
      'Night 1 (True black)',
      'Night 2',
      'Night 3',
      'Outdoor (Pure white)',
      'nature',
      'pro 1',
      'pro 2',
      'pro 3',
      'pro 4',
    ]);
  });

  it('有符号 ARGB → #RRGGBB（取值照 spec 的 ARGB 原值）', () => {
    expect(argbToHex(-16777216)).toBe('#000000');
    expect(argbToHex(-1)).toBe('#FFFFFF');
    expect(argbToHex(-2304047)).toBe('#DCD7D1');
    expect(argbToHex(-3355444)).toBe('#CCCCCC');
    expect(argbToHex(-15132391)).toBe('#191919');
    expect(argbToHex(-16118765)).toBe('#0A0C13');
    expect(argbToHex(-13286062)).toBe('#354552');
    expect(argbToHex(-1643825)).toBe('#E6EACF');
    expect(argbToHex(-16241326)).toBe('#082D52');
    expect(argbToHex(-11909831)).toBe('#4A4539');
    expect(argbToHex(-4339256)).toBe('#BDC9C8');
  });

  const byName = (n: string) => BUILTIN_THEMES.find((t) => t.name === n)!;
  it('颜色、背景图取值（逐套核对 §5.2）', () => {
    const want: Record<string, [boolean, string, string | undefined, number]> = {
      'Day Theme': [true, 'tex:day161', '#DCD7D1', -16777216],
      'Night Theme': [true, 'tex:night161', '#000000', -3355444],
      'Day 1': [true, 'tex:readbg_13', undefined, -16777216],
      'Day 2': [true, 'tex:readbg_14', undefined, -16777216],
      'Day 3': [true, 'tex:readbg_11', undefined, -15132391],
      'Night 1 (True black)': [false, '', '#000000', -1],
      'Night 2': [true, 'tex:readbg223', undefined, -16777216],
      'Night 3': [false, '', '#0A0C13', -13286062],
      'Outdoor (Pure white)': [false, '', '#FFFFFF', -16777216],
      nature: [true, 'tex:readbg201', '#E6EACF', -16241326],
      'pro 1': [true, 'tex:readbg203', undefined, -11909831],
      'pro 2': [true, 'tex:readbg204', undefined, -11909831],
      'pro 3': [true, 'tex:readbg221', undefined, -4339256],
      'pro 4': [true, 'tex:readbg222', undefined, -4339256],
    };
    for (const [name, [useImg, img, bg, font]] of Object.entries(want)) {
      const t = byName(name);
      expect(t.useBackgroundImage, name).toBe(useImg);
      expect(t.backgroundImage, name).toBe(img);
      expect(t.backgroundColor, name).toBe(bg);
      expect(t.fontColor, name).toBe(argbToHex(font));
    }
  });

  it('只有 nature 带字体排版样式（pFontName 存在），其余是仅颜色主题', () => {
    const withStyle = BUILTIN_THEMES.filter((t) => t.style).map((t) => t.name);
    expect(withStyle).toEqual(['nature']);
    expect(byName('nature').style).toMatchObject({ fontSize: 16, fontShadow: true, lineSpace: 3, fontBold: false, fontItalic: false, textJustified: false });
  });

  it('列表排序：Day/Night Theme 在前，其余 ASCII 序（大写先于小写）', () => {
    expect(sortThemeNames(['pro 1', 'nature', 'Night Theme', 'Day 1', 'Day Theme', 'Outdoor (Pure white)'])).toEqual(['Day Theme', 'Night Theme', 'Day 1', 'Outdoor (Pure white)', 'nature', 'pro 1']);
  });
});

describe('载入主题（A.loadTheme）', () => {
  it('默认只改颜色（loadThemeWithColorOnly=true）：字号等保持不变', () => {
    textSettings.set({ fontSize: 22 });
    expect(loadTheme('nature')).toBe(true);
    const t = textSettings.get();
    expect(t.fontColor).toBe('#082D52');
    expect(t.useBackgroundImage).toBe(true);
    expect(t.backgroundImage).toBe('tex:readbg201');
    expect(t.fontSize).toBe(22);
    expect(themeSettings.get().lastTheme).toBe('nature');
  });

  it('关闭「只更改颜色」后，带样式的主题连字体排版一起载入', () => {
    themeSettings.set({ loadThemeWithColorOnly: false });
    textSettings.set({ fontSize: 22, fontShadow: false });
    loadTheme('nature');
    expect(textSettings.get().fontSize).toBe(16);
    expect(textSettings.get().fontShadow).toBe(true);
  });

  it('不带样式的主题即使关闭「只更改颜色」也不动字体排版', () => {
    themeSettings.set({ loadThemeWithColorOnly: false });
    textSettings.set({ fontSize: 22 });
    loadTheme('Night Theme');
    expect(textSettings.get().fontSize).toBe(22);
  });

  it('缺省背景色的主题保持当前背景色（只写图的主题）', () => {
    textSettings.set({ backgroundColor: '#123456' });
    loadTheme('Day 1');
    expect(textSettings.get().backgroundColor).toBe('#123456');
    expect(textSettings.get().backgroundImage).toBe('tex:readbg_13');
  });

  it('不存在的主题返回 false，设置不变', () => {
    const before = textSettings.get().fontColor;
    expect(loadTheme('nope')).toBe(false);
    expect(textSettings.get().fontColor).toBe(before);
  });

  it('夜间态：载入夜间主题 → nightMode=true；白天主题 → false；浅字色（深底）视为夜间', () => {
    loadTheme(NIGHT_THEME);
    expect(themeSettings.get().nightMode).toBe(true);
    loadTheme(DAY_THEME);
    expect(themeSettings.get().nightMode).toBe(false);
    loadTheme('Night 1 (True black)');
    expect(themeSettings.get().nightMode).toBe(true);
    expect(isWhiteFont('#FFFFFF')).toBe(true);
    expect(isWhiteFont('#707070')).toBe(false); // R+G+B = 336 ≤ 355
  });
});

describe('日夜一键切换 cycleThemes（THEME-002）', () => {
  it('Day → Night → Day 循环', () => {
    loadTheme(DAY_THEME);
    expect(cycleThemes()).toBe(NIGHT_THEME);
    expect(themeSettings.get().lastTheme).toBe(NIGHT_THEME);
    expect(cycleThemes()).toBe(DAY_THEME);
    expect(cycleThemes()).toBe(NIGHT_THEME);
  });

  it('当前是自定义主题：暂存为临时主题 → 去夜间 → 去白天 → 回到自定义', () => {
    textSettings.set({ fontColor: '#336699', backgroundColor: '#ffeecc', useBackgroundImage: false });
    expect(cycleThemes()).toBe(NIGHT_THEME);
    expect(getTheme(TEMP_THEME)?.data.fontColor).toBe('#336699');
    expect(cycleThemes()).toBe(DAY_THEME);
    expect(cycleThemes()).toBe(TEMP_THEME);
    expect(textSettings.get().fontColor).toBe('#336699');
    expect(textSettings.get().backgroundColor).toBe('#ffeecc');
    expect(cycleThemes()).toBe(NIGHT_THEME);
  });

  it('临时主题等同日夜主题时直接去夜间', () => {
    loadTheme(DAY_THEME);
    saveTheme(TEMP_THEME); // 临时主题 = 当前（白天）
    expect(cycleThemes()).toBe(NIGHT_THEME);
  });

  it('书专属主题（名称=书文件名）：白天 → 专属 → 夜间', () => {
    loadTheme(DAY_THEME);
    textSettings.set({ fontColor: '#aa0000', useBackgroundImage: false, backgroundColor: '#fafafa' });
    saveTheme('book.epub');
    loadTheme(DAY_THEME);
    expect(getThemeOfBook('book.epub')?.name).toBe('book.epub');
    expect(cycleThemes('book.epub')).toBe('book.epub');
    expect(textSettings.get().fontColor).toBe('#aa0000');
    expect(cycleThemes('book.epub')).toBe(NIGHT_THEME);
  });

  it('自定义「白天/夜间主题」目标', () => {
    setDayNightTheme('night', 'Night 1 (True black)');
    loadTheme(DAY_THEME);
    expect(cycleThemes()).toBe('Night 1 (True black)');
    expect(textSettings.get().fontColor).toBe('#FFFFFF');
  });

  it('打开有专属主题的书：载入专属主题并暂存当前', () => {
    textSettings.set({ fontColor: '#00aa00', backgroundColor: '#eeffee', useBackgroundImage: false });
    saveTheme('x.txt');
    loadTheme(NIGHT_THEME);
    expect(loadThemeForBook('x.txt')).toBe(true);
    expect(textSettings.get().fontColor).toBe('#00aa00');
    expect(getTheme(TEMP_THEME)?.data.fontColor).toBe('#CCCCCC');
    expect(loadThemeForBook('none.txt')).toBe(false);
  });

  it('curThemeHash 反映当前颜色', () => {
    loadTheme(DAY_THEME);
    const a = curThemeHash();
    textSettings.set({ fontColor: '#123456' });
    expect(curThemeHash()).not.toBe(a);
  });
});

describe('主题管理：保存 / 删除 / 改名（THEME-003）', () => {
  it('保存当前为用户主题，出现在列表末尾并覆盖同名', () => {
    textSettings.set({ fontColor: '#111111', fontSize: 19 });
    saveTheme('Mine');
    expect(themeList().at(-1)?.name).toBe('Mine');
    expect(getTheme('Mine')?.data.style?.fontSize).toBe(19);
    textSettings.set({ fontColor: '#222222' });
    saveTheme('Mine');
    expect(getTheme('Mine')?.data.fontColor).toBe('#222222');
    expect(themeList().filter((t) => t.name === 'Mine')).toHaveLength(1);
  });

  it('保存后载入：关闭「只更改颜色」才带上字体排版', () => {
    textSettings.set({ fontColor: '#111111', fontSize: 19 });
    saveTheme('Mine');
    textSettings.set({ fontSize: 30 });
    loadTheme('Mine');
    expect(textSettings.get().fontSize).toBe(30);
    themeSettings.set({ loadThemeWithColorOnly: false });
    loadTheme('Mine');
    expect(textSettings.get().fontSize).toBe(19);
  });

  it('Day/Night Theme 不可删除、不可改名', () => {
    expect(deleteTheme(DAY_THEME)).toBe('protected');
    expect(deleteTheme(NIGHT_THEME)).toBe('protected');
    expect(renameTheme(DAY_THEME, 'x')).toBe('protected');
    expect(themeList()).toHaveLength(14);
  });

  it('删除用户主题与内置主题（内置用隐藏表示）', () => {
    saveTheme('Mine');
    expect(deleteTheme('Mine')).toBe('ok');
    expect(getTheme('Mine')).toBeUndefined();
    expect(deleteTheme('pro 1')).toBe('ok');
    expect(themeList().map((t) => t.name)).not.toContain('pro 1');
    // 同名重新保存后恢复显示
    saveTheme('pro 1');
    expect(themeList().map((t) => t.name)).toContain('pro 1');
  });

  it('改名：去特殊字符、重名拒绝、内置主题可改名并同步引用', () => {
    expect(renameTheme('pro 2', 'My Pro')).toBe('ok');
    expect(getTheme('My Pro')?.data.backgroundImage).toBe('tex:readbg204');
    expect(themeList().map((t) => t.name)).not.toContain('pro 2');
    expect(renameTheme('pro 3', 'Day 1')).toBe('exists');
    expect(renameTheme('pro 3', '  ')).toBe('invalid');
    expect(renameTheme('nope', 'z')).toBe('missing');
    saveTheme('A');
    expect(renameTheme('A', 'a/b:c')).toBe('ok');
    expect(getTheme('abc')).toBeDefined();
  });

  it('临时主题不出现在列表里', () => {
    saveTheme(TEMP_THEME);
    expect(themeList().map((t) => t.name)).not.toContain(TEMP_THEME);
  });
});

describe('自动日夜 autoThemeDecision（THEME-004，AT.setAutoThemeHandler）', () => {
  const s = { autoThemeDay: true, autoThemeNight: true, autoThemeDayTime: 600, autoThemeNightTime: 2200 };
  const at = (h: number, m = 0, d = 21) => new Date(2026, 9, d, h, m, 0);
  const last = (h: number, d = 20) => new Date(2026, 9, d, h, 0, 0).getTime();

  it('白天窗口 [06:00, 17:00) 且上次阅读不在 5–17 点 → 切白天', () => {
    expect(autoThemeDecision(at(8), last(22), s)).toBe(1);
    expect(autoThemeDecision(at(12), last(23), s)).toBe(1);
    expect(autoThemeDecision(at(6, 1), last(3), s)).toBe(1);
  });
  it('上次阅读本来就在白天 → 不动', () => {
    expect(autoThemeDecision(at(8), last(10), s)).toBe(0);
    expect(autoThemeDecision(at(8), last(5), s)).toBe(0);
    expect(autoThemeDecision(at(8), last(17), s)).toBe(0);
  });
  it('没有阅读记录时不强制切白天', () => {
    expect(autoThemeDecision(at(8), 0, s)).toBe(0);
  });
  it('夜间窗口 [22:00, 次日 05:00) → 切夜间', () => {
    expect(autoThemeDecision(at(23), last(12), s)).toBe(-1);
    expect(autoThemeDecision(at(22, 1), last(12), s)).toBe(-1);
    expect(autoThemeDecision(at(3), last(12), s)).toBe(-1);
    expect(autoThemeDecision(at(4, 59), last(12), s)).toBe(-1);
  });
  it('窗口之外 → 不动', () => {
    expect(autoThemeDecision(at(19), last(12), s)).toBe(0);
    expect(autoThemeDecision(at(5, 30), last(12), s)).toBe(0);
    expect(autoThemeDecision(at(17, 30), last(23), s)).toBe(0);
  });
  it('开关与自定义时间', () => {
    expect(autoThemeDecision(at(8), last(22), { ...s, autoThemeDay: false })).toBe(0);
    expect(autoThemeDecision(at(23), last(12), { ...s, autoThemeNight: false })).toBe(0);
    expect(autoThemeDecision(at(7), last(22), { ...s, autoThemeDayTime: 730 })).toBe(0);
    expect(autoThemeDecision(at(8), last(22), { ...s, autoThemeDayTime: 730 })).toBe(1);
    expect(autoThemeDecision(at(20, 30), last(12), { ...s, autoThemeNightTime: 2000 })).toBe(-1);
  });
});
