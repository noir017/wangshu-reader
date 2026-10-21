// 语速/音调/音量映射（TTS-005）。存储值 10 = 1×。
// 语速滑块 0..40：进度≤30 时值=进度（0 视为 1），>30 时值=30+(进度-30)*2，最高 50（5×）。

export const SPEED_SLIDER_MAX = 40;
export const PITCH_MAX = 20;

export function sliderToSpeed(p: number): number {
  const x = Math.max(0, Math.min(SPEED_SLIDER_MAX, Math.round(p)));
  if (x <= 0) return 1;
  return x <= 30 ? x : 30 + (x - 30) * 2;
}

export function speedToSlider(v: number): number {
  const x = Math.max(1, Math.min(50, Math.round(v)));
  return x <= 30 ? x : 30 + Math.round((x - 30) / 2);
}

/** 音调滑块 0..20，进度≤0 视为 1 */
export function sliderToPitch(p: number): number {
  return Math.max(1, Math.min(PITCH_MAX, Math.round(p)));
}

export const rateOf = (speed: number): number => Math.max(0.1, Math.min(5, speed / 10));
export const pitchOf = (pitch: number): number => Math.max(0.1, Math.min(2, pitch / 10));
export const volumeOf = (v: number): number => Math.max(0, Math.min(1, v / 100));

/** 面板上显示的倍数，如 1.0× */
export const formatTimes = (v: number): string => `${(v / 10).toFixed(1)}×`;

/** 「重置」按钮：速度或音调不是 10 时才出现 */
export const canReset = (speed: number, pitch: number): boolean => speed !== 10 || pitch !== 10;

/** 倒计时显示：>10 秒 mm:ss 小字；≤10 秒大号红色数字 */
export function countdownView(sec: number): { text: string; urgent: boolean } {
  const s = Math.max(0, Math.ceil(sec));
  if (s <= 10) return { text: String(s), urgent: true };
  return { text: `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`, urgent: false };
}
