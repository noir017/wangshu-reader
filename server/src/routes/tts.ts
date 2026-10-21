// /api/tts、/api/tts/voices —— 服务端朗读（TTS-010/014）：Edge 在线声音优先，本机 espeak-ng 作后备。
import type { TtsRequest, TtsVoice, TtsVoicesResponse } from '@shared/api';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RouteModule } from '../index';
import { defaultVoiceFor, listEdgeVoices, normalizeVoice, synthesizeEdge } from '../lib/edge-tts';
import { espeakAvailable, listEspeakVoices, synthesizeEspeak } from '../lib/espeak';
import { httpError } from '../util/http';

const MAX_TEXT = 20_000;

/** 磁盘缓存：同一句话（同声音/语速）只合成一次；超出上限按最近访问时间淘汰 */
class AudioCache {
  private total: number | null = null;
  constructor(
    private dir: string,
    private limit: number,
  ) {}

  key(parts: unknown[]): string {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  }

  async get(key: string): Promise<Buffer | null> {
    if (this.limit <= 0) return null;
    const f = path.join(this.dir, key);
    try {
      const buf = await readFile(f);
      const now = new Date();
      void utimes(f, now, now).catch(() => undefined);
      return buf;
    } catch {
      return null;
    }
  }

  async put(key: string, data: Buffer): Promise<void> {
    if (this.limit <= 0 || data.length > this.limit / 4) return;
    try {
      await mkdir(this.dir, { recursive: true });
      const tmp = path.join(this.dir, `${key}.tmp`);
      await writeFile(tmp, data);
      await rename(tmp, path.join(this.dir, key));
      this.total = (this.total ?? (await this.scan()).total) + data.length;
      if (this.total > this.limit) await this.prune();
    } catch {
      /* 缓存失败不影响合成结果 */
    }
  }

  private async scan(): Promise<{ total: number; files: { f: string; size: number; at: number }[] }> {
    const files: { f: string; size: number; at: number }[] = [];
    let total = 0;
    for (const name of await readdir(this.dir).catch(() => [])) {
      if (name.endsWith('.tmp')) continue;
      const st = await stat(path.join(this.dir, name)).catch(() => null);
      if (!st) continue;
      files.push({ f: name, size: st.size, at: st.mtimeMs });
      total += st.size;
    }
    return { total, files };
  }

  private async prune(): Promise<void> {
    const { total, files } = await this.scan();
    let t = total;
    files.sort((a, b) => a.at - b.at);
    for (const f of files) {
      if (t <= this.limit * 0.8) break;
      await unlink(path.join(this.dir, f.f)).catch(() => undefined);
      t -= f.size;
    }
    this.total = t;
  }
}

export const route: RouteModule = {
  register(app, ctx) {
    const { config } = ctx;
    const edgeOn = config.ttsEngine !== 'off';
    config.features.tts = edgeOn || espeakAvailable();
    const cache = new AudioCache(path.join(config.dataDir, 'cache', 'tts'), config.ttsCacheBytes);

    app.get('/api/tts/voices', async (c) => {
      const voices: TtsVoice[] = [];
      if (edgeOn) voices.push(...(await listEdgeVoices()).voices);
      voices.push(...(await listEspeakVoices()));
      if (!voices.length) throw httpError(503, '没有可用的朗读引擎（在线朗读已关闭且未安装 espeak-ng）');
      const body: TtsVoicesResponse = { voices };
      return c.json(body);
    });

    app.post('/api/tts', async (c) => {
      let req: TtsRequest;
      try {
        req = (await c.req.json()) as TtsRequest;
      } catch {
        throw httpError(400, '请求体不是有效的 JSON');
      }
      const text = typeof req?.text === 'string' ? req.text.replace(/\r\n?/g, '\n').trim() : '';
      if (!text) throw httpError(400, '缺少 text');
      if (text.length > MAX_TEXT) throw httpError(413, `文本过长（上限 ${MAX_TEXT} 字，请按句/段分次请求）`);
      const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
      const rate = num(req.rate, 0.25, 4);
      const pitch = num(req.pitch, 0.5, 2);
      const volume = num(req.volume, 0, 2);

      const wantsEspeak = typeof req.voice === 'string' && req.voice.startsWith('espeak:');
      const useEdge = !wantsEspeak && edgeOn;
      if (!useEdge && !espeakAvailable()) throw httpError(503, wantsEspeak ? '服务端没有安装 espeak-ng' : '在线朗读已关闭且未安装 espeak-ng');

      const tryEspeak = async (voiceName: string) => {
        const audio = await synthesizeEspeak(text, { voice: voiceName, rate, pitch, volume });
        return new Response(new Uint8Array(audio), { status: 200, headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(audio.length), 'X-Tts-Engine': 'espeak' } });
      };

      if (!useEdge) return tryEspeak(req.voice!.slice('espeak:'.length) || (/[一-鿿]/.test(text) ? 'zh' : 'en'));

      const voice = normalizeVoice(req.voice, text);
      const key = cache.key(['edge', voice, rate, pitch, volume, text]);
      let audio = await cache.get(key);
      if (!audio) {
        try {
          audio = await synthesizeEdge(text, { voice, rate, pitch, volume }, c.req.raw.signal);
        } catch (e) {
          // 在线失败且本机有 espeak-ng、且调用方没点名声音：退回本机声音，比直接报错好
          if (!req.voice && espeakAvailable()) return tryEspeak(/[一-鿿]/.test(text) ? 'zh' : 'en');
          throw httpError(502, `在线朗读失败：${(e as Error).message}`);
        }
        if (!audio.length) throw httpError(422, '没有合成出音频（文本里可能没有可朗读的内容）');
        await cache.put(key, audio);
      }
      return new Response(new Uint8Array(audio), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.length), 'X-Tts-Engine': 'edge', 'X-Tts-Voice': voice, 'Cache-Control': 'private, max-age=86400' },
      });
    });
    void defaultVoiceFor;
  },
};
