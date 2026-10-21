import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_SOUNDS, PAGE_SOUND_COUNT, PAGE_SOUND_USER, PageSound, soundDuration } from './page-sound';

describe('翻页声配方（ANIM-011，程序合成）', () => {
  it('5 种内置声音，参数合法、总长在 0.1–0.5 秒', () => {
    expect(PAGE_SOUND_COUNT).toBe(5);
    expect(PAGE_SOUND_USER).toBe(5);
    PAGE_SOUNDS.forEach((events) => {
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(e.dur).toBeGreaterThan(0);
        expect(e.gain).toBeGreaterThan(0);
        expect(e.gain).toBeLessThanOrEqual(1);
        expect(e.at).toBeGreaterThanOrEqual(0);
        if (e.kind === 'noise' && e.filter) {
          expect(e.filter.from).toBeGreaterThan(0);
          expect(e.filter.to).toBeGreaterThan(0);
        }
        if (e.kind === 'tone') expect(e.freq?.[0]).toBeGreaterThan(0);
      }
      const d = soundDuration(events);
      expect(d).toBeGreaterThan(0.1);
      expect(d).toBeLessThan(0.5);
    });
  });

  it('5 种声音互不相同', () => {
    const sig = PAGE_SOUNDS.map((e) => JSON.stringify(e));
    expect(new Set(sig).size).toBe(5);
  });
});

/** 记录节点创建的假 AudioContext */
function installFakeAudio(decodeOk = true) {
  const created: string[] = [];
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const node = (kind: string) => {
    created.push(kind);
    return { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), gain: param(), frequency: param(), Q: param(), type: '', buffer: null };
  };
  class FakeCtx {
    currentTime = 0;
    sampleRate = 8000;
    destination = {};
    resume = vi.fn(async () => {});
    close = vi.fn(async () => {});
    createGain = () => node('gain');
    createBufferSource = () => node('source');
    createBiquadFilter = () => node('filter');
    createOscillator = () => node('osc');
    createBuffer = (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) });
    decodeAudioData = vi.fn(async () => {
      if (!decodeOk) throw new Error('bad audio');
      return {} as AudioBuffer;
    });
  }
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  return created;
}

describe('PageSound 播放器', () => {
  afterEach(() => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    vi.restoreAllMocks();
  });

  it('按配方创建噪声源/滤波器/振荡器；120ms 内不重复播放', () => {
    const created = installFakeAudio();
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const p = new PageSound();
    expect(p.supported).toBe(true);
    p.play(3); // 配方 4：一个正弦 + 一个低通噪声
    expect(created.filter((k) => k === 'osc')).toHaveLength(1);
    expect(created.filter((k) => k === 'source')).toHaveLength(1);
    expect(created.filter((k) => k === 'filter')).toHaveLength(1);
    const n = created.length;
    p.play(3); // 同一时刻：被节流
    expect(created.length).toBe(n);
    vi.spyOn(performance, 'now').mockReturnValue(1200);
    p.play(0);
    expect(created.length).toBeGreaterThan(n);
  });

  it('下标越界时夹到有效范围；没有 AudioContext 时静默', () => {
    const created = installFakeAudio();
    const p = new PageSound();
    expect(() => p.play(99)).not.toThrow();
    expect(created.length).toBeGreaterThan(0);
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    const q = new PageSound();
    expect(q.supported).toBe(false);
    expect(() => q.play(0)).not.toThrow();
    expect(() => q.playUser()).not.toThrow();
  });

  it('用户声音文件：解码成功后可播放；失败返回 false', async () => {
    const created = installFakeAudio();
    const p = new PageSound();
    expect(await p.loadUserFile(new Blob(['x']))).toBe(true);
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    p.playUser();
    expect(created).toContain('source');
    installFakeAudio(false);
    const bad = new PageSound();
    expect(await bad.loadUserFile(new Blob(['x']))).toBe(false);
  });
});
