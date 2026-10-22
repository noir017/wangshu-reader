// 多语言：每个模块用 defineMessages 声明自己的文案（中文为主、英文可缺省回落中文）。
// 当前语言来自 app 设置（默认简体中文）；切换语言时 App 根组件按 lang 重新挂载，所以 t() 直接读当前值即可。
import { appSettings, type Lang } from './app-settings';

type Dict = Record<string, string>;
export interface MessageDicts {
  zh: Dict;
  en?: Partial<Dict>;
}

const registry: MessageDicts[] = [];

/** 用法：const t = defineMessages({ zh: { open: '打开 {name}' }, en: { open: 'Open {name}' } }); t('open', { name }) */
export function defineMessages<T extends Dict>(dicts: { zh: T; en?: Partial<Record<keyof T, string>> }) {
  registry.push(dicts as MessageDicts);
  return (key: keyof T & string, vars?: Record<string, string | number>): string => {
    const lang: Lang = appSettings.get().language;
    let s = (lang === 'en' ? dicts.en?.[key] : undefined) ?? dicts.zh[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
    return s;
  };
}

/** 已声明的全部文案字典（守护测试用：查 zh 缺 key、zh 写成英文） */
export function registeredMessages(): readonly MessageDicts[] {
  return registry;
}

export function currentLang(): Lang {
  return appSettings.get().language;
}

/** 当前界面语言对应的 BCP 47 标签，给 Intl / toLocale* 用 */
export function currentLocale(): string {
  return currentLang() === 'zh' ? 'zh-CN' : 'en';
}
