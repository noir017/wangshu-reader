// 朗读服务：把 TtsRunner 接到阅读会话（引擎选择、设置联动、Media Session、屏幕常亮、定时停止）。
import { create } from 'zustand';
import type { Locator } from '@/core/book';
import type { ReaderSession } from '@/core/reader-session';
import { toast } from '@/ui';
import { hasServerFeature } from '../common/server-features';
import { getSectionText, sectionCount } from '../common/section-text';
import { chapterTitleOf } from '../toc/toc-utils';
import { ServerTtsEngine, WebSpeechEngine, webSpeechSupported, type SpeakOptions, type TtsEngine } from './engines';
import { pitchOf, rateOf, volumeOf } from './params';
import { TtsRunner, type RunState } from './runner';
import { ttsSettings } from './settings';
import { tr } from './messages';

interface TtsUi {
  state: RunState;
  /** 朗读面板是否显示 */
  panel: boolean;
}

const IDLE: RunState = { status: 'idle', section: 0, index: 0, total: 0, text: '', remaining: null, once: false };
export const useTts = create<TtsUi>(() => ({ state: IDLE, panel: false }));

let runner: TtsRunner | undefined;
let boundSession: ReaderSession | undefined;
let engine: TtsEngine | undefined;
let offSettings: (() => void) | undefined;
let offRunner: (() => void) | undefined;
let wake: { release(): Promise<void> } | undefined;

function speakOptions(session: ReaderSession): SpeakOptions {
  const s = ttsSettings.get();
  const server = engine?.kind === 'server';
  return {
    rate: server ? Math.max(0.25, Math.min(4, rateOf(s.speed))) : rateOf(s.speed),
    pitch: pitchOf(s.pitch),
    volume: volumeOf(s.volume),
    voice: server ? s.serverVoice : s.voiceURI,
    lang: session.book.metadata.language ?? '',
  };
}

function createRunner(session: ReaderSession): TtsRunner {
  const { controller } = session;
  return new TtsRunner({
    sectionCount: () => sectionCount(controller),
    getText: (s) => getSectionText(controller, s),
    getVisible: () => controller.getLocation()?.visible ?? null,
    isRangeVisible: (r) => controller.isRangeVisible(r),
    atEnd: () => controller.getLocation()?.atEnd ?? false,
    next: () => controller.next(),
    prev: () => controller.prev(),
    goTo: (r) => controller.goTo({ range: r }),
    setHighlight: (r) => controller.setDecorations('tts', r ? [{ id: 'tts', range: r, style: 'tts' }] : []),
    settings: () => {
      const s = ttsSettings.get();
      return {
        divide: s.divide,
        intervalMs: s.intervalEnable ? Math.max(0, s.intervalTime) : 0,
        filters: s.filters,
        filterRegex: s.filterRegex,
        speak: speakOptions(session),
      };
    },
    engine: () => engine!,
  });
}

async function ensureEngine(): Promise<boolean> {
  const want = ttsSettings.get().engine;
  let kind: 'web' | 'server' = want;
  if (kind === 'server' && !(await hasServerFeature('tts'))) {
    toast(tr('serverOff'));
    kind = 'web';
  }
  if (kind === 'web' && !webSpeechSupported()) {
    if (await hasServerFeature('tts')) kind = 'server';
    else {
      toast(tr('unsupported'));
      return false;
    }
  }
  if (engine?.kind !== kind) {
    engine?.destroy();
    engine = kind === 'server' ? new ServerTtsEngine() : new WebSpeechEngine();
  }
  return true;
}

// ───────────── Media Session / 常亮 ─────────────

function bindMediaSession(session: ReaderSession, r: TtsRunner): void {
  const ms = navigator.mediaSession;
  if (!ms) return;
  const loc = session.controller.getLocation();
  try {
    ms.metadata = new MediaMetadata({
      title: session.record.title,
      artist: session.record.authors.join(', '),
      album: loc ? (chapterTitleOf(session.book, loc.locator.section) ?? '') : '',
    });
  } catch {
    /* 老浏览器没有 MediaMetadata */
  }
  const set = (a: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
    try {
      ms.setActionHandler(a, fn);
    } catch {
      /* 该浏览器不支持这个动作 */
    }
  };
  set('play', () => void r.resume());
  set('pause', () => r.pause());
  set('previoustrack', () => void r.prevSentence());
  set('nexttrack', () => void r.nextSentence());
  set('stop', () => r.stop('user'));
}

function unbindMediaSession(): void {
  const ms = navigator.mediaSession;
  if (!ms) return;
  for (const a of ['play', 'pause', 'previoustrack', 'nexttrack', 'stop'] as MediaSessionAction[]) {
    try {
      ms.setActionHandler(a, null);
    } catch {
      /* 忽略 */
    }
  }
  ms.playbackState = 'none';
}

async function syncWakeLock(playing: boolean): Promise<void> {
  const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
  if (playing && ttsSettings.get().keepAwake && wl && !wake) {
    try {
      wake = await wl.request('screen');
    } catch {
      /* 没权限/不支持：忽略 */
    }
  } else if (!playing && wake) {
    void wake.release().catch(() => undefined);
    wake = undefined;
  }
}

// ───────────── 对外 ─────────────

function bind(session: ReaderSession): TtsRunner {
  if (runner && boundSession === session) return runner;
  destroyTts();
  boundSession = session;
  runner = createRunner(session);
  offRunner = runner.subscribe((state) => {
    const prev = useTts.getState().state;
    useTts.setState({ state, panel: state.status !== 'idle' ? true : false });
    void syncWakeLock(state.status === 'playing');
    if (navigator.mediaSession) navigator.mediaSession.playbackState = state.status === 'playing' ? 'playing' : state.status === 'paused' ? 'paused' : 'none';
    if (prev.status !== 'idle' && state.status === 'idle') {
      unbindMediaSession();
      if (state.stopReason === 'timer') toast(tr('stoppedTimer'));
      else if (state.stopReason === 'error') toast(tr('failed', { msg: state.error ?? '' }));
    }
  });
  // 语速/音调/声音/划分/过滤…变了：立即生效（原版：松手后 restore_speak）
  offSettings = ttsSettings.subscribe((next, prev) => {
    const r = runner;
    if (!r || r.state.status !== 'playing' || r.state.once) return;
    const structural = next.divide !== prev.divide || next.filters !== prev.filters || next.filterRegex !== prev.filterRegex || next.engine !== prev.engine;
    const audible = next.speed !== prev.speed || next.pitch !== prev.pitch || next.volume !== prev.volume || next.voiceURI !== prev.voiceURI || next.serverVoice !== prev.serverVoice;
    if (structural) {
      const pos = r.position();
      void ensureEngine().then((ok) => ok && void r.start(pos ?? undefined));
    } else if (audible) void r.restart();
  });
  return runner;
}

export function getRunner(): TtsRunner | undefined {
  return runner;
}

/** 开始连续朗读（from 缺省：当前页首）。不弹选项对话框 */
export async function startReading(session: ReaderSession, from?: Locator, opts: { stopMinutes?: number | null } = {}): Promise<void> {
  const r = bind(session);
  if (!(await ensureEngine())) return;
  bindMediaSession(session, r);
  const s = ttsSettings.get();
  const minutes = opts.stopMinutes !== undefined ? opts.stopMinutes : s.stopEnable ? s.stopTime : null;
  r.setStopTimer(null);
  await r.start(from ? { section: from.section, offset: from.offset } : undefined);
  if (r.state.status !== 'idle') r.setStopTimer(minutes);
  else if (r.state.stopReason === 'end') toast(tr('finished'));
}

/** 朗读一段文字（选择条「朗读」、剪贴板），读完即停，不翻页 */
export async function speakText(session: ReaderSession, text: string): Promise<void> {
  const r = bind(session);
  if (!(await ensureEngine())) return;
  bindMediaSession(session, r);
  await r.speakOnce(text);
}

export function stopReading(): void {
  runner?.stop('user');
}

export function destroyTts(): void {
  offSettings?.();
  offRunner?.();
  offSettings = offRunner = undefined;
  runner?.destroy();
  runner = undefined;
  engine?.destroy();
  engine = undefined;
  boundSession = undefined;
  unbindMediaSession();
  void syncWakeLock(false);
  useTts.setState({ state: IDLE, panel: false });
}
