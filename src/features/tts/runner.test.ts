import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtsRunner, type RunnerHost } from './runner';
import type { SpeakCallbacks, SpeakOptions, TtsEngine } from './engines';
import { DEFAULT_FILTERS } from './filter';
import type { DivideMode } from './split';

const OPTS: SpeakOptions = { rate: 1, pitch: 1, volume: 1, voice: '', lang: 'zh' };

class FakeEngine implements TtsEngine {
  kind = 'web' as const;
  spoken: string[] = [];
  cb?: SpeakCallbacks;
  cancels = 0;
  speak(text: string, _o: SpeakOptions, cb: SpeakCallbacks) {
    this.spoken.push(text);
    this.cb = cb;
  }
  cancel() {
    this.cancels++;
    this.cb = undefined;
  }
  destroy() {}
  /** 当前句读完 */
  finishLine() {
    const cb = this.cb;
    this.cb = undefined;
    cb?.onEnd();
  }
  fail(msg: string) {
    this.cb?.onError(msg);
  }
}

function makeHost(sections: string[], over: { divide?: DivideMode; intervalMs?: number; visible?: () => { section: number; start: number; end: number } | null; visibleRange?: (r: { section: number; start: number; end: number }) => boolean } = {}) {
  const engine = new FakeEngine();
  const log: string[] = [];
  const highlights: ({ section: number; start: number; end: number } | null)[] = [];
  let visSection = 0;
  const host: RunnerHost = {
    sectionCount: () => sections.length,
    getText: async (s) => sections[s],
    getVisible: over.visible ?? (() => ({ section: visSection, start: 0, end: sections[visSection].length })),
    isRangeVisible: over.visibleRange ?? (() => true),
    atEnd: () => visSection >= sections.length - 1,
    next: async () => {
      log.push('next');
      visSection = Math.min(sections.length - 1, visSection + 1);
    },
    prev: async () => {
      log.push('prev');
      visSection = Math.max(0, visSection - 1);
    },
    goTo: async (r) => void log.push(`goTo:${r.section}:${r.start}`),
    setHighlight: (r) => highlights.push(r),
    settings: () => ({ divide: over.divide ?? 1, intervalMs: over.intervalMs ?? 0, filters: DEFAULT_FILTERS, filterRegex: false, speak: OPTS }),
    engine: () => engine,
  };
  return { host, engine, log, highlights };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('TtsRunner', () => {
  it('逐句朗读：句末回调推进，高亮当前句，读完停止', async () => {
    const { host, engine, highlights } = makeHost(['第一句。第二句。第三句。']);
    const r = new TtsRunner(host);
    await r.start();
    expect(engine.spoken).toEqual(['第一句。']);
    expect(r.state).toMatchObject({ status: 'playing', index: 0, total: 3 });
    expect(highlights.at(-1)).toEqual({ section: 0, start: 0, end: 4 });
    engine.finishLine();
    await tick();
    expect(engine.spoken).toEqual(['第一句。', '第二句。']);
    expect(highlights.at(-1)).toEqual({ section: 0, start: 4, end: 8 });
    engine.finishLine();
    await tick();
    engine.finishLine();
    await tick();
    expect(r.state.status).toBe('idle');
    expect(r.state.stopReason).toBe('end');
    expect(highlights.at(-1)).toBeNull();
  });

  it('从指定偏移开始：跳过之前的句子', async () => {
    const { host, engine } = makeHost(['第一句。第二句。第三句。']);
    const r = new TtsRunner(host);
    await r.start({ section: 0, offset: 5 });
    expect(engine.spoken).toEqual(['第二句。']);
  });

  it('章末自动接下一章，跳过没有可读内容的章', async () => {
    const { host, engine } = makeHost(['甲。', '……', '乙。']);
    const r = new TtsRunner(host);
    await r.start();
    engine.finishLine();
    await tick();
    expect(engine.spoken).toEqual(['甲。', '乙。']);
    expect(r.state.section).toBe(2);
  });

  it('下一句不在屏内：先 next() 翻页，翻完仍不可见再 goTo', async () => {
    let visible = false;
    const { host, engine, log } = makeHost(['第一句。第二句。'], {
      visible: () => ({ section: 0, start: 0, end: 4 }),
      visibleRange: (r) => r.start < 4 || visible,
    });
    const r = new TtsRunner(host);
    await r.start();
    expect(log).toEqual([]);
    engine.finishLine();
    await tick();
    expect(log).toEqual(['next', 'goTo:0:4']);
    expect(engine.spoken).toEqual(['第一句。', '第二句。']);
    visible = true;
  });

  it('暂停 = 取消引擎；继续 = 从当前句重读', async () => {
    const { host, engine } = makeHost(['第一句。第二句。']);
    const r = new TtsRunner(host);
    await r.start();
    r.pause();
    expect(r.state.status).toBe('paused');
    expect(engine.cancels).toBeGreaterThan(0);
    await r.resume();
    expect(engine.spoken).toEqual(['第一句。', '第一句。']);
    expect(r.state.status).toBe('playing');
  });

  it('暂停后迟到的句末回调不会推进', async () => {
    const { host, engine } = makeHost(['第一句。第二句。']);
    const r = new TtsRunner(host);
    await r.start();
    const cb = engine.cb!;
    r.pause();
    cb.onEnd();
    await tick();
    expect(engine.spoken).toEqual(['第一句。']);
    expect(r.state.index).toBe(0);
  });

  it('上一句/下一句，跨章回到上一章最后一句', async () => {
    const { host, engine } = makeHost(['甲一。甲二。', '乙一。乙二。']);
    const r = new TtsRunner(host);
    await r.start({ section: 1, offset: 0 });
    expect(engine.spoken.at(-1)).toBe('乙一。');
    await r.nextSentence();
    expect(engine.spoken.at(-1)).toBe('乙二。');
    await r.prevSentence();
    expect(engine.spoken.at(-1)).toBe('乙一。');
    await r.prevSentence(); // 跨章
    expect(engine.spoken.at(-1)).toBe('甲二。');
    expect(r.state.section).toBe(0);
    await r.nextSentence(); // 甲二是上一章最后一句，下一句进入下一章
    expect(engine.spoken.at(-1)).toBe('乙一。');
    expect(r.state.section).toBe(1);
  });

  it('句间间隔：读完一句后等 intervalMs 再读下一句', async () => {
    vi.useFakeTimers();
    try {
      const { host, engine } = makeHost(['第一句。第二句。'], { intervalMs: 500 });
      const r = new TtsRunner(host);
      await r.start();
      engine.finishLine();
      await vi.advanceTimersByTimeAsync(400);
      expect(engine.spoken).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(150);
      expect(engine.spoken).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('定时停止：倒计时每秒更新，到点停止', async () => {
    vi.useFakeTimers();
    try {
      const { host } = makeHost(['第一句。第二句。']);
      const r = new TtsRunner(host);
      await r.start();
      r.setStopTimer(1);
      expect(r.state.remaining).toBe(60);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(r.state.remaining).toBe(50);
      await vi.advanceTimersByTimeAsync(50_000);
      expect(r.state.status).toBe('idle');
      expect(r.state.stopReason).toBe('timer');
      expect(r.state.remaining).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('引擎报错：停止并带上错误信息', async () => {
    const { host, engine } = makeHost(['第一句。']);
    const r = new TtsRunner(host);
    await r.start();
    engine.fail('network');
    expect(r.state).toMatchObject({ status: 'idle', stopReason: 'error', error: 'network' });
  });

  it('朗读选中文字（一次性）：不翻页、不高亮、读完即停', async () => {
    const { host, engine, log, highlights } = makeHost(['不相干'], { visibleRange: () => false });
    const r = new TtsRunner(host);
    await r.speakOnce('选中的第一句。选中的第二句。');
    expect(engine.spoken).toEqual(['选中的第一句。']);
    engine.finishLine();
    await tick();
    engine.finishLine();
    await tick();
    expect(engine.spoken).toEqual(['选中的第一句。', '选中的第二句。']);
    expect(r.state.status).toBe('idle');
    expect(log).toEqual([]);
    expect(highlights.every((h) => h === null)).toBe(true);
  });

  it('整页模式：一页一句，读完翻页接着读，书末停止', async () => {
    const { host, engine, log } = makeHost(['第一页的内容。有两句。', '第二页的内容。'], { divide: 3 });
    const r = new TtsRunner(host);
    await r.start();
    expect(engine.spoken).toEqual(['第一页的内容。有两句。']);
    engine.finishLine();
    await tick();
    await tick();
    expect(log).toEqual(['next']);
    expect(engine.spoken.at(-1)).toBe('第二页的内容。');
    engine.finishLine();
    await tick();
    expect(r.state.status).toBe('idle');
  });

  it('翻页按钮：翻页后从新页首重新开始', async () => {
    const { host, engine, log } = makeHost(['甲页。', '乙页。']);
    const r = new TtsRunner(host);
    await r.start();
    await r.nextPage();
    expect(log).toEqual(['next']);
    expect(engine.spoken.at(-1)).toBe('乙页。');
    await r.prevPage();
    expect(engine.spoken.at(-1)).toBe('甲页。');
  });

  it('停止后清高亮；空书直接结束', async () => {
    const { host, highlights } = makeHost(['']);
    const r = new TtsRunner(host);
    await r.start();
    expect(r.state.status).toBe('idle');
    expect(highlights.at(-1)).toBeNull();
  });
});

beforeEach(() => void 0);
afterEach(() => vi.useRealTimers());
