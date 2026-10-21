// 系统相关能力：屏幕常亮（Wake Lock）、全屏、屏幕方向、健康提醒判定。浏览器不支持时都要优雅降级。

// ───────────── 屏幕常亮（VIEW-013） ─────────────
interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener?(type: 'release', fn: () => void): void;
}
export interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

function defaultWakeLockApi(): WakeLockApi | null {
  const wl = (globalThis.navigator as unknown as { wakeLock?: WakeLockApi } | undefined)?.wakeLock;
  return wl ?? null;
}

/**
 * keepScreenAwake 开时持有 wake lock；无操作超过 extendMinutes 分钟后释放（100 = 永不）；
 * 自动滚屏/朗读/速读期间（force）永远持有；页面回到前台时重新申请。
 */
export class AwakeController {
  private lock: WakeLockSentinelLike | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private keep = false;
  private extendMin = 5;
  private force = false;
  private acquiring = false;
  private disposed = false;

  constructor(private readonly api: WakeLockApi | null = defaultWakeLockApi()) {}

  get supported(): boolean {
    return !!this.api;
  }

  get held(): boolean {
    return this.lock !== null;
  }

  configure(keep: boolean, extendMinutes: number): void {
    this.keep = keep;
    this.extendMin = extendMinutes;
    if (!keep) void this.release();
    else this.activity();
  }

  setForce(force: boolean): void {
    this.force = force;
    if (force) this.activity();
    else this.schedule();
  }

  /** 用户有操作：刷新计时，必要时重新申请 */
  activity(): void {
    if (!this.keep && !this.force) return;
    void this.acquire();
    this.schedule();
  }

  /** 页面可见性变化（回前台后系统会自动释放过的 lock 需要重新申请） */
  visibilityChanged(visible: boolean): void {
    if (visible) this.activity();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (this.force || !this.keep || this.extendMin >= 100) return;
    this.timer = setTimeout(() => void this.release(), this.extendMin * 60_000);
  }

  private async acquire(): Promise<void> {
    if (!this.api || this.lock || this.acquiring || this.disposed) return;
    this.acquiring = true;
    try {
      const l = await this.api.request('screen');
      if (this.disposed) {
        void l.release();
        return;
      }
      this.lock = l;
      l.addEventListener?.('release', () => {
        if (this.lock === l) this.lock = null;
      });
    } catch {
      /* 电量低/未获手势：忽略，下次操作再试 */
    } finally {
      this.acquiring = false;
    }
  }

  async release(): Promise<void> {
    clearTimeout(this.timer);
    const l = this.lock;
    this.lock = null;
    try {
      await l?.release();
    } catch {
      /* 已被系统释放 */
    }
  }

  dispose(): void {
    this.disposed = true;
    void this.release();
  }
}

// ───────────── 全屏（VIEW-012） ─────────────
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

export function fullscreenSupported(): boolean {
  const el = document.documentElement as FsEl;
  return !!(el.requestFullscreen ?? el.webkitRequestFullscreen);
}

/** 必须在用户手势里调用；失败返回 false */
export async function enterFullscreen(el: HTMLElement = document.documentElement): Promise<boolean> {
  try {
    const e = el as FsEl;
    if (e.requestFullscreen) await e.requestFullscreen();
    else if (e.webkitRequestFullscreen) await e.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  try {
    const d = document as FsDoc;
    if (d.exitFullscreen) await d.exitFullscreen();
    else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
  } catch {
    /* 已不在全屏 */
  }
}

// ───────────── 屏幕方向（VIEW-011） ─────────────
type OrientationLock = 'any' | 'natural' | 'landscape' | 'portrait' | 'portrait-primary' | 'portrait-secondary' | 'landscape-primary' | 'landscape-secondary';

/** screenState：0自动 1横 2竖 3反横 4反竖 5横感应 6竖感应 → Screen Orientation 锁定值（null = 解锁） */
export function screenStateToLock(state: number): OrientationLock | null {
  switch (state) {
    case 1:
      return 'landscape-primary';
    case 2:
      return 'portrait-primary';
    case 3:
      return 'landscape-secondary';
    case 4:
      return 'portrait-secondary';
    case 5:
      return 'landscape';
    case 6:
      return 'portrait';
    default:
      return null;
  }
}

interface OrientationApi {
  type: string;
  lock?: (o: OrientationLock) => Promise<void>;
  unlock?: () => void;
}

function orientationApi(): OrientationApi | null {
  return (globalThis.screen as unknown as { orientation?: OrientationApi } | undefined)?.orientation ?? null;
}

export function orientationSupported(): boolean {
  const o = orientationApi();
  return !!o && typeof o.lock === 'function';
}

export type OrientationResult = { ok: true } | { ok: false; reason: 'unsupported' | 'failed'; message?: string };

export async function applyScreenState(state: number): Promise<OrientationResult> {
  const o = orientationApi();
  if (!o || typeof o.lock !== 'function') return { ok: false, reason: 'unsupported' };
  const lock = screenStateToLock(state);
  try {
    if (lock === null) o.unlock?.();
    else await o.lock(lock);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'failed', message: (e as Error).message };
  }
}

/** 按钮 0 的点击：当前为横屏或 screenState==5 → 6（竖屏感应），否则 5（横屏感应） */
export function nextScreenState(current: number, isLandscapeNow: boolean): number {
  return isLandscapeNow || current === 5 ? 6 : 5;
}

export function isLandscapeNow(): boolean {
  const o = orientationApi();
  if (o?.type) return o.type.startsWith('landscape');
  return globalThis.innerWidth > globalThis.innerHeight;
}

// ───────────── 健康提醒（VIEW-019） ─────────────
/** 连续阅读超过 N 分钟 */
export function shouldRemind1(sessionMs: number, minutes: number): boolean {
  return minutes > 0 && sessionMs >= minutes * 60_000;
}

/** 固定时间提醒：到点后 15 分钟内触发一次（lastShownDay 为上次触发的本地日期序号，避免重复） */
export function shouldRemind2(now: Date, hour: number, minute: number, lastShownDay: number): boolean {
  const dayNo = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000);
  if (dayNo === lastShownDay) return false;
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0).getTime();
  const diff = now.getTime() - target;
  return diff >= 0 && diff <= 15 * 60_000;
}

export function localDayNo(now: Date): number {
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000);
}
