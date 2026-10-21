// 自动滚屏（AUTO-001..003，§4.6）。6 种模式的公式照原 app，统一换算成 rAF 驱动：
//   0 卷帘·像素 / 1 卷帘·行：文字不动，一条分界线自上而下扫过，线以上换成下一页（盖在旧页上），线到页底即翻页；
//   2 像素平滑：连续滚动（px/s）；3 逐行：每隔一段时间下移一行；4 逐页：计数到阈值翻一页（顶部有进度线）；
//   5 速读 RSVP：界面归 reader/ui，这里什么都不做。
// 触摸（auto_scroll_touch）：单指上下拖 = 调速度（每 20px ±1），点一下 = 暂停/继续，横拖 >80px = 停止。
import { autoScrollSettings, textSettings } from '../settings';
import { lineAt, nextPageTop } from './lines';
import type { Engine } from './controller';
import type { ChapterFrame } from './frame';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** 定时器周期（ms），§4.6 getAutoScrollInterval */
export function scrollInterval(mode: number, speed: number): number {
  const slow = speed < 50 ? (50 - speed) * 2 : 0;
  switch (mode) {
    case 2:
      return speed >= 50 ? (speed - 49) * 10 + 20 : 20;
    case 0: {
      const space = speed >= 50 ? 1 : Math.floor((55 - speed) / 5);
      const i2 = speed >= 50 ? 40 + ((speed - 50) * 150) / 50 : space <= 4 ? 20 + (speed % 5 === 0 ? 5 : speed % 5) * 3 : 25;
      return (i2 * 100) / (slow + 100);
    }
    case 1:
      return 10000 / ((speed < 50 ? 50 - speed : 0) * 2 + 100);
    default:
      return 100;
  }
}

/** 卷帘·像素每次触发前进的像素（整数除法照原式） */
export function rollingStep(speed: number): number {
  const space = speed >= 50 ? 1 : Math.floor((55 - speed) / 5);
  return Math.floor((space * 55) / (55 - (speed < 50 ? 50 - speed : 0)));
}

/** 逐页模式翻页阈值（tick 数，tick = 100ms） */
export function pageThreshold(speed: number): number {
  const f = Math.floor((speed + 20) / 10);
  return (((f * f) / (f + 5)) * 30 * 100) / ((speed < 50 ? (50 - speed) * 2 : 0) + 100);
}

/** 逐行模式每行间隔（ms）：count*5 >= speed 时触发，tick 100ms */
export function lineModePeriod(speed: number): number {
  return Math.max(1, Math.ceil(speed / 5)) * 100;
}

/** 卷帘·行模式每行间隔：count*4 >= speed，tick = scrollInterval(1) */
export function rollingLinePeriod(speed: number): number {
  return Math.max(1, Math.ceil(speed / 4)) * scrollInterval(1, speed);
}

/** 换算成 px/s（用于连续模式与测试；上限防止 speed≈0 时失控） */
export function pixelsPerSecond(mode: number, speed: number): number {
  let v: number;
  if (mode === 2) v = ((speed < 50 ? 50 - speed : 1) / scrollInterval(2, speed)) * 1000;
  else if (mode === 0) v = (rollingStep(speed) / scrollInterval(0, speed)) * 1000;
  else v = 0;
  return Math.min(v, 1800);
}

export class AutoScroller {
  /** 是否在滚（暂停时为 false） */
  running = false;
  private active = false;
  private raf = 0;
  private last = 0;
  private carry = 0;
  private count = 0;
  private mode = 0;
  private bar?: HTMLDivElement;
  // 卷帘会话
  private roll?: { a: ChapterFrame; b: ChapterFrame; aY: number; bY: number; swap?: number; target: { section: number; y: number }; from: { section: number; y: number }; line: number; shadow: HTMLDivElement; rule: HTMLDivElement; lines: number[]; lineIdx: number; lineT: number };
  private starting = false;
  // 触摸
  private tStartY = 0;
  private tSteps = 0;
  private tMoved = false;

  constructor(private e: Engine) {}

  private speed(): number {
    return clamp(autoScrollSettings.get().autoScrollSpeed, 0, 100);
  }

  private emitState(): void {
    this.e.emit('autoScroll', { running: this.running, speed: this.speed() });
  }

  start(): void {
    if (this.active) {
      if (!this.running) this.resume();
      return;
    }
    const mode = autoScrollSettings.get().autoScrollMode;
    if (mode === 5 || this.starting) return; // 速读由 UI 处理
    this.mode = mode;
    this.starting = true;
    void this.begin().finally(() => (this.starting = false));
  }

  private async begin(): Promise<void> {
    const e = this.e;
    e.animator.cancel();
    // 双页期间不能滚屏：回单页重排，位置保持
    this.active = true;
    this.running = true;
    const wantScroll = this.mode === 2 || this.mode === 3;
    const anchor = e.currentAnchor();
    e.autoMode = wantScroll ? 'scroll' : 'paged';
    if (e.dualChanged()) await e.rebuild();
    else if (anchor) await e.showAt(anchor);
    if (!this.active) return;
    this.count = 0;
    this.carry = 0;
    this.last = performance.now();
    this.emitState();
    if (this.mode === 4) this.ensureBar();
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    const was = this.running;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.endRoll(false);
    this.bar?.remove();
    this.bar = undefined;
    const e = this.e;
    const anchor = e.currentAnchor();
    e.autoMode = null;
    if (anchor) void e.showAt(anchor);
    if (was) this.emitState();
    else this.e.emit('autoScroll', { running: false, speed: this.speed() });
  }

  private pause(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.emitState();
  }

  private resume(): void {
    if (this.running || !this.active) return;
    this.running = true;
    this.last = performance.now();
    this.emitState();
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.endRoll(false);
    this.bar?.remove();
    this.active = false;
    this.running = false;
  }

  /** 到书尾：停止 */
  private atBookEnd(): void {
    this.stop();
    this.e.emit('endOfBook', undefined);
  }

  private tick(now: number): void {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const e = this.e;
    const speed = this.speed();
    switch (this.mode) {
      case 2: {
        this.carry += pixelsPerSecond(2, speed) * dt;
        const whole = Math.floor(this.carry);
        if (whole >= 1) {
          this.carry -= whole;
          const moved = e.scrollBy(whole);
          if (moved === 0 && e.getLocation()?.atEnd) return this.atBookEnd();
        }
        break;
      }
      case 3: {
        this.count += dt * 1000;
        if (this.count >= lineModePeriod(speed)) {
          this.count = 0;
          if (!this.scrollOneLine()) return this.atBookEnd();
        }
        break;
      }
      case 4: {
        this.count += dt * 10; // 以 100ms 为一个 tick
        const thr = pageThreshold(speed);
        this.updateBar(this.count / Math.max(1, thr));
        if (this.count >= thr) {
          this.count = 0;
          void this.pageTurn();
        }
        break;
      }
      default:
        this.rollTick(dt, speed);
    }
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  // ───────────── 逐行 ─────────────
  private scrollOneLine(): boolean {
    const e = this.e;
    const f = e.frames.get(e.pos.section);
    if (!f?.loaded) return true;
    const lines = f.getLines();
    const i = lineAt(lines, e.pos.y + 1);
    const next = lines[i + 1];
    if (next) {
      e.scrollBy(next.top - e.pos.y);
      return true;
    }
    const n = e.nextLinear(e.pos.section);
    if (n === null) return false;
    e.scrollBy(Math.max(1, f.height - e.pos.y + 1));
    return true;
  }

  // ───────────── 逐页 ─────────────
  private pageBusy = false;
  private async pageTurn(): Promise<void> {
    if (this.pageBusy) return;
    this.pageBusy = true;
    try {
      const ok = await this.e.turn(1);
      if (!ok) this.atBookEnd();
    } finally {
      this.pageBusy = false;
    }
  }

  private ensureBar(): void {
    if (this.bar || !this.e.root) return;
    const b = document.createElement('div');
    b.style.cssText = 'position:absolute;left:0;top:0;height:2px;width:0;background:#AA666666;z-index:60;pointer-events:none';
    this.e.root.appendChild(b);
    this.bar = b;
  }
  private updateBar(frac: number): void {
    if (this.bar) this.bar.style.width = `${Math.min(this.e.boxW, this.e.boxW * clamp(frac, 0, 1) + 15)}px`;
  }

  // ───────────── 卷帘 ─────────────
  private rollBusy = false;
  private async rollStart(): Promise<void> {
    const e = this.e;
    if (this.rollBusy || this.roll) return;
    this.rollBusy = true;
    try {
      const from = { ...e.pos };
      const target = await e.targetOf(1, from);
      if (!target) return this.atBookEnd();
      const a = e.frames.get(from.section) ?? (await e.ensureFrame(from.section));
      let b: ChapterFrame;
      let swap: number | undefined;
      if (target.section === from.section) {
        b = await e.ensureSpare(target.section);
        swap = target.section;
      } else b = await e.ensureFrame(target.section);
      if (!this.active) return;
      const shadow = document.createElement('div');
      const rule = document.createElement('div');
      const night = this.isDark();
      shadow.style.cssText = `position:absolute;left:0;width:${e.W}px;height:8px;pointer-events:none;z-index:4;background:linear-gradient(to bottom,${night ? 'rgba(0,0,0,.7)' : 'rgba(0,0,0,.35)'},rgba(0,0,0,0))`;
      rule.style.cssText = `position:absolute;left:0;width:${e.W}px;height:1px;pointer-events:none;z-index:5;background:${textSettings.get().fontColor};opacity:.6`;
      e.stage!.appendChild(shadow);
      e.stage!.appendChild(rule);
      // 行模式：分界线按旧页的行底跳
      const lines = a.getLines();
      const first = lineAt(lines, from.y + 1);
      const ys: number[] = [];
      for (let i = first; i < lines.length; i++) {
        const bt = lines[i].bottom - from.y;
        if (bt > e.H) break;
        ys.push(Math.min(e.H, Math.ceil(bt)));
      }
      if (!ys.length || ys[ys.length - 1] < e.H) ys.push(e.H);
      this.roll = { a, b, aY: from.y, bY: target.y, swap, target, from, line: 0, shadow, rule, lines: ys, lineIdx: -1, lineT: 0 };
      for (const f of [...e.frames.values(), ...e.spares.values()]) if (f !== a && f !== b) f.place({ x: 0, y: 0, clipH: 1, innerTop: 0, visible: false });
      this.rollPaint();
    } finally {
      this.rollBusy = false;
    }
  }

  private isDark(): boolean {
    const m = /^#([0-9a-f]{6})/i.exec(textSettings.get().fontColor);
    if (!m) return false;
    const n = parseInt(m[1], 16);
    return (n >> 16) + ((n >> 8) & 255) + (n & 255) > 355;
  }

  private rollPaint(): void {
    const r = this.roll;
    if (!r) return;
    const e = this.e;
    const H = e.H;
    const line = clamp(r.line, 0, H);
    const bg = e.root!.style.background || e.root!.style.backgroundColor;
    r.a.place({ x: 0, y: 0, clipH: e.pageClip(r.a, r.aY), innerTop: r.aY, visible: true, z: 1 });
    r.b.place({ x: 0, y: 0, clipH: Math.min(H, Math.max(1, e.pageClip(r.b, r.bY))), innerTop: r.bY, visible: line > 0, z: 3, clip: `inset(0px 0px ${Math.max(0, H - line)}px 0px)`, bg });
    r.shadow.style.top = `${line}px`;
    r.rule.style.top = `${Math.max(0, line - 1)}px`;
    r.shadow.style.display = r.rule.style.display = line > 0 && line < H ? 'block' : 'none';
  }

  private rollTick(dt: number, speed: number): void {
    const e = this.e;
    if (!this.roll) {
      void this.rollStart();
      return;
    }
    const r = this.roll;
    if (this.mode === 0) {
      r.line += pixelsPerSecond(0, speed) * dt;
    } else {
      r.lineT += dt * 1000;
      if (r.lineT >= rollingLinePeriod(speed)) {
        r.lineT = 0;
        r.lineIdx = Math.min(r.lines.length - 1, r.lineIdx + 1);
        r.line = r.lines[r.lineIdx];
      }
    }
    this.rollPaint();
    if (r.line >= e.H - 0.5) {
      this.endRoll(true);
    }
  }

  private endRoll(commit: boolean): void {
    const r = this.roll;
    if (!r) return;
    this.roll = undefined;
    r.shadow.remove();
    r.rule.remove();
    const e = this.e;
    if (commit) {
      if (r.swap !== undefined) e.swapSpare(r.swap);
      e.commit(r.target, 1, r.from);
    } else {
      e.render();
    }
  }

  // ───────────── 触摸（auto_scroll_touch） ─────────────
  touchStart(_x: number, y: number): void {
    this.tStartY = y;
    this.tSteps = 0;
    this.tMoved = false;
  }

  touchMove(dx: number, dy: number, _x: number, _y: number): void {
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      this.stop();
      return;
    }
    if (Math.abs(dy) > 6) this.tMoved = true;
    const steps = Math.trunc(-dy / 20); // 上拖变快：speed 值变小
    if (steps !== this.tSteps) {
      const s = clamp(this.speed() - (steps - this.tSteps), 0, 100);
      this.tSteps = steps;
      autoScrollSettings.set({ autoScrollSpeed: s });
      this.emitState();
    }
  }

  touchEnd(dx: number, dy: number, dur: number): void {
    if (!this.active) return;
    if (!this.tMoved && Math.abs(dx) < 10 && Math.abs(dy) < 10 && dur < 800) {
      if (this.running) this.pause();
      else this.resume();
    }
  }
}
