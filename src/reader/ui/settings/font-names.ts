// 字体当前显示名：fontName 的取值（font:<id> / server:<file>）要查库/服务端才知道族名
import { useEffect, useState } from 'react';
import { listFonts } from '@/storage/db';
import { listServerFonts } from '../services/fonts';
import { t } from '../messages';

// 通用字体族（存的是 CSS 关键字）显示成当前语言，与字体选择列表一致
const GENERIC_LABELS: Record<string, () => string> = {
  serif: () => t('font_serif'),
  'sans-serif': () => t('font_sans'),
  monospace: () => t('font_mono'),
};

export function useFontLabel(fontName: string): string {
  const [label, setLabel] = useState(() => GENERIC_LABELS[fontName]?.() ?? fontName);
  useEffect(() => {
    let alive = true;
    if (fontName.startsWith('font:')) {
      void listFonts().then((l) => alive && setLabel(l.find((f) => f.id === fontName.slice(5))?.family ?? fontName));
    } else if (fontName.startsWith('server:')) {
      void listServerFonts().then((l) => alive && setLabel(l.find((f) => f.file === fontName.slice(7))?.family ?? fontName.slice(7)));
    } else {
      setLabel(GENERIC_LABELS[fontName]?.() ?? fontName);
    }
    return () => {
      alive = false;
    };
  }, [fontName]);
  return label;
}
