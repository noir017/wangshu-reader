// 摇一摇与倾斜翻页（CTRL-008），移植自原 app 的 MyShakeSensorListener。
// 喂入加速度（含重力）采样，检测到时回调；与 DeviceMotion 的接线在 motion-source.ts。
// 注意：jadx 对倾斜检测里「两次动作间隔 >300ms」的布尔极性可能反了，这里按 spec 的语义（间隔 >300ms 才检测）实现。

export interface MotionOptions {
  shakeEnabled: boolean;
  tiltEnabled: boolean;
  /** 倾斜灵敏度阈值（原 tilt_forward_sensitive / tilt_backward_sensitive，0.3..4.3，越小越灵敏） */
  forwardSens: number;
  backwardSens: number;
}

export interface MotionHandlers {
  onShake(): void;
  /** forward = 向前倾斜（原 tilt_down），backward = 向后倾斜（原 tilt_up） */
  onTilt(dir: 'forward' | 'backward'): void;
}

const NO_BASE = 10000;

export class MotionDetector {
  opts: MotionOptions;
  private h: MotionHandlers;
  // 摇一摇
  private lastSensorUpdate = -1;
  private speedTime1 = -1;
  private lastSx = -1;
  private lastSy = 0;
  private lastSz = 0;
  private sxMove1 = 0;
  private lastShakeTime = -1e9;
  // 倾斜
  private tx = -1;
  private ty = 0;
  private tz = 0;
  private baseZ = NO_BASE;
  private holdCount = 0;
  private holdTime = 0;
  private up = 0;
  private down = 0;
  private upTime = 0;
  private downTime = 0;
  private centerTime = 0;
  private actionTime = 0;

  constructor(opts: MotionOptions, handlers: MotionHandlers) {
    this.opts = opts;
    this.h = handlers;
  }

  /** x/y/z：含重力加速度（m/s²，Android 坐标系）；nowMs：单调毫秒 */
  feed(x: number, y: number, z: number, nowMs: number): void {
    // 原版传感器回调约 60ms 一次；DeviceMotion 常见 60Hz，先抽稀到 ≥60ms，阈值才有可比性
    if (this.lastSensorUpdate >= 0 && nowMs - this.lastSensorUpdate <= 60) return;
    const dt = this.lastSensorUpdate < 0 ? 1 : nowMs - this.lastSensorUpdate;
    this.lastSensorUpdate = nowMs;
    if (this.opts.tiltEnabled) this.tilt(x, y, z, nowMs);
    if (this.opts.shakeEnabled) this.shake(x, y, z, nowMs, dt);
  }

  private shake(f: number, f2: number, f3: number, now: number, dt: number): void {
    if (this.speedTime1 !== -1 && now - this.speedTime1 > 500) this.speedTime1 = -1;
    if (this.lastSx === -1) {
      this.lastSx = f;
      this.lastSy = f2;
      this.lastSz = f3;
      return;
    }
    const speed = Math.abs(Math.trunc((((f + f2 + f3 - this.lastSx - this.lastSy - this.lastSz) / Math.max(dt, 1)) * 10000)));
    const i = Math.trunc(f - this.lastSx);
    const i2 = Math.trunc(f2 - this.lastSy);
    if ((Math.abs(i) > 9 || Math.abs(i2) > 9) && (speed > 500 || (this.speedTime1 !== -1 && speed > 400))) {
      if (this.speedTime1 === -1) {
        this.speedTime1 = now;
        this.sxMove1 = i;
      } else {
        const m = this.sxMove1;
        if ((m < 0 && (i > 8 || i2 > 8)) || (m > 0 && (i < -8 || i2 < -8))) {
          if (now - this.lastShakeTime > 2000) {
            this.lastShakeTime = now;
            this.h.onShake();
          }
        }
      }
    }
    this.lastSx = f;
    this.lastSy = f2;
    this.lastSz = f3;
  }

  private tilt(x: number, y: number, z: number, now: number): void {
    if (this.tx === -1) {
      this.tx = x;
      this.ty = y;
      this.tz = z;
      return;
    }
    const i = Math.trunc(x - this.tx);
    const i2 = Math.trunc(y - this.ty);
    const i3 = Math.trunc(z - this.tz);
    const ax = Math.abs(i);
    const ay = Math.abs(i2);
    const az = Math.abs(i3);
    const landscapeish = Math.abs(y) - Math.abs(x) > 5;
    const save = () => {
      this.tx = x;
      this.ty = y;
      this.tz = z;
    };
    if (ax > 4 || ay > 4) {
      this.holdCount = 0;
      this.baseZ = NO_BASE;
      save();
      return;
    }
    if (i === 0 && i2 === 0 && i3 === 0) {
      this.holdCount++;
      if (this.holdCount > 3 && now - this.holdTime > 500) {
        this.holdTime = now;
        if (this.baseZ !== z) {
          this.up = 0;
          this.down = 0;
          this.baseZ = z;
          save();
          return;
        }
      }
    } else {
      this.holdCount = 0;
    }
    const dz = z - this.baseZ;
    const adz = Math.abs(dz);
    const sens = (landscapeish ? 1.4 : 1.0) * (dz > 0 ? this.opts.forwardSens : this.opts.backwardSens);
    if (this.baseZ !== NO_BASE && now - this.actionTime > 300 && !(az < ax || az < ay)) {
      if (dz > sens && (this.up === 0 || adz > -this.up)) {
        if (adz > Math.abs(this.down)) this.down = dz;
        this.downTime = now;
        this.up = 0;
      }
      if (dz < -sens && (this.down === 0 || adz > this.down)) {
        if (adz > -this.up) this.up = dz;
        this.upTime = now;
        this.down = 0;
      }
      if (this.down === 0 || adz >= this.down / 2) {
        if (this.up !== 0 && adz < -this.up / 2 && adz < 0.8) this.centerTime = now;
      } else {
        this.centerTime = now;
      }
      if (this.down !== 0) {
        if (this.centerTime > this.downTime && this.centerTime - this.downTime < 1000) {
          this.h.onTilt('forward');
          this.actionTime = now;
          this.up = 0;
          this.down = 0;
        } else if (now - this.downTime >= 1000) {
          this.down = 0;
        }
      }
      if (this.up !== 0) {
        if (this.centerTime > this.upTime && this.centerTime - this.upTime < 1000) {
          this.h.onTilt('backward');
          this.actionTime = now;
          this.up = 0;
          this.down = 0;
        } else if (now - this.upTime >= 1000) {
          this.up = 0;
        }
      }
    }
    save();
  }
}

/** 倾斜动作取值（原 tilt 对话框的下拉：0 = 向下翻页，1 = 向上翻页，不是 ReaderAction 编号） */
export function tiltPageAction(value: number): 'next' | 'prev' {
  return value === 1 ? 'prev' : 'next';
}

/** 灵敏度滑条（0..40）与阈值（4.3 − p/10）互转 */
export const tiltSensToSlider = (sens: number): number => Math.round(43 - sens * 10);
export const tiltSliderToSens = (p: number): number => Math.round((4.3 - p / 10) * 10) / 10;
