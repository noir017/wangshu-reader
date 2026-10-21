// 主题管理：载入/保存/删除/改名、日夜一键切换（THEME-001..003）、自动日夜判定（THEME-004）。
// 数据在 themeSettings.userThemes（用户保存的）+ builtin.ts（内置 14 套）；用户同名主题覆盖内置。
import { textSettings, themeSettings, THEME_KEYS } from '@/reader/settings';
import { uiSettings } from '../ui-settings';
import { BUILTIN_THEMES, DAY_THEME, NIGHT_THEME, TEMP_THEME, sortThemeNames, type ThemeData, type ThemeStyleKey } from './builtin';

type ThemeKey = (typeof THEME_KEYS)[number];
type UserTheme = Partial<Record<ThemeKey, unknown>>;

const STYLE_KEYS: ThemeStyleKey[] = THEME_KEYS.filter(
  (k): k is ThemeStyleKey => k !== 'fontColor' && k !== 'backgroundColor' && k !== 'useBackgroundImage' && k !== 'backgroundImage',
);

export interface ThemeEntry {
  name: string;
  data: ThemeData;
  builtin: boolean;
}

/** R+G+B > 355：原 A.isWhiteFont（驱动夜间判断） */
export function isWhiteFont(hex: string): boolean {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return false;
  return parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16) > 355;
}

export function colorValue(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  return m ? parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16) : 0;
}

function userToData(u: UserTheme): ThemeData {
  const hasStyle = typeof u.fontName === 'string' && u.fontName !== 'false' && u.fontName !== '';
  const style: Partial<Record<ThemeStyleKey, unknown>> = {};
  if (hasStyle) for (const k of STYLE_KEYS) if (u[k] !== undefined) style[k] = u[k];
  return {
    fontColor: typeof u.fontColor === 'string' ? u.fontColor : textSettings.get().fontColor,
    backgroundColor: typeof u.backgroundColor === 'string' ? u.backgroundColor : undefined,
    useBackgroundImage: u.useBackgroundImage === true,
    backgroundImage: typeof u.backgroundImage === 'string' ? u.backgroundImage : '',
    style: hasStyle ? style : undefined,
  };
}

function dataToUser(d: ThemeData): UserTheme {
  const u: UserTheme = {
    fontColor: d.fontColor,
    useBackgroundImage: d.useBackgroundImage,
    backgroundImage: d.backgroundImage,
  };
  if (d.backgroundColor !== undefined) u.backgroundColor = d.backgroundColor;
  if (d.style) Object.assign(u, d.style);
  return u;
}

function builtinMap(): Map<string, ThemeData> {
  return new Map(BUILTIN_THEMES.map((b) => [b.name, b]));
}

export function isProtectedTheme(name: string): boolean {
  return name === DAY_THEME || name === NIGHT_THEME;
}

/** 当前全部主题（不含临时主题与已被用户删除的内置主题），顺序同原 app */
export function themeList(): ThemeEntry[] {
  const user = themeSettings.get().userThemes;
  const hidden = new Set(uiSettings.get().hiddenThemes);
  const builtins = builtinMap();
  const names = new Set<string>();
  for (const n of builtins.keys()) if (!hidden.has(n)) names.add(n);
  for (const n of Object.keys(user)) if (n !== TEMP_THEME) names.add(n);
  return sortThemeNames([...names]).map((name) => {
    const u = user[name];
    return u ? { name, data: userToData(u), builtin: builtins.has(name) } : { name, data: builtins.get(name)!, builtin: true };
  });
}

/** 按名取主题（含临时主题） */
export function getTheme(name: string): ThemeEntry | undefined {
  const user = themeSettings.get().userThemes[name];
  const b = builtinMap().get(name);
  if (user) return { name, data: userToData(user), builtin: !!b };
  if (b && !uiSettings.get().hiddenThemes.includes(name)) return { name, data: b, builtin: true };
  return undefined;
}

/** 日夜切换用的白天/夜间主题（设置里存名字，找不到时回退内置） */
export function dayNightThemes(): { day: ThemeEntry; night: ThemeEntry } {
  const s = themeSettings.get();
  const day = getTheme(s.dayTheme) ?? getTheme(DAY_THEME) ?? { name: DAY_THEME, data: BUILTIN_THEMES[0], builtin: true };
  const night = getTheme(s.nightTheme) ?? getTheme(NIGHT_THEME) ?? { name: NIGHT_THEME, data: BUILTIN_THEMES[1], builtin: true };
  return { day, night };
}

/** 当前主题的指纹（A.getCurThemeHash）：只改颜色时只比较颜色，否则连字体排版一起比 */
export function curThemeHash(): string {
  const t = textSettings.get();
  const style = themeSettings.get().loadThemeWithColorOnly ? '' : STYLE_KEYS.map((k) => String(t[k])).join('|');
  return `${style}#${t.fontColor}#${t.useBackgroundImage ? t.backgroundImage : t.backgroundColor}`;
}

/** 载入该主题后会得到的指纹（缺省字段取当前值，所以与 curThemeHash 可直接比较） */
export function themeHash(d: ThemeData): string {
  const t = textSettings.get();
  const style = themeSettings.get().loadThemeWithColorOnly
    ? ''
    : STYLE_KEYS.map((k) => String(d.style && d.style[k] !== undefined ? d.style[k] : t[k])).join('|');
  const bg = d.useBackgroundImage ? d.backgroundImage : (d.backgroundColor ?? t.backgroundColor);
  return `${style}#${d.fontColor}#${bg}`;
}

/** UI 是否切深色：夜间主题，或字色偏白（深底） */
export function computeNight(name: string, d: ThemeData): boolean {
  return name === themeSettings.get().nightTheme || isWhiteFont(d.fontColor);
}

export interface LoadOpts {
  /** 本次强制只改颜色 */
  colorOnly?: boolean;
  /** 书专属主题：无视「只更改颜色」开关，完整载入 */
  forceFull?: boolean;
}

/** A.loadTheme：总是载入颜色与背景；字体排版仅在 !(colorOnly || 设置开关 || 主题本身不带样式) 时载入 */
export function loadTheme(name: string, opts: LoadOpts = {}): boolean {
  const e = getTheme(name);
  if (!e) return false;
  const d = e.data;
  const patch: Record<string, unknown> = {
    fontColor: d.fontColor,
    useBackgroundImage: d.useBackgroundImage,
    backgroundImage: d.backgroundImage,
  };
  if (d.backgroundColor !== undefined) patch.backgroundColor = d.backgroundColor;
  const skip = !opts.forceFull && (opts.colorOnly || themeSettings.get().loadThemeWithColorOnly || !d.style);
  if (!skip && d.style) Object.assign(patch, d.style);
  textSettings.set(patch);
  themeSettings.set({ lastTheme: name, nightMode: computeNight(name, d) });
  return true;
}

/** A.saveTheme：把当前 19 个主题字段存成同名用户主题（同名覆盖） */
export function saveTheme(name: string): void {
  const t = textSettings.get();
  const u: UserTheme = {};
  for (const k of THEME_KEYS) u[k] = t[k];
  themeSettings.set({ userThemes: { ...themeSettings.get().userThemes, [name]: u } });
  if (uiSettings.get().hiddenThemes.includes(name)) uiSettings.set({ hiddenThemes: uiSettings.get().hiddenThemes.filter((n) => n !== name) });
}

export function themeExists(name: string): boolean {
  return !!getTheme(name) && name !== TEMP_THEME;
}

export type ThemeOpResult = 'ok' | 'protected' | 'missing' | 'exists' | 'invalid';

export function deleteTheme(name: string): ThemeOpResult {
  if (isProtectedTheme(name)) return 'protected';
  const s = themeSettings.get();
  const rest = { ...s.userThemes };
  delete rest[name];
  themeSettings.set({ userThemes: rest });
  if (builtinMap().has(name) && !uiSettings.get().hiddenThemes.includes(name)) uiSettings.set({ hiddenThemes: [...uiSettings.get().hiddenThemes, name] });
  return 'ok';
}

/** 去掉主题名里的特殊字符（T.deleteSpecialChar） */
export function cleanThemeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\r\n]/g, '').trim();
}

export function renameTheme(oldName: string, newName: string): ThemeOpResult {
  if (isProtectedTheme(oldName)) return 'protected';
  const nn = cleanThemeName(newName);
  if (!nn) return 'invalid';
  if (nn === oldName) return 'ok';
  const e = getTheme(oldName);
  if (!e) return 'missing';
  if (themeExists(nn)) return 'exists';
  const s = themeSettings.get();
  const users = { ...s.userThemes, [nn]: dataToUser(e.data) };
  delete users[oldName];
  const patch: Partial<ReturnType<typeof themeSettings.get>> = { userThemes: users };
  if (s.lastTheme === oldName) patch.lastTheme = nn;
  if (s.dayTheme === oldName) patch.dayTheme = nn;
  if (s.nightTheme === oldName) patch.nightTheme = nn;
  themeSettings.set(patch);
  if (builtinMap().has(oldName) && !uiSettings.get().hiddenThemes.includes(oldName)) uiSettings.set({ hiddenThemes: [...uiSettings.get().hiddenThemes, oldName] });
  return 'ok';
}

/** 「─> 白天模式 / ─> 晚上模式」：把某主题设为日/夜切换的目标（原版是覆盖 Day/Night Theme 文件） */
export function setDayNightTheme(kind: 'day' | 'night', name: string): void {
  themeSettings.set(kind === 'day' ? { dayTheme: name } : { nightTheme: name });
}

/** 书专属主题：名称 = 书的文件名（A.getThemeOfBook） */
export function getThemeOfBook(fileName: string): ThemeEntry | undefined {
  if (!fileName) return undefined;
  const user = themeSettings.get().userThemes[fileName];
  return user ? { name: fileName, data: userToData(user), builtin: false } : undefined;
}

/** 打开书时：有专属主题则先把当前存成临时主题再完整载入（A.loadVisualOptionsForBook） */
export function loadThemeForBook(fileName: string): boolean {
  const bt = getThemeOfBook(fileName);
  if (!bt) return false;
  saveTheme(TEMP_THEME);
  return loadTheme(bt.name, { forceFull: true });
}

/** THEME-002 日夜一键切换（AT.cycleThemes）。返回载入的主题名 */
export function cycleThemes(bookFileName?: string): string {
  const { day, night } = dayNightThemes();
  const cur = curThemeHash();
  const dh = themeHash(day.data);
  const nh = themeHash(night.data);
  const bookTheme = bookFileName ? getThemeOfBook(bookFileName) : undefined;
  if (cur !== dh && cur !== nh) {
    // 当前是自定义主题：暂存起来再去夜间
    if (!bookTheme) saveTheme(TEMP_THEME);
    loadTheme(night.name);
    return night.name;
  }
  if (cur === nh) {
    loadTheme(day.name);
    return day.name;
  }
  // 当前是白天：去书专属主题 / 临时主题，若它们等同日夜主题则直接去夜间
  const custom = bookTheme ?? getTheme(TEMP_THEME);
  if (custom) {
    const ch = themeHash(custom.data);
    if (ch !== dh && ch !== nh) {
      loadTheme(custom.name, { forceFull: !!bookTheme });
      return custom.name;
    }
  }
  loadTheme(night.name);
  return night.name;
}

/** AT.setAutoThemeHandler 的判定部分：1 = 切白天，-1 = 切夜间，0 = 不动 */
export function autoThemeDecision(
  now: Date,
  lastReadTime: number,
  s: { autoThemeDay: boolean; autoThemeNight: boolean; autoThemeDayTime: number; autoThemeNightTime: number },
): 1 | -1 | 0 {
  const at = (h: number, m: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0).getTime();
  const t = now.getTime();
  const dayH = Math.floor(s.autoThemeDayTime / 100);
  const nightH = Math.floor(s.autoThemeNightTime / 100);
  const dayStart = at(dayH, s.autoThemeDayTime % 100);
  const d17 = at(17, 0);
  const nightStart = at(nightH, s.autoThemeNightTime % 100);
  const d5 = at(5, 0);
  // 没有阅读记录时当作「上次阅读在白天」，不强制切白天
  const lastH = lastReadTime > 0 ? new Date(lastReadTime).getHours() : 12;
  let b: 1 | -1 | 0 = !s.autoThemeDay || t <= dayStart || t >= d17 || (lastH >= 5 && lastH <= 17) ? 0 : 1;
  if (b === 0 && s.autoThemeNight) {
    if (nightH <= 17 || nightH >= 24) {
      if (nightH < 5 && now.getHours() >= nightH && t < d5 && t > at(nightH, s.autoThemeNightTime % 100)) b = -1;
    } else if (t > nightStart || t < d5) {
      b = -1;
    }
  }
  return b;
}
