// 微软 Edge「大声朗读」在线合成（WebSocket 协议）。
// 端点与令牌与 node-edge-tts / msedge-tts 等社区实现一致：Sec-MS-GEC = SHA-256(5 分钟取整的 Windows 时间刻 + TrustedClientToken)。
// 这是微软未公开承诺的接口，可能随时变动；变动后可用 MR_EDGE_TTS_WSS 覆盖端点，或改用本机 espeak-ng。
import { createHash, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { TtsVoice } from '@shared/api';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.96';
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split('.')[0];
// 端点每次用时才读环境变量（测试里指到本地替身服务；线上变动时可以不改代码覆盖）
const wssBase = (): string => process.env.MR_EDGE_TTS_WSS ?? 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1';
const voicesBase = (): string => process.env.MR_EDGE_TTS_VOICES ?? `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`;
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

let clockSkewMs = 0;

/** Sec-MS-GEC：Windows FILETIME（100ns 刻度，自 1601）按 5 分钟取整后与令牌一起做 SHA-256 */
export function secMsGec(nowMs = Date.now() + clockSkewMs): string {
  const ticks = BigInt(Math.floor(nowMs / 1000) + 11644473600) * 10000000n;
  const rounded = ticks - (ticks % 3000000000n);
  return createHash('sha256').update(`${rounded}${TRUSTED_CLIENT_TOKEN}`, 'ascii').digest('hex').toUpperCase();
}

function wsUrl(): string {
  return `${wssBase()}?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}&ConnectionId=${randomUUID().replace(/-/g, '')}`;
}

// ───────────────────────── 声音列表 ─────────────────────────

interface RawVoice {
  ShortName: string;
  Gender?: string;
  Locale: string;
  FriendlyName?: string;
  Name?: string;
  Status?: string;
}

/** 联网失败时的兜底列表，保证 UI 不是空的 */
const BUILTIN_VOICES: [string, string, 'female' | 'male'][] = [
  ['zh-CN-XiaoxiaoNeural', 'zh-CN', 'female'],
  ['zh-CN-YunxiNeural', 'zh-CN', 'male'],
  ['zh-CN-YunjianNeural', 'zh-CN', 'male'],
  ['zh-TW-HsiaoChenNeural', 'zh-TW', 'female'],
  ['zh-HK-HiuGaaiNeural', 'zh-HK', 'female'],
  ['en-US-AriaNeural', 'en-US', 'female'],
  ['en-US-GuyNeural', 'en-US', 'male'],
  ['en-GB-SoniaNeural', 'en-GB', 'female'],
  ['ja-JP-NanamiNeural', 'ja-JP', 'female'],
  ['ko-KR-SunHiNeural', 'ko-KR', 'female'],
  ['fr-FR-DeniseNeural', 'fr-FR', 'female'],
  ['de-DE-KatjaNeural', 'de-DE', 'female'],
  ['es-ES-ElviraNeural', 'es-ES', 'female'],
  ['ru-RU-SvetlanaNeural', 'ru-RU', 'female'],
];

const toVoice = (id: string, locale: string, gender: string | undefined, friendly?: string): TtsVoice => ({
  id,
  name: friendly ? friendly.replace(/^Microsoft\s+/i, '').replace(/\s+Online\s+\(Natural\)/i, '') : id,
  lang: locale,
  ...(gender ? { gender: gender.toLowerCase() === 'male' ? ('male' as const) : ('female' as const) } : {}),
  engine: 'edge',
});

let voicesCache: { at: number; voices: TtsVoice[] } | undefined;

export async function listEdgeVoices(): Promise<{ voices: TtsVoice[]; live: boolean }> {
  if (voicesCache && Date.now() - voicesCache.at < 24 * 3600_000) return { voices: voicesCache.voices, live: true };
  try {
    const res = await fetch(`${voicesBase()}${voicesBase().includes('?') ? '&' : '?'}Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`, {
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as RawVoice[];
    const voices = raw.filter((v) => v.ShortName && v.Locale && v.Status !== 'Deprecated').map((v) => toVoice(v.ShortName, v.Locale, v.Gender, v.FriendlyName));
    if (!voices.length) throw new Error('empty list');
    voicesCache = { at: Date.now(), voices };
    return { voices, live: true };
  } catch {
    return { voices: BUILTIN_VOICES.map(([id, lang, g]) => toVoice(id, lang, g)), live: false };
  }
}

/** 没指定声音时按文本里的文字挑一个 */
export function defaultVoiceFor(text: string): string {
  if (process.env.MR_TTS_DEFAULT_VOICE) return process.env.MR_TTS_DEFAULT_VOICE;
  if (/[぀-ヿ]/.test(text)) return 'ja-JP-NanamiNeural';
  if (/[가-힯]/.test(text)) return 'ko-KR-SunHiNeural';
  if (/[一-鿿]/.test(text)) return 'zh-CN-XiaoxiaoNeural';
  return 'en-US-AriaNeural';
}

const LOCALE_DEFAULTS: Record<string, string> = Object.fromEntries(BUILTIN_VOICES.filter((v) => v[2] === 'female').map(([id, lang]) => [lang, id]));

/** voice 可以是完整声音名，也可以只给语言（zh-CN / zh / en） */
export function normalizeVoice(voice: string | undefined, text: string): string {
  if (!voice) return defaultVoiceFor(text);
  if (/^[a-z]{2,3}-[A-Za-z]{2,4}-\w+Neural$|Neural$/.test(voice)) return voice;
  if (LOCALE_DEFAULTS[voice]) return LOCALE_DEFAULTS[voice];
  const lang = voice.toLowerCase().split('-')[0];
  const hit = Object.entries(LOCALE_DEFAULTS).find(([loc]) => loc.toLowerCase().startsWith(`${lang}-`));
  return hit ? hit[1] : voice;
}

// ───────────────────────── 合成 ─────────────────────────

export interface EdgeOptions {
  voice: string;
  /** 倍率，1 = 正常 */
  rate?: number;
  /** 倍率，1 = 正常 */
  pitch?: number;
  /** 0..2，1 = 正常 */
  volume?: number;
}

const pct = (n: number): string => `${n >= 0 ? '+' : ''}${Math.round(n)}%`;

export function prosody(o: Pick<EdgeOptions, 'rate' | 'pitch' | 'volume'>): { rate: string; pitch: string; volume: string } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    // Edge 接受 -100%..+200% 的语速；前端要更快就自己用 playbackRate
    rate: pct(clamp(((o.rate ?? 1) - 1) * 100, -90, 200)),
    pitch: pct(clamp(((o.pitch ?? 1) - 1) * 100, -50, 100)),
    volume: pct(clamp(((o.volume ?? 1) - 1) * 100, -100, 100)),
  };
}

const xmlEscape = (s: string) =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

export function buildSsml(text: string, o: EdgeOptions): string {
  const p = prosody(o);
  const lang = /^[a-z]{2,3}-[A-Za-z]{2,4}/.exec(o.voice)?.[0] ?? 'en-US';
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='${lang}'><voice name='${xmlEscape(o.voice)}'><prosody pitch='${p.pitch}' rate='${p.rate}' volume='${p.volume}'>${xmlEscape(text)}</prosody></voice></speak>`;
}

/** 按句子边界把长文本切成 ≤ max 字符的块（Edge 单次请求有长度上限） */
export function splitText(text: string, max = 2000): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf('\n'), ...['。', '！', '？', '；', '!', '?', ';', '.', '，', ',', ' '].map((d) => window.lastIndexOf(d)));
    if (cut < max * 0.3) cut = max - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out.filter((s) => s.length > 0);
}

class EdgeHandshakeError extends Error {
  constructor(
    public statusCode: number,
    public serverDate?: string,
  ) {
    super(`Edge TTS 握手失败：HTTP ${statusCode}`);
  }
}

function synthOnce(text: string, o: EdgeOptions, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(), {
      headers: { 'User-Agent': UA, Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold', Pragma: 'no-cache', 'Cache-Control': 'no-cache', 'Accept-Language': 'en-US,en;q=0.9' },
      handshakeTimeout: 10_000,
      perMessageDeflate: false,
    });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (err: Error | null, value?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try {
        ws.terminate();
      } catch {
        /* 已关闭 */
      }
      if (err) reject(err);
      else resolve(value!);
    };
    const timer = setTimeout(() => finish(new Error('Edge TTS 合成超时')), 60_000);
    const onAbort = () => finish(new Error('请求已取消'));
    signal?.addEventListener('abort', onAbort, { once: true });
    ws.on('unexpected-response', (_req, res) => {
      res.resume();
      finish(new EdgeHandshakeError(res.statusCode ?? 0, res.headers.date));
    });
    ws.on('error', (e) => finish(e));
    ws.on('close', () => finish(chunks.length ? null : new Error('Edge TTS 连接意外关闭'), Buffer.concat(chunks)));
    ws.on('open', () => {
      ws.send(
        `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify({
          context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' }, outputFormat: OUTPUT_FORMAT } } },
        })}\r\n`,
      );
      ws.send(`X-RequestId:${randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toString()}Z\r\nPath:ssml\r\n\r\n${buildSsml(text, o)}`);
    });
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // 二进制帧：2 字节头长度（大端）+ 头文本 + 音频数据
        if (data.length < 2) return;
        const headLen = data.readUInt16BE(0);
        const head = data.toString('latin1', 2, 2 + headLen);
        if (/Path:audio/.test(head)) chunks.push(data.subarray(2 + headLen));
        return;
      }
      if (/Path:turn\.end/.test(data.toString('utf8'))) finish(null, Buffer.concat(chunks));
    });
  });
}

let active = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** 合成一段文本，返回 MP3。时钟偏差导致 403 时按服务器 Date 校准后重试一次 */
export async function synthesizeEdge(text: string, o: EdgeOptions, signal?: AbortSignal): Promise<Buffer> {
  const parts: Buffer[] = [];
  for (const piece of splitText(text)) {
    const audio = await limited(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await synthOnce(piece, o, signal);
        } catch (e) {
          if (e instanceof EdgeHandshakeError && e.statusCode === 403 && attempt === 0 && e.serverDate) {
            const server = Date.parse(e.serverDate);
            if (Number.isFinite(server)) {
              clockSkewMs = server - Date.now();
              continue;
            }
          }
          // 连接类的偶发失败重试一次
          if (attempt === 0 && !(e instanceof EdgeHandshakeError) && !signal?.aborted && /关闭|ECONN|ETIMEDOUT|socket/i.test((e as Error).message)) continue;
          throw e;
        }
      }
    });
    if (audio.length) parts.push(audio);
  }
  return Buffer.concat(parts);
}
