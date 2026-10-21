// 倾斜翻页与摇一摇（CTRL-008 / §4.10）的判定算法：DeviceMotion 加速度采样 → 手势判定。
// 这里只放判定算法；监听 devicemotion 并执行绑定动作由 reader/ui（hooks/session-system.ts）负责，
// 因为绑定的可以是任意动作（动作分发在界面层），引擎再监听一份会导致同一次倾斜翻两页。

export type TiltResult = 'forward' | 'backward' | null;

const STILL_EPS = 0.05;

/**
 * 倾斜判定（§4.10）：|Δx|>4 或 |Δy|>4 视为晃动并重置；静止（Δ 全 ≈0）累计 >3 次且距上次 >500ms 记基准 z；
 * dz = z − baseZ，超过灵敏度阈值记峰值方向（dz>fwd 向前/下，dz<−back 向后/上，横屏灵敏度 ×1.4）；
 * |dz| 回落到峰值一半以内 = 「回中」；峰值到回中 <1000ms 且距上次触发 >300ms → 触发。
 */
export class TiltDetector {
  private last?: { x: number; y: number; z: number };
  private still = 0;
  private baseT = -Infinity;
  private baseZ: number | null = null;
  private peak: { dir: 'fwd' | 'back'; v: number; t0: number } | null = null;
  private lastTrig = -Infinity;

  constructor(
    private fwd: number,
    private back: number,
    /** 横屏时灵敏度阈值 ×1.4 */
    public landscape = false,
  ) {}

  setSensitivity(fwd: number, back: number): void {
    this.fwd = fwd;
    this.back = back;
  }

  reset(): void {
    this.still = 0;
    this.baseZ = null;
    this.peak = null;
  }

  push(t: number, x: number, y: number, z: number): TiltResult {
    const l = this.last;
    this.last = { x, y, z };
    if (l) {
      const dx = Math.abs(x - l.x);
      const dy = Math.abs(y - l.y);
      if (dx > 4 || dy > 4) {
        this.reset();
        return null;
      }
      if (dx < STILL_EPS && dy < STILL_EPS && Math.abs(z - l.z) < STILL_EPS) {
        this.still++;
        if (this.still > 3 && t - this.baseT > 500) {
          this.baseZ = z;
          this.baseT = t;
          this.peak = null;
        }
      } else this.still = 0;
    }
    if (this.baseZ === null) return null;
    const k = this.landscape ? 1.4 : 1;
    const dz = z - this.baseZ;
    if (!this.peak) {
      if (dz > this.fwd * k) this.peak = { dir: 'fwd', v: dz, t0: t };
      else if (dz < -this.back * k) this.peak = { dir: 'back', v: -dz, t0: t };
      return null;
    }
    const cur = this.peak.dir === 'fwd' ? dz : -dz;
    if (cur > this.peak.v) {
      this.peak.v = cur;
      return null;
    }
    if (cur < this.peak.v / 2) {
      const p = this.peak;
      this.peak = null;
      if (t - p.t0 < 1000 && t - this.lastTrig > 300) {
        this.lastTrig = t;
        return p.dir === 'fwd' ? 'forward' : 'backward';
      }
    }
    return null;
  }
}

/**
 * 摇一摇判定（CTRL-008）：采样间隔 >60ms；|Δx|>9 或 |Δy|>9 且加权加速度 (|Δx|+|Δy|+|Δz|)/Δt×10000 >500 记第一次；
 * 500ms 内反方向再来一次（分量 >8、加权 >400）触发；两次触发间隔 ≥2000ms。
 */
export class ShakeDetector {
  private last?: { t: number; x: number; y: number; z: number };
  private first: { t: number; axis: 'x' | 'y'; sign: number } | null = null;
  private lastTrig = -Infinity;

  push(t: number, x: number, y: number, z: number): boolean {
    const l = this.last;
    if (l && t - l.t <= 60) return false;
    this.last = { t, x, y, z };
    if (!l) return false;
    const dt = t - l.t;
    const dx = x - l.x;
    const dy = y - l.y;
    const dz = z - l.z;
    const speed = ((Math.abs(dx) + Math.abs(dy) + Math.abs(dz)) / dt) * 10000;
    const axis: 'x' | 'y' = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    const d = axis === 'x' ? dx : dy;
    if (this.first && t - this.first.t < 500) {
      if (axis === this.first.axis && Math.sign(d) === -this.first.sign && Math.abs(d) > 8 && speed > 400) {
        this.first = null;
        if (t - this.lastTrig >= 2000) {
          this.lastTrig = t;
          return true;
        }
        return false;
      }
    } else this.first = null;
    if ((Math.abs(dx) > 9 || Math.abs(dy) > 9) && speed > 500) this.first = { t, axis, sign: Math.sign(d) };
    return false;
  }
}
