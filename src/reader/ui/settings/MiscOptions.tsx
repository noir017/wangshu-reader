// 其它选项（PrefMisc，VIEW-009）：全屏/常亮/边缘手势/状态栏/智能排版/自动滚屏/EPUB/护眼/特殊选项。
import { controlSettings, cssSettings, flipSettings, screenSettings, statusSettings, textSettings, autoScrollSettings, AutoScrollMode, themeSettings } from '@/reader/settings';
import { openDictSettings, openNamesDialog, openTtsMoreDialog } from '@/features';
import { Row, toast, openOverlay } from '@/ui';
import { useReaderUi } from '../store';
import { Drawer } from '../components/Drawer';
import { Section, SelectRow, SliderRow, SwitchRow } from './rows';
import { enterFullscreen, exitFullscreen, fullscreenSupported } from '../services/system';
import {
  openAwakeExtendDialog,
  openDualPageDialog,
  openEdgeDialog,
  openEdgeTouchDialog,
  openFlingDialog,
  openImageOptionsDialog,
  openIndentDialog,
  openLinkColorDialog,
  openNoteColorDialog,
  openPageSoundDialog,
  openRemainingDialog,
  openRemind1Dialog,
  openRemind2Dialog,
  openTiltDialog,
  setDisableCss,
  setTiltEnabled,
} from './MiscDialogs';
import { StatusSettingsDialog } from './StatusSettingsDialog';
import { ToolbarCustomizer } from './ToolbarCustomizer';
import { t } from '../messages';
import type { SettingsKind } from './VisualOptions';
import { bluelightToggle } from '../services/brightness-actions';

export function openStatusSettings(): void {
  openOverlay((close) => <StatusSettingsDialog close={close} />);
}

/** features 的设置对话框都要带当前会话 */
export function withSession(open: (s: NonNullable<ReturnType<typeof useReaderUi.getState>['session']>) => void): void {
  const s = useReaderUi.getState().session;
  if (s) open(s);
}

export function openToolbarCustomizer(): void {
  openOverlay((close) => <ToolbarCustomizer close={close} />);
}

export function MiscOptions({ close, onSwitch }: { close: () => void; onSwitch: (k: SettingsKind) => void }) {
  const blue = screenSettings.use((s) => s.bluelightEnable);
  const tilt = controlSettings.use((c) => c.tiltTurnPage);
  const fsSupported = fullscreenSupported();
  return (
    <Drawer
      title={t('miscellaneous')}
      onClose={close}
      footer={[
        { label: t('visual_options'), onClick: () => onSwitch('visual') },
        { label: t('control_options'), onClick: () => onSwitch('control') },
      ]}
    >
      <SwitchRow
        slice={screenSettings}
        k="fullscreen"
        title={t('full_screen_mode')}
        disabled={!fsSupported}
        // 进入全屏必须在用户手势里：开关的点击正好是手势
        onSet={(v) => {
          screenSettings.set({ fullscreen: v });
          if (v) void enterFullscreen().then((ok) => !ok && toast(t('fullscreen_failed')));
          else void exitFullscreen();
        }}
      />
      <SwitchRow slice={screenSettings} k="keepScreenAwake" title={t('keep_screen_awake')} onGear={() => void openAwakeExtendDialog()} />
      <SwitchRow slice={controlSettings} k="adjustBrightness" title={t('swpie_edge_brightness')} onGear={() => openEdgeDialog('brightness')} />
      <SwitchRow slice={controlSettings} k="adjustFontSizeAtSlide" title={t('adjust_fontsize_by_side')} onGear={() => openEdgeDialog('fontsize')} />
      <SwitchRow slice={textSettings} k="keepOneLineWhenPaging" title={t('keep_one_line')} />
      <SwitchRow slice={screenSettings} k="openLastFile" title={t('open_lastfile')} />
      <SwitchRow slice={statusSettings} k="showStatusbar" title={t('status_bar')} onGear={openStatusSettings} />
      <SwitchRow slice={statusSettings} k="showRemainingTime" title={t('show_remaining_time')} onGear={openRemainingDialog} />

      <Section>{t('typesetting')}</Section>
      <SwitchRow slice={textSettings} k="indentParagraph" title={t('indent_paragraph')} onGear={openIndentDialog} />
      <SwitchRow slice={textSettings} k="trimBlankSpace" title={t('trim_blank')} />
      <SwitchRow slice={textSettings} k="txtChapterSplit" title={t('txt_chapter_split')} />

      <Section>{t('auto_scroll_control')}</Section>
      <SelectRow
        slice={autoScrollSettings}
        k="autoScrollMode"
        title={t('scroll_mode')}
        options={[0, 1, 2, 3, 4, AutoScrollMode.SpeedRead].map((v) => ({ value: v as 0, label: t(`scroll_mode_${v}` as 'scroll_mode_0') }))}
      />

      <Section>{t('epub_books')}</Section>
      <SwitchRow slice={cssSettings} k="useCssFont" title={t('epub_embedded_fonts')} />
      <SwitchRow slice={cssSettings} k="disableCSS" title={t('disable_css')} onSet={setDisableCss} onGear={() => setDisableCss(true)} />
      <SwitchRow slice={cssSettings} k="chapterEndPrompt" title={t('show_epub_chapter_end_prompt')} />
      <SwitchRow slice={cssSettings} k="footnoteOnBottom" title={t('show_footnote')} />

      <Section>{t('keep_health_by')}</Section>
      <SwitchRow slice={screenSettings} k="remind1" title={t('remindlabel')} onGear={openRemind1Dialog} />
      <SwitchRow slice={screenSettings} k="remind2" title={t('remind_me_at_time')} onGear={openRemind2Dialog} />
      <SwitchRow slice={screenSettings} k="bluelightEnable" title={t('bluelight_filter')} onSet={bluelightToggle} />
      {blue && <SliderRow slice={screenSettings} k="bluelightOpacity" title={t('bluelight_filter_opacity')} min={1} max={95} />}

      <Section>{t('speak_group')}</Section>
      <Row title={t('tts_options')} onClick={() => withSession(openTtsMoreDialog)} />

      <Section>{t('specialphone')}</Section>
      <Row
        title={t('tilt_turn_page')}
        onClick={() => void setTiltEnabled(!tilt)}
        right={
          <>
            <button type="button" aria-label="settings" onClick={(e) => { e.stopPropagation(); openTiltDialog(); }} style={{ border: 'none', background: 'none', color: 'var(--mr-muted)', cursor: 'pointer' }}>⚙</button>
            <input type="checkbox" role="switch" checked={tilt} onChange={() => void setTiltEnabled(!tilt)} onClick={(e) => e.stopPropagation()} style={{ width: 20, height: 20 }} />
          </>
        }
      />
      <SwitchRow slice={controlSettings} k="multTouch" title={t('multi_touch')} />
      <SwitchRow slice={flipSettings} k="allowScrollHorizontally" title={t('allow_scroll_horizontally')} onGear={openFlingDialog} />
      <SwitchRow slice={flipSettings} k="disableMove" title={t('disablemove')} />
      <Row title={t('dual_page')} onClick={openDualPageDialog} right={<DualLabel />} />
      <SwitchRow slice={flipSettings} k="pageSound" title={t('page_sound')} onGear={openPageSoundDialog} />
      <SwitchRow slice={screenSettings} k="openBookAnim" title={t('open_book_anim')} />
      <SwitchRow
        slice={themeSettings}
        k="sysDarkModeFollow"
        title={t('follow_sys_dark')}
        onSet={(v) => themeSettings.set(v ? { sysDarkModeFollow: true, autoTheme: false } : { sysDarkModeFollow: false })}
      />
      <SwitchRow slice={controlSettings} k="disableEdgeTouch" title={t('disable_edge_touch')} onGear={openEdgeTouchDialog} />

      <Section>{' '}</Section>
      <Row title={t('names_replacement')} onClick={() => withSession(openNamesDialog)} />
      <Row title={t('link_colors')} onClick={openLinkColorDialog} />
      <Row title={t('popup_note_color')} onClick={openNoteColorDialog} />
      <Row title={t('image_display_options')} onClick={openImageOptionsDialog} />
      <Row title={t('customize_dictionary')} onClick={() => withSession(openDictSettings)} />
      <Row title={t('customize_bottom_bar1')} onClick={openToolbarCustomizer} />
    </Drawer>
  );
}

function DualLabel() {
  const v = screenSettings.use((s) => s.dualPage);
  return <span>{t(v === 'auto' ? 'dual_page_auto' : v === 'on' ? 'dual_page_on' : 'dual_page_off')}</span>;
}

