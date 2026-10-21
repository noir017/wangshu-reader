// 亮度/蓝光的设置写入（带联动规则）：面板、边缘滑动、长按菜单、设置对话框共用。
import { screenSettings } from '@/reader/settings';
import { toast } from '@/ui';
import { t } from '../messages';
import { uiSettings } from '../ui-settings';
import { stepBrightness } from './brightness';

export function setBrightness(v: number): void {
  const nv = v === -100 ? -100 : Math.max(-50, Math.min(100, Math.round(v)));
  if (screenSettings.get().brightnessValue !== nv) screenSettings.set({ brightnessValue: nv });
}

export function adjustBrightness(delta: number): void {
  setBrightness(stepBrightness(screenSettings.get().brightnessValue, delta));
}

/** 过滤量滑到 0 自动关闭（原版面板规则），非 0 且当前关闭时自动开启 */
export function setBluelightOpacity(v: number): void {
  const nv = Math.max(0, Math.min(95, Math.round(v)));
  if (nv === 0) screenSettings.set({ bluelightEnable: false, bluelightOpacity: uiSettings.get().lastBluelight });
  else {
    uiSettings.set({ lastBluelight: nv });
    screenSettings.set({ bluelightOpacity: nv });
  }
}

export function bluelightToggle(on: boolean): void {
  const s = screenSettings.get();
  if (on) {
    screenSettings.set({ bluelightEnable: true, bluelightOpacity: s.bluelightOpacity > 0 ? s.bluelightOpacity : uiSettings.get().lastBluelight });
    toast(t('bluelight_filter_enabled'));
  } else {
    screenSettings.set({ bluelightEnable: false });
  }
}
