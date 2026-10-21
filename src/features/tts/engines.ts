// 朗读引擎：浏览器 Web Speech（主）与服务端 /api/tts（可选，支持锁屏后台连续朗读 + Media Session）。
import type { TtsRequest, TtsVoice, TtsVoicesResponse } from '@shared/api';
import { apiFetch, apiJson } from '@/core/server';
import { guessLang, pickVoice, type VoiceLike } from './voices';

export interface SpeakOptions {
  /** 倍率：Web Speech 0.1–10；服务端 0.25–4 */
  rate: number;
  /** 0..2 */
  pitch: number;
  /** 0..1 */
  volume: number;
  /** Web：voiceURI；服务端：声音 id；空 = 自动 */
  voice: string;
  /** 书籍/文字语言，自动选声音用 */
  lang: string;
}

export interface SpeakCallbacks {
  onEnd(): void;
  onError(message: string): void;
}

export interface TtsEngine {
  readonly kind: 'web' | 'server';
  speak(text: string, o: SpeakOptions, cb: SpeakCallbacks): void;
  /** 提前取后面几句（服务端合成要时间；Web 不需要） */
  prefetch?(texts: string[], o: SpeakOptions): void;
  cancel(): void;
  destroy(): void;
}

// ───────────── Web Speech ─────────────

export function webSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** getVoices() 在 Chrome 里是异步填充的：先读，空则等 voiceschanged（最多 1.5s） */
export function listWebVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!webSpeechSupported()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener('voiceschanged', done);
      clearTimeout(t);
      resolve(synth.getVoices());
    };
    const t = setTimeout(done, 1500);
    synth.addEventListener('voiceschanged', done);
  });
}

export class WebSpeechEngine implements TtsEngine {
  readonly kind = 'web' as const;
  private voices: SpeechSynthesisVoice[] = [];
  private watchdog?: ReturnType<typeof setTimeout>;
  private current?: SpeechSynthesisUtterance;

  constructor() {
    void listWebVoices().then((v) => (this.voices = v));
  }

  speak(text: string, o: SpeakOptions, cb: SpeakCallbacks): void {
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    const lang = guessLang(o.lang || undefined, text);
    const voice = pickVoice(this.voices.length ? this.voices : synth.getVoices(), o.voice, lang);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else u.lang = lang;
    u.rate = o.rate;
    u.pitch = o.pitch;
    u.volume = o.volume;
    let done = false;
    const finish = (err?: string) => {
      if (done) return;
      done = true;
      clearTimeout(this.watchdog);
      if (err) cb.onError(err);
      else cb.onEnd();
    };
    u.onend = () => finish();
    u.onerror = (e) => {
      // cancel() 会触发 canceled/interrupted，是我们自己取消的，不算错误
      if (e.error === 'canceled' || e.error === 'interrupted') return;
      finish(e.error || 'speech error');
    };
    this.current = u;
    // Chrome 偶发 onend 丢失（长句、后台标签）：按字数估个上限，超时当作读完
    this.watchdog = setTimeout(() => finish(), Math.max(8000, (text.length * 450) / Math.max(0.3, o.rate) + 6000));
    // cancel() 后立刻 speak() 在部分 Chrome 版本里会被吞掉，错开一个 tick
    setTimeout(() => {
      if (this.current === u) synth.speak(u);
    }, 0);
  }

  cancel(): void {
    clearTimeout(this.watchdog);
    this.current = undefined;
    if (webSpeechSupported()) window.speechSynthesis.cancel();
  }

  destroy(): void {
    this.cancel();
  }
}

// ───────────── 服务端 ─────────────

export async function listServerVoices(): Promise<TtsVoice[]> {
  try {
    return (await apiJson<TtsVoicesResponse>('/api/tts/voices')).voices ?? [];
  } catch {
    return [];
  }
}

export class ServerTtsEngine implements TtsEngine {
  readonly kind = 'server' as const;
  private audio = new Audio();
  private cache = new Map<string, Promise<string>>();
  private token = 0;

  constructor() {
    this.audio.preload = 'auto';
  }

  private key(text: string, o: SpeakOptions): string {
    return JSON.stringify([text, o.voice, o.rate, o.pitch]);
  }

  private fetchUrl(text: string, o: SpeakOptions): Promise<string> {
    const k = this.key(text, o);
    let p = this.cache.get(k);
    if (!p) {
      const body: TtsRequest = { text, voice: o.voice || undefined, rate: Math.max(0.25, Math.min(4, o.rate)), pitch: Math.max(0.5, Math.min(2, o.pitch)) };
      p = apiFetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then((r) => r.blob())
        .then((b) => URL.createObjectURL(b));
      p.catch(() => this.cache.delete(k));
      this.cache.set(k, p);
      // 只留最近几句，旧的释放
      while (this.cache.size > 6) {
        const oldest = this.cache.keys().next().value as string;
        const old = this.cache.get(oldest);
        this.cache.delete(oldest);
        void old?.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
      }
    }
    return p;
  }

  speak(text: string, o: SpeakOptions, cb: SpeakCallbacks): void {
    const my = ++this.token;
    this.fetchUrl(text, o).then(
      (url) => {
        if (my !== this.token) return;
        const a = this.audio;
        a.onended = () => my === this.token && cb.onEnd();
        a.onerror = () => my === this.token && cb.onError('audio error');
        a.src = url;
        a.volume = o.volume;
        a.play().catch((e: Error) => my === this.token && cb.onError(e.message));
      },
      (e: Error) => {
        if (my === this.token) cb.onError(e.message);
      },
    );
  }

  prefetch(texts: string[], o: SpeakOptions): void {
    for (const t of texts) void this.fetchUrl(t, o).catch(() => undefined);
  }

  cancel(): void {
    this.token++;
    this.audio.onended = null;
    this.audio.onerror = null;
    this.audio.pause();
  }

  destroy(): void {
    this.cancel();
    this.audio.removeAttribute('src');
    for (const p of this.cache.values()) void p.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
    this.cache.clear();
  }
}

export type { VoiceLike };
