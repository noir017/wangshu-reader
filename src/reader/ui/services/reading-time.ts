// 阅读时长与字数采集（STAT-001）：只在页面可见且用户 10 分钟内有操作时计时；
// 自动滚屏/朗读期间不判空闲；空闲超过 10 分钟后再次操作，起点回退到「1 分钟前」（即补记 1 分钟）。
// 采集结果按 flushMs 定时、以及切后台/退出时写库（addReadingTime，按本地日期归档）。

const IDLE_MS = 10 * 60_000;
const IDLE_CREDIT_MS = 60_000;

/** T.getWordsCount：中日韩按字、其他按词 */
export function countWords(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const rest = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ');
  const words = rest.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  return cjk + words;
}

export interface ReadingTrackerOptions {
  /** 写库（通常是 addReadingTime(bookId, ms, words)） */
  save(ms: number, words: number): void | Promise<void>;
  now?: () => number;
  isVisible?: () => boolean;
  /** 写库间隔，毫秒 */
  flushMs?: number;
}

export class ReadingTracker {
  private pendingMs = 0;
  private pendingWords = 0;
  private lastTick: number;
  private lastActive: number;
  private lastFlush: number;
  private exempt = false;
  private idleCredited = true;
  private readonly now: () => number;
  private readonly visible: () => boolean;
  private readonly flushMs: number;
  /** 本次会话累计的有效阅读毫秒（健康提醒用，自动滚屏/朗读期间不计） */
  sessionMs = 0;

  constructor(private readonly opts: ReadingTrackerOptions) {
    this.now = opts.now ?? Date.now;
    this.visible = opts.isVisible ?? (() => globalThis.document?.visibilityState !== 'hidden');
    this.flushMs = opts.flushMs ?? 30_000;
    this.lastTick = this.lastActive = this.lastFlush = this.now();
  }

  /** 用户有操作（触摸/按键/翻页） */
  touch(): void {
    const n = this.now();
    if (n - this.lastActive > IDLE_MS && !this.exempt) {
      this.pendingMs += IDLE_CREDIT_MS;
      this.sessionMs += IDLE_CREDIT_MS;
    }
    this.lastActive = n;
    this.idleCredited = true;
  }

  /** 自动滚屏/朗读/速读期间不算空闲 */
  setExempt(v: boolean): void {
    this.exempt = v;
    if (v) this.lastActive = this.now();
  }

  /** 前进翻页，累计本页字数 */
  addWords(n: number): void {
    if (n > 0) this.pendingWords += n;
  }

  /** 每秒（或更低频）调用 */
  tick(): void {
    const n = this.now();
    const dt = Math.min(Math.max(n - this.lastTick, 0), 5_000);
    this.lastTick = n;
    const active = this.visible() && (this.exempt || n - this.lastActive <= IDLE_MS);
    if (active) {
      this.pendingMs += dt;
      if (!this.exempt) this.sessionMs += dt;
    }
    if (n - this.lastFlush >= this.flushMs) this.flush();
  }

  flush(): void {
    const ms = Math.round(this.pendingMs);
    const words = this.pendingWords;
    this.lastFlush = this.now();
    if (ms <= 0 && words <= 0) return;
    this.pendingMs = 0;
    this.pendingWords = 0;
    void this.opts.save(ms, words);
  }

  /** 重置连续阅读计时（提醒后） */
  resetSession(): void {
    this.sessionMs = 0;
  }
}
