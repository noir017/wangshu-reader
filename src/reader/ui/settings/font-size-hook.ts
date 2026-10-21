// 字号的本地草稿 + 去抖提交：拖动滑条时界面立刻响应，但引擎重排按 ~200ms 去抖（原版 SET_FONT_SIZE 消息）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { textSettings } from '@/reader/settings';
import { clampFontSize } from './options-data';

export function useFontSizeDraft(): { size: number; apply: (v: number, immediate?: boolean) => void; nudge: (delta: number) => void } {
  const stored = textSettings.use((s) => s.fontSize);
  const [draft, setDraft] = useState(stored);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(draft);
  latest.current = draft;

  // 外部改动（边缘滑动、主题载入）同步进草稿
  useEffect(() => {
    if (timer.current === undefined) setDraft(stored);
  }, [stored]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const apply = useCallback((v: number, immediate = false) => {
    const nv = clampFontSize(v);
    latest.current = nv;
    setDraft(nv);
    clearTimeout(timer.current);
    if (immediate) {
      timer.current = undefined;
      textSettings.set({ fontSize: nv });
    } else {
      timer.current = setTimeout(() => {
        timer.current = undefined;
        textSettings.set({ fontSize: latest.current });
      }, 200);
    }
  }, []);

  const nudge = useCallback((delta: number) => apply(latest.current + delta, false), [apply]);
  return { size: draft, apply, nudge };
}
