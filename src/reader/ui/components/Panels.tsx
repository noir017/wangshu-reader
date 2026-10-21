// 浮动面板：字号（VIEW-006）、亮度 + 蓝光过滤（VIEW-007）。
import { useEffect, useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import { screenSettings } from '@/reader/settings';
import { useFontSizeDraft } from '../settings/font-size-hook';
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from '../settings/options-data';
import { brightnessToSlider, sliderToBrightness } from '../services/brightness';
import { adjustBrightness, bluelightToggle, setBluelightOpacity, setBrightness } from '../services/brightness-actions';
import { useReaderUi } from '../store';
import { t } from '../messages';
import s from '../reader-ui.module.css';

function Step({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={s.stepBtn} onClick={onClick}>
      {label}
    </button>
  );
}

export function FontPanel() {
  const { size, apply, nudge } = useFontSizeDraft();
  const initial = useRef(size);
  const whole = Math.floor(size);
  const frac = Math.round((size - whole) * 10);
  return (
    <div className={s.floatPanel}>
      <div className={s.panelRow}>
        <span className={s.panelLabel}>{t('font_size')}</span>
        <Step label="−" onClick={() => nudge(-1)} />
        <input
          className={s.panelRange}
          type="range"
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          step={1}
          value={Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, whole))}
          onChange={(e) => apply(Number(e.target.value) + frac / 10)}
          onPointerUp={(e) => apply(Number((e.target as HTMLInputElement).value) + frac / 10, true)}
        />
        <Step label="+" onClick={() => nudge(1)} />
        <span className={s.panelValue}>{size.toFixed(1)}</span>
        <button type="button" className={s.stepBtn} aria-label={t('reset')} title={t('reset')} onClick={() => apply(initial.current, true)}>
          <RotateCcw size={16} />
        </button>
      </div>
      <div className={s.panelRow}>
        <span className={s.panelLabel} />
        <Step label="−" onClick={() => nudge(-0.1)} />
        <input
          className={s.panelRange}
          type="range"
          min={0}
          max={9}
          step={1}
          value={frac >= 10 ? 9 : frac}
          onChange={(e) => apply(whole + Number(e.target.value) / 10)}
          onPointerUp={(e) => apply(whole + Number((e.target as HTMLInputElement).value) / 10, true)}
        />
        <Step label="+" onClick={() => nudge(0.1)} />
      </div>
    </div>
  );
}

/** 亮度面板。mini=true 是从边缘滑动唤出的精简版（只有滑条），约 3 秒后渐隐 */
export function BrightnessPanel({ mini }: { mini: boolean }) {
  const v = screenSettings.use((x) => x.brightnessValue);
  const blue = screenSettings.use((x) => x.bluelightEnable);
  const opacity = screenSettings.use((x) => x.bluelightOpacity);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const arm = () => {
    if (!mini) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => useReaderUi.getState().setPanel(null), 3000);
  };
  useEffect(() => {
    arm();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mini, v]);
  const auto = v === -100;
  return (
    <div className={s.floatPanel} data-mini={mini ? 'true' : undefined} onPointerDown={arm}>
      <div className={s.panelRow}>
        <span className={s.panelLabel}>{t('brightness')}</span>
        {!mini && (
          <label className={s.check}>
            <input type="checkbox" checked={auto} onChange={(e) => setBrightness(e.target.checked ? -100 : 50)} />
            {t('auto')}
          </label>
        )}
        <Step label="−" onClick={() => adjustBrightness(-1)} />
        <input
          className={s.panelRange}
          type="range"
          min={0}
          max={150}
          step={1}
          disabled={auto}
          value={brightnessToSlider(auto ? 100 : v)}
          onChange={(e) => setBrightness(sliderToBrightness(Number(e.target.value)))}
        />
        <Step label="+" onClick={() => adjustBrightness(1)} />
      </div>
      {!mini && (
        <>
          <div className={s.panelRow}>
            <label className={s.check}>
              <input type="checkbox" checked={blue} onChange={(e) => bluelightToggle(e.target.checked)} />
              {t('bluelight_filter')}
            </label>
          </div>
          {blue && (
            <div className={s.panelRow}>
              <span className={s.panelLabel}>{t('bluelight_filter_opacity')}</span>
              <Step label="−" onClick={() => setBluelightOpacity(opacity - 1)} />
              <input className={s.panelRange} type="range" min={0} max={95} step={1} value={Math.min(95, opacity)} onChange={(e) => setBluelightOpacity(Number(e.target.value))} />
              <Step label="+" onClick={() => setBluelightOpacity(opacity + 1)} />
            </div>
          )}
          <p className={s.hint}>{t('brightness_note')}</p>
        </>
      )}
    </div>
  );
}
