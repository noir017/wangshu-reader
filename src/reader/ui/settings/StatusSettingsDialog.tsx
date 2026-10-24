// 阅读状态栏设置（PrefStatusSetting，STATUS-002）
import { Sheet, Button, Row } from '@/ui';
import { statusSettings } from '@/reader/settings';
import { ColorRow, ResetRow, SliderRow, SwitchRow } from './rows';
import { openFontPicker } from './FontPicker';
import { useFontLabel } from './font-names';
import { t } from '../messages';

export function StatusSettingsDialog({ close }: { close: () => void }) {
  const custom = statusSettings.use((s) => s.statusCustomizeFont);
  const fontName = statusSettings.use((s) => s.statusFontName);
  const label = useFontLabel(fontName);
  return (
    <Sheet open position="center" title={t('status_bar')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
      <SwitchRow slice={statusSettings} k="statusBarOnTop" title={t('status_bar_on_top')} />
      <SwitchRow slice={statusSettings} k="statusTime" title={t('status_show_time')} />
      <SwitchRow slice={statusSettings} k="statusChapter" title={t('status_show_chapter')} />
      <SwitchRow slice={statusSettings} k="statusProgress" title={t('status_show_progress')} />
      <SwitchRow slice={statusSettings} k="use12Hour" title={t('statubar_12hour')} />
      <SwitchRow slice={statusSettings} k="statusCustomizeFont" title={t('statubar_font')} />
      {custom && (
        <>
          <Row title={t('statubar_font_name')} onClick={() => openFontPicker({ get: () => statusSettings.get().statusFontName, set: (v) => statusSettings.set({ statusFontName: v }) })} right={label} />
          <ColorRow slice={statusSettings} k="statusFontColor" title={t('statubar_font_color')} />
          <SliderRow slice={statusSettings} k="statusFontSize" title={t('statubar_font_size')} min={3} max={30} />
          <SliderRow slice={statusSettings} k="statusMargin" title={t('statubar_margin')} min={0} max={100} />
          <ColorRow slice={statusSettings} k="statusBackColor" title={t('statubar_back_color')} />
        </>
      )}
      {/* 状态栏左中右的点击 / 长按绑定只放在控制选项「阅读状态栏」（CTRL-010），这里不再重复 */}
      <ResetRow
        label={t('reset')}
        onClick={() => {
          const d = statusSettings.defaults;
          statusSettings.set({
            statusBarOnTop: d.statusBarOnTop,
            statusTime: d.statusTime,
            statusChapter: d.statusChapter,
            statusProgress: d.statusProgress,
            use12Hour: false,
            statusCustomizeFont: d.statusCustomizeFont,
            statusFontName: d.statusFontName,
            statusFontColor: d.statusFontColor,
            statusFontSize: d.statusFontSize,
            statusMargin: d.statusMargin,
            statusBackColor: d.statusBackColor,
          });
        }}
      />
    </Sheet>
  );
}
