// 书架界面的日夜主题（mainNightTheme / sysDarkModeFollow，LIB-020）。阅读页的主题由 reader 模块管理。
import { useEffect, useState } from 'react';
import { shelfSettings } from './settings';

export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = () => setDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}

/** 当前书架是否夜间 */
export function useUiNight(): boolean {
  const manual = shelfSettings.use((s) => s.mainNightTheme);
  const follow = shelfSettings.use((s) => s.sysDarkModeFollow);
  const sys = useSystemDark();
  return follow ? sys : manual;
}

/** 把夜间主题写到 <html data-ui-theme>（global.css 里的变量据此切换） */
export function useApplyUiTheme(): boolean {
  const night = useUiNight();
  useEffect(() => {
    const root = document.documentElement;
    if (night) root.dataset.uiTheme = 'dark';
    else delete root.dataset.uiTheme;
  }, [night]);
  return night;
}
