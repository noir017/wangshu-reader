// @vitest-environment node
import { createHash } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { TtsVoicesResponse } from '@shared/api';
import { WebSocketServer } from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildSsml, defaultVoiceFor, normalizeVoice, prosody, secMsGec, splitText } from '../lib/edge-tts';
import { parseEspeakVoices } from '../lib/espeak';
import { j, makeApp, tmp } from '../test-utils';

describe('Edge TTS 纯函数', () => {
  it('Sec-MS-GEC：与 edge-tts（python）同一算法的已知值，5 分钟窗口内不变', () => {
    expect(secMsGec(1792586000_000)).toBe('2906C1DAD1EB27A3484E29449F6298F5EC4688582C1A67C34C88E8B1CB0D7C1D');
    expect(secMsGec(1792585800_000)).toBe(secMsGec(1792586000_000)); // 同一窗口起点
    expect(secMsGec(1792586100_000)).not.toBe(secMsGec(1792586000_000));
  });

  it('prosody：倍率 → 百分比，并夹在 Edge 接受的范围内', () => {
    expect(prosody({})).toEqual({ rate: '+0%', pitch: '+0%', volume: '+0%' });
    expect(prosody({ rate: 1.5, pitch: 0.8, volume: 0.5 })).toEqual({ rate: '+50%', pitch: '-20%', volume: '-50%' });
    expect(prosody({ rate: 4, pitch: 9, volume: 9 })).toEqual({ rate: '+200%', pitch: '+100%', volume: '+100%' });
    expect(prosody({ rate: 0.01, pitch: 0, volume: 0 })).toEqual({ rate: '-90%', pitch: '-50%', volume: '-100%' });
  });

  it('SSML：转义文本里的 XML 特殊字符，语言取自声音名；控制字符丢掉', () => {
    const ssml = buildSsml('a<b>&"\'\u0001c', { voice: 'zh-CN-XiaoxiaoNeural', rate: 1 });
    expect(ssml).toContain("xml:lang='zh-CN'");
    expect(ssml).toContain("<voice name='zh-CN-XiaoxiaoNeural'>");
    expect(ssml).toContain('a&lt;b&gt;&amp;&quot;&apos;c');
    expect(ssml).not.toContain('\u0001');
    // 声音名里的引号不能逃出属性
    expect(buildSsml('x', { voice: "a'><evil/>" })).not.toContain('<evil/>');
  });

  it('splitText：按句子边界切到 ≤ max，拼回不丢字', () => {
    const text = '这是一句话。'.repeat(500);
    const parts = splitText(text, 100);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join('')).toBe(text);
    expect(splitText('  ', 100)).toEqual([]);
  });

  it('normalizeVoice / defaultVoiceFor：只给语言也行；按文字挑默认声音', () => {
    expect(normalizeVoice('zh-CN-YunxiNeural', 'x')).toBe('zh-CN-YunxiNeural');
    expect(normalizeVoice('zh', 'x')).toBe('zh-CN-XiaoxiaoNeural');
    expect(normalizeVoice('en-GB', 'x')).toBe('en-GB-SoniaNeural');
    expect(normalizeVoice(undefined, '你好')).toBe('zh-CN-XiaoxiaoNeural');
    expect(defaultVoiceFor('こんにちは')).toBe('ja-JP-NanamiNeural');
    expect(defaultVoiceFor('안녕')).toBe('ko-KR-SunHiNeural');
    expect(defaultVoiceFor('hello')).toBe('en-US-AriaNeural');
  });

  it('espeak 声音表解析', () => {
    const out = `Pty Language       Age/Gender VoiceName          File                 Other Languages
 5  af              --/M      Afrikaans          gmw/af
 5  zh              --/M      Mandarin_Chinese   sit/cmn              (zh-cmn 5)(zh 5)
 2  en-us           --/M      English_(America)  en-US
`;
    const v = parseEspeakVoices(out);
    expect(v).toHaveLength(3);
    expect(v[1]).toEqual({ id: 'espeak:zh', name: 'Mandarin Chinese', lang: 'zh', gender: 'male', engine: 'espeak' });
  });
});

// ───────────── 本地替身：Edge 的 WebSocket 合成服务与声音列表 ─────────────
interface FakeEdge {
  wsUrl: string;
  voicesUrl: string;
  ssmls: string[];
  upgrades: { url: string; origin?: string; ua?: string }[];
  mode: { fail403Once: boolean; failAlways: boolean; voicesFail: boolean };
  close(): void;
}

async function fakeEdge(): Promise<FakeEdge> {
  const ssmls: string[] = [];
  const upgrades: FakeEdge['upgrades'] = [];
  const mode = { fail403Once: false, failAlways: false, voicesFail: false };
  const wss = new WebSocketServer({ noServer: true });
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/voices')) {
      if (mode.voicesFail) return res.writeHead(500).end();
      return res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify([{ ShortName: 'zh-CN-XiaoxiaoNeural', Gender: 'Female', Locale: 'zh-CN', FriendlyName: 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)' }, { ShortName: 'en-US-GuyNeural', Gender: 'Male', Locale: 'en-US' }, { ShortName: 'old-Voice', Locale: 'xx', Status: 'Deprecated' }]));
    }
    res.writeHead(404).end();
  });
  server.on('upgrade', (req, socket, head) => {
    upgrades.push({ url: req.url!, origin: req.headers.origin, ua: req.headers['user-agent'] });
    if (mode.failAlways) {
      socket.end('HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (mode.fail403Once) {
      mode.fail403Once = false;
      // 时钟偏差：服务端用 Date 头告诉客户端现在几点，GEC 校验不过就 403
      socket.end(`HTTP/1.1 403 Forbidden\r\nDate: ${new Date(Date.now() + 3 * 3600_000).toUTCString()}\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        const text = data.toString();
        if (!/Path:ssml/.test(text)) return;
        ssmls.push(text.split('\r\n\r\n')[1]);
        const frame = (path: string, body: Buffer) => {
          const head = Buffer.from(`X-RequestId:1\r\nContent-Type:audio/mpeg\r\nPath:${path}\r\n`);
          const len = Buffer.alloc(2);
          len.writeUInt16BE(head.length);
          return Buffer.concat([len, head, body]);
        };
        ws.send(frame('audio', Buffer.from('ID3-part-1|')), { binary: true });
        ws.send(frame('audio', Buffer.from('part-2')), { binary: true });
        ws.send('X-RequestId:1\r\nPath:turn.end\r\n\r\n{}');
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    wsUrl: `ws://127.0.0.1:${port}/tts`,
    voicesUrl: `http://127.0.0.1:${port}/voices?trustedclienttoken=x`,
    ssmls,
    upgrades,
    mode,
    close: () => {
      server.closeAllConnections();
      server.close();
      wss.close();
    },
  };
}

function fakeEspeak(): { bin: string; log: string } {
  const dir = tmp();
  const bin = path.join(dir, 'espeak-ng');
  const log = path.join(dir, 'calls.log');
  writeFileSync(
    bin,
    `#!/bin/sh
echo "$@" >> "${log}"
if [ "$1" = "--voices" ]; then
  echo "Pty Language       Age/Gender VoiceName          File                 Other Languages"
  echo " 5  zh              --/M      Mandarin_Chinese   sit/cmn"
  echo " 2  en-us           --/M      English_(America)  en-US"
  exit 0
fi
cat > "${log}.stdin"
printf 'RIFF....WAVEfake'
`,
  );
  chmodSync(bin, 0o755);
  return { bin, log };
}

describe('/api/tts（Edge 替身服务）', () => {
  let edge: FakeEdge;
  const saved = { wss: process.env.MR_EDGE_TTS_WSS, voices: process.env.MR_EDGE_TTS_VOICES, esp: process.env.MR_BIN_ESPEAK_NG };
  beforeAll(async () => {
    edge = await fakeEdge();
    process.env.MR_EDGE_TTS_WSS = edge.wsUrl;
    process.env.MR_EDGE_TTS_VOICES = edge.voicesUrl;
  });
  afterAll(() => {
    edge.close();
    for (const [k, v] of [['MR_EDGE_TTS_WSS', saved.wss], ['MR_EDGE_TTS_VOICES', saved.voices], ['MR_BIN_ESPEAK_NG', saved.esp]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  afterEach(() => {
    edge.mode.fail403Once = false;
    edge.mode.failAlways = false;
    edge.mode.voicesFail = false;
    // 本文件里 espeak 的有无由各用例自己决定
    process.env.MR_BIN_ESPEAK_NG = '/nonexistent/espeak-ng';
    process.env.MR_BIN_ESPEAK = '/nonexistent/espeak';
  });

  const say = (app: ReturnType<typeof makeApp>['app'], body: unknown) => app.request('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('合成：握手头与参数、SSML 内容、多段音频拼接、响应头', async () => {
    const { app } = makeApp();
    const res = await say(app, { text: '你好 <世界> & 朋友', voice: 'zh-CN-YunxiNeural', rate: 1.25, pitch: 1, volume: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('X-Tts-Engine')).toBe('edge');
    expect(res.headers.get('X-Tts-Voice')).toBe('zh-CN-YunxiNeural');
    expect(await res.text()).toBe('ID3-part-1|part-2');
    const up = edge.upgrades.at(-1)!;
    expect(up.origin).toMatch(/^chrome-extension:\/\//);
    expect(up.ua).toMatch(/Edg\//);
    const q = new URL(up.url, 'http://x').searchParams;
    expect(q.get('Sec-MS-GEC')).toMatch(/^[0-9A-F]{64}$/);
    expect(q.get('Sec-MS-GEC-Version')).toMatch(/^1-\d+\./);
    expect(q.get('Ocp-Apim-Subscription-Key')).toBeTruthy();
    const ssml = edge.ssmls.at(-1)!;
    expect(ssml).toContain("<voice name='zh-CN-YunxiNeural'>");
    expect(ssml).toContain("rate='+25%'");
    expect(ssml).toContain('你好 &lt;世界&gt; &amp; 朋友');
  });

  it('相同请求走磁盘缓存，不再连 Edge；不同语速重新合成', async () => {
    const { app } = makeApp();
    const body = { text: '缓存测试句子。', voice: 'zh-CN-XiaoxiaoNeural' };
    await say(app, body);
    const n = edge.ssmls.length;
    const again = await say(app, body);
    expect(await again.text()).toBe('ID3-part-1|part-2');
    expect(edge.ssmls.length).toBe(n);
    await say(app, { ...body, rate: 2 });
    expect(edge.ssmls.length).toBe(n + 1);
  });

  it('只给语言（zh）或不给声音时按文字选默认声音', async () => {
    const { app } = makeApp();
    expect((await say(app, { text: '你好' })).headers.get('X-Tts-Voice')).toBe('zh-CN-XiaoxiaoNeural');
    expect((await say(app, { text: 'hello there', voice: 'en' })).headers.get('X-Tts-Voice')).toBe('en-US-AriaNeural');
  });

  it('长文本按句子分段多次合成再拼接', async () => {
    const { app } = makeApp();
    const n = edge.ssmls.length;
    const res = await say(app, { text: '这是一个句子。'.repeat(500), voice: 'zh-CN-XiaoxiaoNeural' });
    expect(res.status).toBe(200);
    expect(edge.ssmls.length - n).toBe(2); // 3500 字 → 2 段（每段 ≤ 2000）
    expect(await res.text()).toBe('ID3-part-1|part-2'.repeat(2));
  });

  it('时钟偏差导致 403 时按服务端 Date 校准后重试一次', async () => {
    const { app } = makeApp();
    edge.mode.fail403Once = true;
    const before = edge.upgrades.length;
    const res = await say(app, { text: '时钟偏差重试', voice: 'zh-CN-XiaoxiaoNeural' });
    expect(res.status).toBe(200);
    const mine = edge.upgrades.slice(before);
    expect(mine).toHaveLength(2);
    expect(new URL(mine[0].url, 'http://x').searchParams.get('Sec-MS-GEC')).not.toBe(new URL(mine[1].url, 'http://x').searchParams.get('Sec-MS-GEC'));
  });

  it('参数校验：空文本 400、超长 413、非 JSON 400', async () => {
    const { app } = makeApp();
    expect((await say(app, { text: '   ' })).status).toBe(400);
    expect((await say(app, {})).status).toBe(400);
    expect((await say(app, { text: 'x'.repeat(20_001) })).status).toBe(413);
    expect((await app.request('/api/tts', { method: 'POST', body: 'nope' })).status).toBe(400);
  });

  it('Edge 不可用：没有 espeak → 502；有 espeak 且调用方没点名声音 → 退回本机声音', async () => {
    const { app } = makeApp();
    edge.mode.failAlways = true;
    const bad = await say(app, { text: '不可用测试一', voice: 'zh-CN-XiaoxiaoNeural' });
    expect(bad.status).toBe(502);
    expect((await j<{ error: string }>(bad)).error).toMatch(/在线朗读失败/);

    const esp = fakeEspeak();
    process.env.MR_BIN_ESPEAK_NG = esp.bin;
    const ok = await say(makeApp().app, { text: '不可用测试二' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('X-Tts-Engine')).toBe('espeak');
    expect(ok.headers.get('Content-Type')).toBe('audio/wav');
    expect(readFileSync(`${esp.log}.stdin`, 'utf8')).toBe('不可用测试二');
    expect(readFileSync(esp.log, 'utf8')).toContain('-v zh');
    // 点名了 Edge 声音就不静默换引擎
    expect((await say(makeApp().app, { text: '不可用测试三', voice: 'zh-CN-XiaoxiaoNeural' })).status).toBe(502);
  });
});

describe('/api/tts/voices 与 espeak', () => {
  let edge: FakeEdge;
  beforeAll(async () => {
    edge = await fakeEdge();
    process.env.MR_EDGE_TTS_WSS = edge.wsUrl;
    process.env.MR_EDGE_TTS_VOICES = edge.voicesUrl;
  });
  afterAll(() => {
    edge.close();
    delete process.env.MR_EDGE_TTS_WSS;
    delete process.env.MR_EDGE_TTS_VOICES;
    delete process.env.MR_BIN_ESPEAK_NG;
    delete process.env.MR_BIN_ESPEAK;
  });

  it('声音列表：Edge 在线列表（去掉 Deprecated，名字去前缀）+ 本机 espeak', async () => {
    process.env.MR_BIN_ESPEAK_NG = fakeEspeak().bin;
    const { app } = makeApp();
    const { voices } = await j<TtsVoicesResponse>(await app.request('/api/tts/voices'));
    const edgeVoices = voices.filter((v) => v.engine === 'edge');
    expect(edgeVoices.map((v) => v.id)).toEqual(['zh-CN-XiaoxiaoNeural', 'en-US-GuyNeural']);
    expect(edgeVoices[0]).toMatchObject({ name: 'Xiaoxiao - Chinese (Mainland)', lang: 'zh-CN', gender: 'female' });
    expect(voices.filter((v) => v.engine === 'espeak').map((v) => v.id)).toEqual(['espeak:zh', 'espeak:en-us']);
  });

  it('MR_TTS=off + 本机 espeak：只用 espeak，语速/音调/音量换算成参数', async () => {
    const esp = fakeEspeak();
    process.env.MR_BIN_ESPEAK_NG = esp.bin;
    const { app, config } = makeApp({ MR_TTS: 'off' });
    expect(config.features.tts).toBe(true);
    const { voices } = await j<TtsVoicesResponse>(await app.request('/api/tts/voices'));
    expect(voices.every((v) => v.engine === 'espeak')).toBe(true);
    const res = await app.request('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hello', voice: 'espeak:en-us', rate: 2, pitch: 1.2, volume: 0.5 }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('RIFF....WAVEfake');
    const args = readFileSync(esp.log, 'utf8').trim().split('\n').at(-1)!;
    expect(args).toBe('-v en-us -s 350 -p 60 -a 50 --stdout --stdin');
  });

  it('什么引擎都没有：features.tts = false，接口 503', async () => {
    process.env.MR_BIN_ESPEAK_NG = '/nonexistent/espeak-ng';
    process.env.MR_BIN_ESPEAK = '/nonexistent/espeak';
    const { app, config } = makeApp({ MR_TTS: 'off' });
    expect(config.features.tts).toBe(false);
    expect((await app.request('/api/tts/voices')).status).toBe(503);
    expect((await app.request('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"x"}' })).status).toBe(503);
  });

  it('Edge 声音列表取不到时用内置兜底列表（UI 不至于是空的）', async () => {
    edge.mode.voicesFail = true;
    // 声音列表有 24 小时内存缓存：换一个新模块实例来绕开前面用例留下的缓存
    const { vi } = await import('vitest');
    vi.resetModules();
    const { listEdgeVoices } = await import('../lib/edge-tts');
    const r = await listEdgeVoices();
    expect(r.live).toBe(false);
    expect(r.voices.map((v) => v.id)).toContain('zh-CN-XiaoxiaoNeural');
  });
});

// 联网（默认跳过）：MR_TEST_NET=1 npx vitest run server/src/routes/tts.test.ts
describe.skipIf(!process.env.MR_TEST_NET)('联网：真实 Edge 朗读', () => {
  it('合成一句中文，得到 MP3', async () => {
    delete process.env.MR_EDGE_TTS_WSS;
    delete process.env.MR_EDGE_TTS_VOICES;
    const { app } = makeApp();
    const res = await app.request('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '你好，这是一段测试朗读。' }) });
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(5000);
    expect(createHash('md5').update(buf).digest('hex')).toBeTruthy();
    expect(buf[0] === 0xff || buf.subarray(0, 3).toString() === 'ID3').toBe(true);
  }, 60_000);
});
