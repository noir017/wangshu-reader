// 朗读状态机（TTS-001/003/004/006/007）：不依赖 React/浏览器，引擎与阅读器都经 RunnerHost 注入，便于单测。
//
// 流程：从当前页首起取章节文本 → 分句 → 逐句交给引擎 → 句末回调推进；当前句高亮；
// 下一句不在屏内就翻页（先 next()，仍不可见再 goTo）；章末自动接下一章；书末停止。
import { splitTtsLines, type DivideMode } from './split';
import { toSpeakText, type TtsFilter } from './filter';
import type { SpeakOptions, TtsEngine } from './engines';

export interface RunnerHost {
  sectionCount(): number;
  getText(section: number): Promise<string>;
  /** 当前屏可见区间；未就绪返回 null */
  getVisible(): { section: number; start: number; end: number } | null;
  isRangeVisible(r: { section: number; start: number; end: number }): boolean;
  atEnd(): boolean;
  next(): Promise<void>;
  prev(): Promise<void>;
  goTo(r: { section: number; start: number; end: number }): Promise<void>;
  /** null = 清除高亮 */
  setHighlight(r: { section: number; start: number; end: number } | null): void;
  settings(): {
    divide: DivideMode;
    intervalMs: number;
    filters: TtsFilter[];
    filterRegex: boolean;
    speak: SpeakOptions;
  };
  engine(): TtsEngine;
}

export type RunStatus = 'idle' | 'playing' | 'paused';

export interface RunState {
  status: RunStatus;
  section: number;
  index: number;
  total: number;
  /** 当前句要读的文字 */
  text: string;
  /** 定时停止剩余秒数；null = 未启用 */
  remaining: number | null;
  /** 朗读选中文字（一次性，不翻页） */
  once: boolean;
  error?: string;
  /** 最近一次停止的原因 */
  stopReason?: 'user' | 'end' | 'timer' | 'error';
}

interface Line {
  start: number;
  end: number;
  speak: string;
}

const INITIAL: RunState = { status: 'idle', section: 0, index: 0, total: 0, text: '', remaining: null, once: false };

export class TtsRunner {
  state: RunState = { ...INITIAL };
  private lines: Line[] = [];
  private section = 0;
  private index = 0;
  private epoch = 0;
  private once = false;
  private listeners = new Set<(s: RunState) => void>();
  private timer?: ReturnType<typeof setInterval>;
  private deadline = 0;
  private gap?: ReturnType<typeof setTimeout>;

  constructor(private host: RunnerHost) {}

  /** 当前句的位置（设置变化后从这里重新取句） */
  position(): { section: number; offset: number } | null {
    const l = this.lines[this.index];
    return l && this.section >= 0 ? { section: this.section, offset: l.start } : null;
  }

  subscribe(fn: (s: RunState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<RunState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l(this.state);
  }

  private cancelEngine(): void {
    clearTimeout(this.gap);
    this.gap = undefined;
    this.host.engine().cancel();
  }

  // ───────────── 取句子 ─────────────

  private lineOf(text: string): Line[] {
    const cfg = this.host.settings();
    return splitTtsLines(text, cfg.divide)
      .map((l) => ({ start: l.start, end: l.end, speak: toSpeakText(l.text, cfg.filters, cfg.filterRegex) }))
      .filter((l) => l.speak !== '');
  }

  /** 从 (section, offset) 起找第一章有可读句子的位置；找不到返回 false */
  private async loadFrom(section: number, offset: number, epoch: number): Promise<boolean> {
    for (let s = section; s < this.host.sectionCount(); s++) {
      const text = await this.host.getText(s).catch(() => '');
      if (epoch !== this.epoch) return false;
      const lines = this.lineOf(text);
      const from = s === section ? offset : 0;
      const first = lines.findIndex((l) => l.end > from);
      if (first >= 0) {
        this.section = s;
        this.lines = lines;
        this.index = first;
        return true;
      }
    }
    return false;
  }

  /** 整页模式：只读当前屏的文字 */
  private async loadPage(epoch: number): Promise<boolean> {
    const vis = this.host.getVisible();
    if (!vis) return false;
    const text = await this.host.getText(vis.section).catch(() => '');
    if (epoch !== this.epoch) return false;
    const cfg = this.host.settings();
    const raw = text.slice(vis.start, vis.end);
    const speak = toSpeakText(raw, cfg.filters, cfg.filterRegex);
    if (!speak) return false;
    this.section = vis.section;
    this.lines = [{ start: vis.start, end: vis.end, speak }];
    this.index = 0;
    return true;
  }

  // ───────────── 对外操作 ─────────────

  /** 从 from（缺省：当前页首）开始连续朗读整本书 */
  async start(from?: { section: number; offset: number }): Promise<void> {
    this.cancelEngine();
    const epoch = ++this.epoch;
    this.once = false;
    const vis = this.host.getVisible();
    const at = from ?? (vis ? { section: vis.section, offset: vis.start } : { section: 0, offset: 0 });
    this.set({ status: 'playing', once: false, error: undefined, stopReason: undefined });
    const ok = this.host.settings().divide === 3 ? await this.loadPage(epoch) : await this.loadFrom(at.section, at.offset, epoch);
    if (epoch !== this.epoch) return;
    if (!ok) return this.finish('end');
    await this.speakCurrent();
  }

  /** 一次性朗读一段文字（选择条「朗读」/剪贴板），不翻页 */
  async speakOnce(text: string): Promise<void> {
    this.cancelEngine();
    const epoch = ++this.epoch;
    this.once = true;
    this.host.setHighlight(null);
    const lines = this.lineOf(text);
    if (!lines.length) return this.finish('end');
    this.lines = lines;
    this.index = 0;
    this.section = -1;
    this.set({ status: 'playing', once: true, error: undefined, stopReason: undefined });
    if (epoch === this.epoch) await this.speakCurrent();
  }

  pause(): void {
    if (this.state.status !== 'playing') return;
    this.epoch++;
    this.cancelEngine();
    this.set({ status: 'paused' });
  }

  async resume(): Promise<void> {
    if (this.state.status !== 'paused') return;
    this.set({ status: 'playing' });
    await this.speakCurrent();
  }

  async toggle(): Promise<void> {
    if (this.state.status === 'playing') this.pause();
    else if (this.state.status === 'paused') await this.resume();
  }

  stop(reason: 'user' | 'end' | 'timer' | 'error' = 'user', error?: string): void {
    this.finish(reason, error);
  }

  private finish(reason: 'user' | 'end' | 'timer' | 'error', error?: string): void {
    this.epoch++;
    this.cancelEngine();
    clearInterval(this.timer);
    this.timer = undefined;
    this.host.setHighlight(null);
    this.lines = [];
    this.set({ status: 'idle', stopReason: reason, error, remaining: null, text: '', index: 0, total: 0, once: false });
  }

  /** 设置/取消定时停止；minutes 为空或 ≤0 取消 */
  setStopTimer(minutes: number | null): void {
    clearInterval(this.timer);
    this.timer = undefined;
    if (!minutes || minutes <= 0) return this.set({ remaining: null });
    this.deadline = Date.now() + minutes * 60_000;
    this.set({ remaining: minutes * 60 });
    this.timer = setInterval(() => {
      const left = Math.ceil((this.deadline - Date.now()) / 1000);
      if (left <= 0) this.finish('timer');
      else this.set({ remaining: left });
    }, 1000);
  }

  /** 设置（语速、声音、划分方式…）变了：重读当前句使其立即生效 */
  async restart(): Promise<void> {
    if (this.state.status !== 'playing') return;
    this.cancelEngine();
    ++this.epoch;
    await this.speakCurrent();
  }

  async nextSentence(): Promise<void> {
    if (this.state.status === 'idle') return;
    this.cancelEngine();
    const epoch = ++this.epoch;
    if (this.index < this.lines.length - 1) {
      this.index++;
      this.set({ status: 'playing' });
      return this.speakCurrent();
    }
    if (this.once) return this.finish('end');
    await this.advanceSection(epoch);
  }

  async prevSentence(): Promise<void> {
    if (this.state.status === 'idle') return;
    this.cancelEngine();
    const epoch = ++this.epoch;
    if (this.index > 0) {
      this.index--;
      this.set({ status: 'playing' });
      return this.speakCurrent();
    }
    if (this.once) {
      this.set({ status: 'playing' });
      return this.speakCurrent();
    }
    for (let s = this.section - 1; s >= 0; s--) {
      const text = await this.host.getText(s).catch(() => '');
      if (epoch !== this.epoch) return;
      const lines = this.lineOf(text);
      if (lines.length) {
        this.section = s;
        this.lines = lines;
        this.index = lines.length - 1;
        this.set({ status: 'playing' });
        return this.speakCurrent();
      }
    }
    this.set({ status: 'playing' });
    await this.speakCurrent();
  }

  /** 翻页并从新页首接着读（once 模式下无意义，忽略） */
  async nextPage(): Promise<void> {
    if (this.state.status === 'idle' || this.once) return;
    this.cancelEngine();
    ++this.epoch;
    await this.host.next();
    await this.start();
  }

  async prevPage(): Promise<void> {
    if (this.state.status === 'idle' || this.once) return;
    this.cancelEngine();
    ++this.epoch;
    await this.host.prev();
    await this.start();
  }

  // ───────────── 内部推进 ─────────────

  private async advanceSection(epoch: number): Promise<void> {
    if (this.host.settings().divide === 3) {
      if (this.host.atEnd()) return this.finish('end');
      await this.host.next();
      if (epoch !== this.epoch) return;
      if (!(await this.loadPage(epoch))) return epoch === this.epoch ? this.finish('end') : undefined;
      return this.speakCurrent();
    }
    if (!(await this.loadFrom(this.section + 1, 0, epoch))) return epoch === this.epoch ? this.finish('end') : undefined;
    await this.speakCurrent();
  }

  private async ensureVisible(line: Line, epoch: number): Promise<void> {
    if (this.once || this.host.settings().divide === 3) return;
    const range = { section: this.section, start: line.start, end: line.end };
    if (this.host.isRangeVisible(range)) return;
    const vis = this.host.getVisible();
    if (vis && vis.section === this.section && line.start >= vis.end) {
      await this.host.next();
      if (epoch !== this.epoch || this.host.isRangeVisible(range)) return;
    }
    await this.host.goTo(range);
  }

  private async speakCurrent(): Promise<void> {
    const epoch = this.epoch;
    const line = this.lines[this.index];
    if (!line) return this.finish('end');
    if (!this.once && this.host.settings().divide !== 3) this.host.setHighlight({ section: this.section, start: line.start, end: line.end });
    this.set({ section: this.section, index: this.index, total: this.lines.length, text: line.speak, status: 'playing' });
    await this.ensureVisible(line, epoch);
    if (epoch !== this.epoch) return;
    const cfg = this.host.settings();
    const engine = this.host.engine();
    engine.prefetch?.(
      this.lines.slice(this.index + 1, this.index + 3).map((l) => l.speak),
      cfg.speak,
    );
    engine.speak(line.speak, cfg.speak, {
      onEnd: () => {
        if (epoch !== this.epoch) return;
        const gap = cfg.intervalMs;
        if (gap > 0) this.gap = setTimeout(() => void this.afterLine(epoch), gap);
        else void this.afterLine(epoch);
      },
      onError: (msg) => {
        if (epoch !== this.epoch) return;
        this.finish('error', msg);
      },
    });
  }

  private async afterLine(epoch: number): Promise<void> {
    if (epoch !== this.epoch || this.state.status !== 'playing') return;
    if (this.index < this.lines.length - 1) {
      this.index++;
      return this.speakCurrent();
    }
    if (this.once) return this.finish('end');
    await this.advanceSection(epoch);
  }

  destroy(): void {
    this.finish('user');
    this.listeners.clear();
  }
}
