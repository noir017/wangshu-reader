// 阅读页的主题样式：背景（纯色/程序纹理/用户图片）、文字色 CSS 变量、界面夜间态。
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import type { ReaderController } from '@/core/reader';
import { textSettings, themeSettings } from '@/reader/settings';
import { resolveBackground, textureById } from '@/reader/engine/textures';

export interface Backdrop {
  css: string;
  color: string;
}

/** 内置纹理不用读库，首帧就能画对；用户图片等异步解析完再换 */
function syncBackdrop(use: boolean, img: string, color: string): Backdrop {
  const tex = use && img.startsWith('tex:') ? textureById(img) : undefined;
  return { css: tex?.css ?? color, color };
}

/**
 * 阅读页整屏背景：引擎 open 后以它报的为准（backdrop 事件，固定版式是页边色）；之前（载入中、出错）按设置算，算法同引擎。
 * 画在阅读页根节点上铺满整屏，引擎根节点设成透明（reader-ui.module.css），状态栏那条、页眉页脚、正文是同一块背景，
 * 暗角和拉伸的图片也不会在正文边上断开
 */
export function useReaderBackdrop(rootRef: RefObject<HTMLElement | null>, controller: ReaderController | undefined): void {
  const use = textSettings.use((s) => s.useBackgroundImage);
  const img = textSettings.use((s) => s.backgroundImage);
  const color = textSettings.use((s) => s.backgroundColor);
  const [fromSettings, setFromSettings] = useState<Backdrop>(() => syncBackdrop(use, img, color));
  const [fromEngine, setFromEngine] = useState<Backdrop | null>(null);
  useEffect(() => {
    let alive = true;
    setFromSettings(syncBackdrop(use, img, color));
    void resolveBackground({ useImage: use, image: img, color }).then((css) => alive && setFromSettings({ css, color }));
    return () => {
      alive = false;
    };
  }, [use, img, color]);
  useEffect(() => {
    setFromEngine(null);
    return controller?.on('backdrop', setFromEngine);
  }, [controller]);
  const b = fromEngine ?? fromSettings;
  // 跟引擎一样先简写、再底色（纹理自带均色，主题底色要压过它）。不走 React 的 style：简写和单项混用时，
  // React 只增量更新变了的那项，换简写会把底色冲掉
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.style.background = b.css;
    el.style.backgroundColor = b.color;
  }, [rootRef, b.css, b.color]);
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
