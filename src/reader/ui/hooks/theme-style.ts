// 阅读页的主题样式：背景（纯色/程序纹理/用户图片）、文字色 CSS 变量、界面夜间态。
import { useEffect, useState, type CSSProperties } from 'react';
import { textSettings, themeSettings } from '@/reader/settings';
import { getTexture, cssToStyle, resolveBackground } from '../themes/background';

function syncStyle(use: boolean, img: string, color: string): CSSProperties {
  if (use && img.startsWith('tex:')) {
    const tex = getTexture(img);
    if (tex) return { backgroundColor: color, ...cssToStyle(tex.css) };
  }
  return { backgroundColor: color };
}

export function useReaderBackground(): CSSProperties {
  const use = textSettings.use((s) => s.useBackgroundImage);
  const img = textSettings.use((s) => s.backgroundImage);
  const color = textSettings.use((s) => s.backgroundColor);
  const [style, setStyle] = useState<CSSProperties>(() => syncStyle(use, img, color));
  useEffect(() => {
    let alive = true;
    setStyle(syncStyle(use, img, color));
    if (use && img.startsWith('img:')) void resolveBackground({ useBackgroundImage: use, backgroundImage: img, backgroundColor: color }).then((st) => alive && setStyle(st));
    return () => {
      alive = false;
    };
  }, [use, img, color]);
  return style;
}

/** 阅读页期间把应用 UI 切成日/夜配色（弹窗、设置面板随之变深），离开时还原 */
export function useUiNightMode(): boolean {
  const night = themeSettings.use((s) => s.nightMode);
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.dataset.uiTheme;
    root.dataset.uiTheme = night ? 'dark' : 'light';
    return () => {
      if (prev === undefined) delete root.dataset.uiTheme;
      else root.dataset.uiTheme = prev;
    };
  }, [night]);
  return night;
}
