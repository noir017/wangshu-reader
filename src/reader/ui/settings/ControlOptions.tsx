// 控制选项（PrefControl，CTRL-001..005/010）：屏幕方向、摇一摇、点击区、长按、键盘按键、划动手势、状态栏点击。
import { controlSettings, screenSettings, type ReaderActionId } from '@/reader/settings';
import { Row } from '@/ui';
import { actionOptions } from '../actions/actions';
import { toggleApplies } from '../actions/tap-zones';
import { Drawer } from '../components/Drawer';
import { Section, PlainSelectRow, ResetRow, SelectRow, SliderRow, SwitchRow, GearButton } from './rows';
import { openClickTip } from './ClickTip';
import { t } from '../messages';
import type { SettingsKind } from './VisualOptions';

const actions = () => actionOptions();

function KeyRow({ keyName, title }: { keyName: string; title: string }) {
  const map = controlSettings.use((c) => c.keyMap);
  return (
    <PlainSelectRow
      title={title}
      value={(map[keyName] ?? 15) as ReaderActionId}
      options={actions()}
      onChange={(v) => controlSettings.set({ keyMap: { ...controlSettings.get().keyMap, [keyName]: v } })}
    />
  );
}

export function ControlOptions({ close, onSwitch }: { close: () => void; onSwitch: (k: SettingsKind) => void }) {
  const tapMode = controlSettings.use((c) => c.tapMode);
  const toggle = controlSettings.use((c) => c.toggleTapMode);
  const applies = toggleApplies(tapMode);
  // 左右模式：左右两个下拉可用；上下模式：上下两个可用；tapMode ≥ 4 只有「上」「下」两区
  const lr = applies && toggle;
  const ud = !applies || !toggle;
  return (
    <Drawer
      title={t('control_options')}
      onClose={close}
      footer={[
        { label: t('visual_options'), onClick: () => onSwitch('visual') },
        { label: t('miscellaneous'), onClick: () => onSwitch('misc') },
      ]}
    >
      <SelectRow
        slice={screenSettings}
        k="screenState"
        title={t('screen_orientation')}
        options={[
          { value: 0, label: t('orient_auto') },
          { value: 1, label: t('orient_landscape') },
          { value: 2, label: t('orient_portrait') },
          { value: 3, label: t('orient_landscape_rev') },
          { value: 4, label: t('orient_portrait_rev') },
          { value: 5, label: t('orient_landscape_sensor') },
          { value: 6, label: t('orient_portrait_sensor') },
        ]}
      />
      <SelectRow slice={controlSettings} k="doShakePhone" title={t('shake_phone_control')} options={actions()} />

      <Section>{t('screen_touch_control')}</Section>
      <SelectRow slice={controlSettings} k="doTapScreenTop" title={t('tap_screen_top')} options={actions()} disabled={!ud} />
      <SelectRow slice={controlSettings} k="doTapScreenBottom" title={t('tap_screen_bottom')} options={actions()} disabled={!ud} />
      <SwitchRow slice={controlSettings} k="toggleTapMode" title={t('toggle_tap_mode')} disabled={!applies} onGear={openClickTip} />
      <SelectRow slice={controlSettings} k="doTapScreenLeft" title={t('tap_screen_left')} options={actions()} disabled={!lr} />
      <SelectRow slice={controlSettings} k="doTapScreenRight" title={t('tap_screen_right')} options={actions()} disabled={!lr} />
      <Row title={t('set_tap_mode')} onClick={openClickTip} right={<GearButton onClick={openClickTip} />} />
      <SelectRow slice={controlSettings} k="doLongTap" title={t('long_time_tap_control')} options={actions()} />
      <SliderRow slice={controlSettings} k="longTapInterval" title={t('long_tap_interval')} min={0.05} max={2} step={0.05} format={(v) => v.toFixed(2)} />

      <Section>{t('key_press_control')}</Section>
      <KeyRow keyName="PageUp" title={t('key_pageup')} />
      <KeyRow keyName="PageDown" title={t('key_pagedown')} />
      <KeyRow keyName="ArrowUp" title={t('key_up')} />
      <KeyRow keyName="ArrowDown" title={t('key_down')} />
      <KeyRow keyName="ArrowLeft" title={t('key_left')} />
      <KeyRow keyName="ArrowRight" title={t('key_right')} />
      <KeyRow keyName=" " title={t('key_space')} />
      <KeyRow keyName="Enter" title={t('key_center')} />
      <KeyRow keyName="Home" title={t('key_home')} />
      <KeyRow keyName="End" title={t('key_end')} />
      <KeyRow keyName="Ctrl+f" title={t('key_search')} />
      <KeyRow keyName="MediaTrackNext" title={t('key_media_next')} />
      <KeyRow keyName="MediaTrackPrevious" title={t('key_media_prev')} />
      <KeyRow keyName="MediaPlayPause" title={t('key_media_pause')} />
      <KeyRow keyName="Escape" title={t('key_back')} />

      <Section>{t('finger_gesture_control')}</Section>
      <SelectRow slice={controlSettings} k="doSwipeRightToLeft" title={t('right_left')} options={actions()} />
      <SelectRow slice={controlSettings} k="doSwipeLeftToRight" title={t('left_right')} options={actions()} />
      <SelectRow slice={controlSettings} k="doSwipeTopToBottom" title={t('top_bottom')} options={actions()} />
      <SelectRow slice={controlSettings} k="doSwipeBottomToTop" title={t('bottom_top')} options={actions()} />

      <Section>{t('statubar')}</Section>
      <SelectRow slice={controlSettings} k="statusClickLeft" title={t('statubar_click_left')} options={actions()} />
      <SelectRow slice={controlSettings} k="statusClickMiddle" title={t('statubar_click_middle')} options={actions()} />
      <SelectRow slice={controlSettings} k="statusClickRight" title={t('statubar_click_right')} options={actions()} />
      <SelectRow slice={controlSettings} k="statusLongClickLeft" title={t('statubar_long_tap_left')} options={actions()} />
      <SelectRow slice={controlSettings} k="statusLongClickMiddle" title={t('statubar_long_tap_middle')} options={actions()} />
      <SelectRow slice={controlSettings} k="statusLongClickRight" title={t('statubar_long_tap_right')} options={actions()} />

      <ResetRow
        label={t('reset')}
        onClick={() => {
          const d = controlSettings.defaults;
          controlSettings.set({
            tapMode: d.tapMode,
            toggleTapMode: d.toggleTapMode,
            doTapScreenTop: d.doTapScreenTop,
            doTapScreenBottom: d.doTapScreenBottom,
            doTapScreenLeft: d.doTapScreenLeft,
            doTapScreenRight: d.doTapScreenRight,
            doLongTap: d.doLongTap,
            longTapInterval: d.longTapInterval,
            doSwipeLeftToRight: d.doSwipeLeftToRight,
            doSwipeRightToLeft: d.doSwipeRightToLeft,
            doSwipeTopToBottom: d.doSwipeTopToBottom,
            doSwipeBottomToTop: d.doSwipeBottomToTop,
            doShakePhone: d.doShakePhone,
            keyMap: { ...d.keyMap },
            statusClickLeft: d.statusClickLeft,
            statusClickMiddle: d.statusClickMiddle,
            statusClickRight: d.statusClickRight,
            statusLongClickLeft: d.statusLongClickLeft,
            statusLongClickMiddle: d.statusLongClickMiddle,
            statusLongClickRight: d.statusLongClickRight,
          });
        }}
      />
    </Drawer>
  );
}
