// 其它选项里齿轮/按钮打开的小对话框：常亮分钟、边缘、倾斜、双页、翻页声音、提醒、CSS、链接/注解颜色、图片、边缘防误触。
import { useState } from 'react';
import { cssSettings, controlSettings, flipSettings, screenSettings, textSettings, type ReaderActionId } from '@/reader/settings';
import { currentLang } from '@/core/i18n';
import { getKV, setKV } from '@/storage/db';
import { Button, Row, Segmented, Select, Sheet, Slider, Switch, chooseDialog, openOverlay, toast } from '@/ui';
import { actionOptions } from '../actions/actions';
import { ColorRow, PlainSelectRow, SelectRow, SliderRow, SwitchRow } from './rows';
import { PAGE_SOUND_COUNT, PAGE_SOUND_FILE_KV, PAGE_SOUND_USER, pageSound } from '../services/page-sound';
import { requestMotionPermission, motionSupported } from '../services/motion-source';
import { tiltSensToSlider, tiltSliderToSens } from '../services/motion';
import { uiSettings } from '../ui-settings';
import { t } from '../messages';

// ───────────── 常亮分钟（pmSetScreenAwake） ─────────────
export async function openAwakeExtendDialog(): Promise<void> {
  const cur = screenSettings.get().screenAwakeExtend;
  const items = [1, 2, 5, 10, 30, 100].map((v) => ({ value: v, label: `${v === cur ? '● ' : ''}${v === 100 ? t('awake_forever') : t('awake_minutes', { n: v })}` }));
  const v = await chooseDialog(t('awake_extend'), items);
  if (v !== null) screenSettings.set({ screenAwakeExtend: v });
}

// ───────────── 边缘（亮度/字号所用边框） ─────────────
export function openEdgeDialog(which: 'brightness' | 'fontsize'): void {
  openOverlay((close) => {
    const Body = () => {
      const k = which === 'brightness' ? 'brightnessEdge' : 'fontsizeEdge';
      const v = controlSettings.use((c) => c[k]);
      return (
        <Sheet open position="center" title={which === 'brightness' ? t('brightness_edge') : t('fontsize_edge')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
          <Row
            title=""
            right={
              <Segmented
                value={v}
                onChange={(nv) => controlSettings.set({ [k]: nv })}
                // 上/下边需要横向拖动事件，引擎只上报竖向拖动，所以只提供左/右
                options={[
                  { value: 0, label: t('pref_edge_left') },
                  { value: 1, label: t('pref_edge_right') },
                ]}
              />
            }
          />
        </Sheet>
      );
    };
    return <Body />;
  });
}

// ───────────── 首行缩进字数 ─────────────
export function openIndentDialog(): void {
  openOverlay((close) => (
    <Sheet open position="center" title={t('indent_length')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
      <SliderRow slice={textSettings} k="indentLength" title={t('indent_length')} min={0} max={4} />
    </Sheet>
  ));
}

// ───────────── 剩余时间 ─────────────
export function openRemainingDialog(): void {
  openOverlay((close) => (
    <Sheet open position="center" title={t('show_remaining_time')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
      <SwitchRow slice={uiBridge} k="remainingTimeInStatusBar" title={t('remaining_time_in_statusbar')} />
    </Sheet>
  ));
}
// 剩余时间合并开关在 statusSettings 里，这里用别名避免循环引用
import { statusSettings } from '@/reader/settings';
const uiBridge = statusSettings;

// ───────────── 提醒（remind1 分钟 / remind2 时刻） ─────────────
export function openRemind1Dialog(): void {
  openOverlay((close) => (
    <Sheet open position="center" title={t('remindlabel')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
      <SliderRow slice={screenSettings} k="remind1Time" title={t('remind_minutes')} min={10} max={180} step={5} format={(v) => `${v}`} />
    </Sheet>
  ));
}

export function openRemind2Dialog(): void {
  openOverlay((close) => {
    const Body = () => {
      const h = screenSettings.use((c) => c.remind2TimeHour);
      const m = screenSettings.use((c) => c.remind2TimeMinute);
      return (
        <Sheet open position="center" title={t('remind_me_at_time')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
          <Row
            title={t('remind_time')}
            right={
              <input
                type="time"
                value={`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`}
                onChange={(e) => {
                  const mm = /^(\d{1,2}):(\d{2})$/.exec(e.target.value);
                  if (mm) screenSettings.set({ remind2TimeHour: Number(mm[1]), remind2TimeMinute: Number(mm[2]) });
                }}
              />
            }
          />
        </Sheet>
      );
    };
    return <Body />;
  });
}

// ───────────── 倾斜翻页设置（setTiltOptions） ─────────────
export function openTiltDialog(): void {
  openOverlay((close) => {
    const Body = () => {
      const c = controlSettings.use((x) => x);
      const opts = [
        { value: 0 as ReaderActionId, label: t('tilt_forward_label') },
        { value: 1 as ReaderActionId, label: t('tilt_backward_label') },
      ];
      return (
        <Sheet open position="center" title={t('tilt_turn_page')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
          {/* 原版的下拉只有「向下翻页 / 向上翻页」两项，取值 0/1 不是 ReaderAction 编号 */}
          <PlainSelectRow title={t('tilt_forward')} value={c.tiltForward} options={opts} onChange={(v) => controlSettings.set({ tiltForward: v })} />
          <Slider label={`${t('tilt_forward')} · ${t('tilt_sensitive')}`} value={tiltSensToSlider(c.tiltForwardSensitive)} min={0} max={40} onChange={(p) => controlSettings.set({ tiltForwardSensitive: tiltSliderToSens(p) })} format={(v) => String(v)} />
          <PlainSelectRow title={t('tilt_backward')} value={c.tiltBackward} options={opts} onChange={(v) => controlSettings.set({ tiltBackward: v })} />
          <Slider label={`${t('tilt_backward')} · ${t('tilt_sensitive')}`} value={tiltSensToSlider(c.tiltBackwardSensitive)} min={0} max={40} onChange={(p) => controlSettings.set({ tiltBackwardSensitive: tiltSliderToSens(p) })} format={(v) => String(v)} />
          <Row title={t('do_not_ask_again')} onClick={() => uiSettings.set({ askForTiltAction: !uiSettings.get().askForTiltAction })} right={<AskSwitch />} />
        </Sheet>
      );
    };
    return <Body />;
  });
}

function AskSwitch() {
  const ask = uiSettings.use((x) => x.askForTiltAction);
  return <Switch checked={!ask} onChange={(v) => uiSettings.set({ askForTiltAction: !v })} />;
}

/** 打开/关闭倾斜翻页：开启时（须在点击手势里）申请运动传感器权限 */
export async function setTiltEnabled(on: boolean): Promise<boolean> {
  if (!on) {
    controlSettings.set({ tiltTurnPage: false });
    return false;
  }
  if (!motionSupported()) {
    toast(t('tilt_unsupported'));
    return false;
  }
  const p = await requestMotionPermission();
  if (p !== 'granted') {
    toast(p === 'unsupported' ? t('tilt_unsupported') : t('tilt_denied'));
    return false;
  }
  controlSettings.set({ tiltTurnPage: true });
  if (uiSettings.get().askForTiltAction) openTiltDialog();
  return true;
}

// ───────────── 横划翻页动画（pmSetFling） ─────────────
export function openFlingDialog(): void {
  openOverlay((close) => (
    <Sheet open position="center" title={t('allow_scroll_horizontally')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
      <SelectRow
        slice={flipSettings}
        k="horiFlingAnimation"
        title={t('flip_animation')}
        options={[0, 1, 2, 3, 4, 5, 6, 7].map((v) => ({ value: v as 0, label: t(`flip_${v}` as 'flip_0') }))}
      />
    </Sheet>
  ));
}

// ───────────── 双页（pmSet2Page） ─────────────
export function openDualPageDialog(): void {
  openOverlay((close) => (
    <Sheet open position="center" title={t('dual_page')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
      <SelectRow
        slice={screenSettings}
        k="dualPage"
        title={t('dual_page')}
        options={[
          { value: 'auto', label: t('dual_page_auto') },
          { value: 'on', label: t('dual_page_on') },
          { value: 'off', label: t('dual_page_off') },
        ]}
      />
      <SliderRow slice={textSettings} k="dualFontSizeAdd" title={t('dual_font_add')} min={-5} max={5} step={0.5} format={(v) => (v > 0 ? `+${v}` : String(v))} />
    </Sheet>
  ));
}

// ───────────── 翻页声音（pmSetSound） ─────────────
/** 读出用户上传的声音文件（存在 kv），解码后给播放器 */
export async function loadUserPageSound(): Promise<boolean> {
  const blob = await getKV<Blob>(PAGE_SOUND_FILE_KV);
  return blob ? pageSound.loadUserFile(blob) : false;
}

export function openPageSoundDialog(): void {
  openOverlay((close) => {
    const Body = () => {
      const idx = flipSettings.use((f) => f.pageSoundIndex);
      const fileName = uiSettings.use((u) => u.pageSoundFileName);
      const items = [
        ...Array.from({ length: PAGE_SOUND_COUNT }, (_, i) => ({ value: i, label: t('page_sound_n', { n: i + 1 }) })),
        { value: PAGE_SOUND_USER, label: fileName ? `${t('page_sound_file')}: ${fileName}` : t('page_sound_choose') },
      ];
      const choose = async (v: number) => {
        if (v === PAGE_SOUND_USER) {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'audio/*';
          input.onchange = async () => {
            const f = input.files?.[0];
            if (!f) return;
            await setKV(PAGE_SOUND_FILE_KV, f);
            if (await pageSound.loadUserFile(f)) {
              uiSettings.set({ pageSoundFileName: f.name });
              flipSettings.set({ pageSoundIndex: PAGE_SOUND_USER, pageSound: true });
              pageSound.playUser();
            } else toast(t('bg_upload_failed'));
          };
          input.click();
          return;
        }
        flipSettings.set({ pageSoundIndex: v });
        pageSound.play(v); // 选中即试听
      };
      return (
        <Sheet open position="center" title={t('page_sound')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
          {items.map((it) => (
            <Row key={it.value} title={it.label} onClick={() => void choose(it.value)} right={idx === it.value ? <span style={{ color: 'var(--mr-accent)' }}>✓</span> : undefined} />
          ))}
        </Sheet>
      );
    };
    return <Body />;
  });
}

// ───────────── 屏幕边缘防误触（setEdge） ─────────────
export function openEdgeTouchDialog(): void {
  openOverlay((close) => (
    <Sheet open position="center" title={t('disable_edge_touch')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
      <SliderRow slice={controlSettings} k="leftEdge" title={t('edge_width', { edge: t('pref_edge_left') })} min={0} max={60} />
      <SliderRow slice={controlSettings} k="rightEdge" title={t('edge_width', { edge: t('pref_edge_right') })} min={0} max={60} />
      <SliderRow slice={controlSettings} k="topEdge" title={t('edge_width', { edge: t('pref_edge_top') })} min={0} max={60} />
      <SliderRow slice={controlSettings} k="bottomEdge" title={t('edge_width', { edge: t('pref_edge_bottom') })} min={0} max={60} />
    </Sheet>
  ));
}

// ───────────── 禁用书内 CSS（do_SetCSS：8 项多选） ─────────────
const CSS_KEYS = ['cssFontStyle', 'cssFontSize', 'cssFontColor', 'cssAlignment', 'cssJustify', 'cssIndent', 'cssLineSpace', 'cssOthers'] as const;
const CSS_LABELS = ['css_font_style', 'css_font_size', 'css_font_color', 'css_alignment', 'css_justify', 'css_indent', 'css_line_space', 'css_others'] as const;

export function openCssDialog(): void {
  openOverlay((close) => {
    const Body = () => {
      const c = cssSettings.use((x) => x);
      const toggle = (k: (typeof CSS_KEYS)[number]) => {
        const next = { ...cssSettings.get(), [k]: !cssSettings.get()[k] };
        // disableCSS = 8 项任一为真
        cssSettings.set({ [k]: next[k], disableCSS: CSS_KEYS.some((kk) => next[kk]) });
      };
      return (
        <Sheet open position="center" title={t('disable_css')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
          {CSS_KEYS.map((k, i) => (
            <Row key={k} title={t(CSS_LABELS[i])} onClick={() => toggle(k)} right={<Switch checked={c[k]} onChange={() => toggle(k)} />} />
          ))}
        </Sheet>
      );
    };
    return <Body />;
  });
}

/** 总开关：开 → 弹出 8 项选择；关 → 直接关闭 */
export function setDisableCss(on: boolean): void {
  if (on) {
    // 首次勾选时 cssJustify 默认为真（原版载入默认），保证至少有一项被禁用
    const c = cssSettings.get();
    const any = CSS_KEYS.some((k) => c[k]);
    cssSettings.set({ disableCSS: true, ...(any ? {} : { cssJustify: true }) });
    openCssDialog();
  } else {
    cssSettings.set({ disableCSS: false });
  }
}

// ───────────── 链接颜色 / 注解弹窗颜色 / 图片选项 ─────────────
export function openLinkColorDialog(): void {
  openOverlay((close) => (
    <Sheet open position="center" title={t('link_colors')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
      <SwitchRow slice={cssSettings} k="disableLinkColor" title={t('disable_css_link_color')} />
      <ColorRow slice={cssSettings} k="linkColor" title={t('link_color')} />
      <ColorRow slice={cssSettings} k="linkVisitedColor" title={t('link_visited_color')} />
      <ColorRow slice={cssSettings} k="linkColorNight" title={t('link_color_night')} />
      <ColorRow slice={cssSettings} k="linkVisitedColorNight" title={t('link_visited_color_night')} />
    </Sheet>
  ));
}

export function openNoteColorDialog(): void {
  openOverlay((close) => (
    <Sheet open position="center" title={t('popup_note_color')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
      <ColorRow slice={cssSettings} k="noteTextColor" title={t('note_text_color')} />
      <ColorRow slice={cssSettings} k="noteBackColor" title={t('note_back_color')} />
      <ColorRow slice={cssSettings} k="noteTextColorNight" title={t('note_text_color_night')} />
      <ColorRow slice={cssSettings} k="noteBackColorNight" title={t('note_back_color_night')} />
    </Sheet>
  ));
}

export function openImageOptionsDialog(): void {
  openOverlay((close) => (
    <Sheet open position="center" title={t('image_display_options')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
      <SwitchRow slice={cssSettings} k="fitImageToScreen" title={t('fit_all_to_screen')} />
      <SwitchRow slice={cssSettings} k="imageWhiteTransparent" title={t('white_transparent')} />
      <SwitchRow slice={cssSettings} k="longTapImageFullScreen" title={t('long_tap_full_screen')} />
    </Sheet>
  ));
}

void Select;
void useState;
void currentLang;
void actionOptions;
