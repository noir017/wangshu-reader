// 点击区示意（ClickTip，CTRL-013）与点击模式画廊：半透明蒙层 + 各区动作文字，底部画廊切换 11 种模式。
import { controlSettings, type ReaderActionId } from '@/reader/settings';
import { openOverlay } from '@/ui';
import { actionLabel } from '../actions/actions';
import { TAP_MODE_GALLERY, areaGrid, toggleApplies } from '../actions/tap-zones';
import { t } from '../messages';
import s from '../reader-ui.module.css';

export function ClickTip({ onClose }: { onClose: () => void }) {
  const c = controlSettings.use((x) => x);
  const grid = areaGrid(c.tapMode, c.toggleTapMode);
  const label = (area: number): string => {
    const id: Record<number, ReaderActionId> = { 1: c.doTapScreenTop, 2: c.doTapScreenBottom, 3: c.doTapScreenLeft, 4: c.doTapScreenRight };
    return area === 0 ? t('click_tip_menu') : actionLabel(id[area]);
  };
  return (
    <>
      <div className={s.clickTip} onClick={onClose} role="presentation">
        {grid.flat().map((area, i) => (
          <div key={i} className={s.clickCell} data-area={area}>
            {label(area)}
          </div>
        ))}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 110, textAlign: 'center', opacity: 0.8, fontSize: 13 }}>{t('click_tip_hint')}</div>
      </div>
      <div className={s.clickGallery}>
        {TAP_MODE_GALLERY.map((g) => {
          const active = c.tapMode === g.tapMode && (!toggleApplies(g.tapMode) || c.toggleTapMode === g.toggle);
          return (
            <button
              key={`${g.tapMode}-${g.toggle}`}
              type="button"
              className={s.clickThumb}
              data-active={active ? 'true' : undefined}
              onClick={() => controlSettings.set({ tapMode: g.tapMode, toggleTapMode: g.toggle })}
            >
              {areaGrid(g.tapMode, g.toggle)
                .flat()
                .map((a, i) => (
                  <span key={i} className={s.thumbCell} data-area={a} />
                ))}
            </button>
          );
        })}
      </div>
    </>
  );
}

export function openClickTip(): void {
  openOverlay((close) => <ClickTip onClose={close} />);
}
