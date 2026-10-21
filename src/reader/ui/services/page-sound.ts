// 翻页声音（ANIM-011）：不用 apk 里的 ogg，用 WebAudio 程序合成 5 种翻页声；也可以播放用户上传的声音文件。
// 配方是纯数据（PAGE_SOUNDS），播放器很薄，便于校验。

export interface SoundEvent {
  kind: 'noise' | 'tone';
  /** 相对开始的秒数 */
  at: number;
  dur: number;
  gain: number;
  /** 噪声滤波器：频率从 from 扫到 to */
  filter?: { type: 'bandpass' | 'lowpass' | 'highpass'; from: number; to: number; q?: number };
  /** 正弦音频率从 [0] 滑到 [1] */
  freq?: [number, number];
}

export const PAGE_SOUNDS: SoundEvent[][] = [
  // 1 纸张：短促的高频沙沙
  [{ kind: 'noise', at: 0, dur: 0.16, gain: 0.5, filter: { type: 'bandpass', from: 5200, to: 3200, q: 0.8 } }],
  // 2 划过：滤波器先升后降的「唰」
  [
    { kind: 'noise', at: 0, dur: 0.12, gain: 0.45, filter: { type: 'bandpass', from: 1800, to: 6000, q: 0.7 } },
    { kind: 'noise', at: 0.1, dur: 0.14, gain: 0.35, filter: { type: 'bandpass', from: 6000, to: 2200, q: 0.7 } },
  ],
  // 3 翻动：两次短促的啪
  [
    { kind: 'noise', at: 0, dur: 0.05, gain: 0.7, filter: { type: 'highpass', from: 2500, to: 2500 } },
    { kind: 'noise', at: 0.09, dur: 0.07, gain: 0.5, filter: { type: 'bandpass', from: 4000, to: 2500, q: 1 } },
  ],
  // 4 轻落：低频的「噗」加一点纸声
  [
    { kind: 'tone', at: 0, dur: 0.13, gain: 0.5, freq: [170, 70] },
    { kind: 'noise', at: 0.01, dur: 0.1, gain: 0.25, filter: { type: 'lowpass', from: 2400, to: 900 } },
  ],
  // 5 翻页：下行的「唰」后接细碎的纸张颤动
  [
    { kind: 'noise', at: 0, dur: 0.2, gain: 0.5, filter: { type: 'bandpass', from: 7000, to: 1500, q: 0.6 } },
    { kind: 'noise', at: 0.17, dur: 0.03, gain: 0.3, filter: { type: 'highpass', from: 3500, to: 3500 } },
    { kind: 'noise', at: 0.22, dur: 0.025, gain: 0.22, filter: { type: 'highpass', from: 4500, to: 4500 } },
  ],
];

export const PAGE_SOUND_COUNT = PAGE_SOUNDS.length;
/** pageSoundIndex 取此值表示用户上传的声音文件 */
export const PAGE_SOUND_USER = 5;
export const PAGE_SOUND_FILE_KV = 'reader.pageSoundFile';

export function soundDuration(events: SoundEvent[]): number {
  return Math.max(...events.map((e) => e.at + e.dur));
}

type Ctx = AudioContext;

export class PageSound {
  private ctx: Ctx | null = null;
  private noise: AudioBuffer | null = null;
  private userBuf: AudioBuffer | null = null;
  private lastPlay = 0;

  get supported(): boolean {
    return typeof AudioContext !== 'undefined' || typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined';
  }

  private ensure(): Ctx | null {
    if (this.ctx) return this.ctx;
    const Ctor = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }

  private noiseBuffer(ctx: Ctx): AudioBuffer {
    if (this.noise) return this.noise;
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // 固定种子的伪随机，保证每次听感一致
    let s = 12345;
    for (let i = 0; i < len; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      d[i] = (s / 0x80000000 - 1) * 0.9;
    }
    this.noise = buf;
    return buf;
  }

  /** 播放内置声音（index 0..4）。需要先有过用户手势，否则浏览器会挂起 AudioContext，静默失败 */
  play(index: number): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = performance.now();
    if (now - this.lastPlay < 120) return;
    this.lastPlay = now;
    void ctx.resume?.();
    const events = PAGE_SOUNDS[Math.max(0, Math.min(PAGE_SOUND_COUNT - 1, index))];
    const t0 = ctx.currentTime + 0.005;
    for (const e of events) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + e.at);
      g.gain.exponentialRampToValueAtTime(e.gain, t0 + e.at + Math.min(0.01, e.dur / 3));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + e.at + e.dur);
      g.connect(ctx.destination);
      if (e.kind === 'noise') {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer(ctx);
        let out: AudioNode = src;
        if (e.filter) {
          const f = ctx.createBiquadFilter();
          f.type = e.filter.type;
          f.Q.value = e.filter.q ?? 0.7;
          f.frequency.setValueAtTime(e.filter.from, t0 + e.at);
          f.frequency.exponentialRampToValueAtTime(Math.max(e.filter.to, 20), t0 + e.at + e.dur);
          src.connect(f);
          out = f;
        }
        out.connect(g);
        src.start(t0 + e.at);
        src.stop(t0 + e.at + e.dur + 0.02);
      } else {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const [f0, f1] = e.freq ?? [150, 80];
        osc.frequency.setValueAtTime(f0, t0 + e.at);
        osc.frequency.exponentialRampToValueAtTime(f1, t0 + e.at + e.dur);
        osc.connect(g);
        osc.start(t0 + e.at);
        osc.stop(t0 + e.at + e.dur + 0.02);
      }
    }
  }

  /** 解码并缓存用户声音文件；返回是否成功 */
  async loadUserFile(blob: Blob): Promise<boolean> {
    const ctx = this.ensure();
    if (!ctx) return false;
    try {
      this.userBuf = await ctx.decodeAudioData(await blob.arrayBuffer());
      return true;
    } catch {
      this.userBuf = null;
      return false;
    }
  }

  playUser(): void {
    const ctx = this.ctx;
    if (!ctx || !this.userBuf) return;
    const now = performance.now();
    if (now - this.lastPlay < 120) return;
    this.lastPlay = now;
    void ctx.resume?.();
    const src = ctx.createBufferSource();
    src.buffer = this.userBuf;
    src.connect(ctx.destination);
    src.start();
  }

  dispose(): void {
    void this.ctx?.close?.();
    this.ctx = null;
    this.noise = null;
    this.userBuf = null;
  }
}

/** 全局单例：设置对话框试听与阅读页共用，避免重复创建 AudioContext */
export const pageSound = new PageSound();
