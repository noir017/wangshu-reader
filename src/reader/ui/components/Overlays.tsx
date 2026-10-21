// 亮度/蓝光遮罩（最顶层，不拦截触摸）与「返回」悬浮按钮（VIEW-017）。
import { Undo2 } from 'lucide-react';
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
  const n = useReaderUi((x) => x.linkBack.length);
  const menu = useReaderUi((x) => x.menu);
  if (n === 0 || menu) return null;
  return (
    <button type="button" className={s.linkBack} aria-label={t('link_back')} onClick={() => void goLinkBack()}>
      <Undo2 size={22} />
    </button>
  );
}
