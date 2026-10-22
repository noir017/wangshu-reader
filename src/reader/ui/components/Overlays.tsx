// 亮度/蓝光遮罩（最顶层，不拦截触摸）与「返回」悬浮按钮（VIEW-017）。
import { useRef } from 'react';
import { Undo2 } from 'lucide-react';
import { openLinkBackHistory, useLinkBack } from '@/features';
import { screenSettings } from '@/reader/settings';
import { shadeLayers } from '../services/brightness';
import { goLinkBack } from '../ops';
import { useReaderUi } from '../store';
import { t } from '../messages';
import s from '../reader-ui.module.css';

export function Shade() {
  const v = screenSettings.use((x) => x.brightnessValue);
  const blue = screenSettings.use((x) => x.bluelightEnable);
  const opacity = screenSettings.use((x) => x.bluelightOpacity);
  const layers = shadeLayers(v, blue, opacity);
  return (
    <>
      {layers.dim > 0 && <div className={s.shade} style={{ background: `rgb(0 0 0 / ${layers.dim.toFixed(3)})` }} data-testid="shade-dim" />}
      {layers.blue && <div className={s.shade} style={{ background: layers.blue.color, opacity: layers.blue.alpha }} data-testid="shade-blue" />}
    </>
  );
}

export function LinkBackButton() {
  const n = useLinkBack((x) => x.stack.length);
  const menu = useReaderUi((x) => x.menu);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fired = useRef(false);
  if (n === 0 || menu) return null;
  // 长按：返回记录菜单（TOC-005 navigateBackLinks）
  return (
    <button
      type="button"
      className={s.linkBack}
      aria-label={t('link_back')}
      onPointerDown={(e) => {
        fired.current = false;
        const el = e.currentTarget.getBoundingClientRect();
        timer.current = setTimeout(() => {
          fired.current = true;
          const session = useReaderUi.getState().session;
          if (session) openLinkBackHistory(session, { x: el.left, y: el.top - 60 });
        }, 500);
      }}
      onPointerUp={() => clearTimeout(timer.current)}
      onPointerLeave={() => clearTimeout(timer.current)}
      onClick={() => {
        if (!fired.current) goLinkBack();
        fired.current = false;
      }}
    >
      <Undo2 size={22} />
    </button>
  );
}
