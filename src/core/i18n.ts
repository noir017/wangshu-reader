// 多语言：每个模块用 defineMessages 声明自己的文案（中文为主、英文可缺省回落中文）。
// 当前语言来自 app 设置；切换语言时 App 根组件按 lang 重新挂载，所以 t() 直接读当前值即可。
import { appSettings, type Lang } from './app-settings';

type Dict = Record<string, string>;

/** 用法：const t = defineMessages({ zh: { open: '打开 {name}' }, en: { open: 'Open {name}' } }); t('open', { name }) */
export function defineMessages<T extends Dict>(dicts: { zh: T; en?: Partial<Record<keyof T, string>> }) {
  return (key: keyof T & string, vars?: Record<string, string | number>): string => {
    const lang: Lang = appSettings.get().language;
    let s = (lang === 'en' ? dicts.en?.[key] : undefined) ?? dicts.zh[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
    return s;
  };
}

export function currentLang(): Lang {
  return appSettings.get().language;
}
