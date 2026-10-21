// @vitest-environment node
import type { TranslateResponse } from '@shared/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { j, makeApp } from '../test-utils';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** 用替身 fetch 顶掉全局 fetch；handler 返回 JSON 对象，或 Response，或抛错 */
function mockFetch(handler: (c: Call) => unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const body = init.body instanceof URLSearchParams ? init.body.toString() : typeof init.body === 'string' ? init.body : '';
      const c: Call = { url: String(input), method: init.method ?? 'GET', headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])), body };
      calls.push(c);
      const r = handler(c);
      return r instanceof Response ? r : new Response(JSON.stringify(r), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const tr = (app: ReturnType<typeof makeApp>['app'], body: unknown) => app.request('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('/api/translate/providers', () => {
  it('默认 google + mymemory；配了 key / 地址才出现 deepl / libretranslate', async () => {
    const ids = async (env: Record<string, string>) => (await j<{ providers: { id: string }[] }>(await makeApp(env).app.request('/api/translate/providers'))).providers.map((p) => p.id);
    expect(await ids({})).toEqual(['google', 'mymemory']);
    expect(await ids({ MR_DEEPL_KEY: 'k:fx', MR_LIBRETRANSLATE_URL: 'http://libre.local' })).toEqual(['google', 'deepl', 'libretranslate', 'mymemory']);
  });
});

describe('google', () => {
  it('gtx：POST 表单，带源/目标语言，返回译文与检测到的语言', async () => {
    const calls = mockFetch(() => [[['你好世界', 'Hello world', null, null, 10]], null, 'en']);
    const res = await tr(makeApp().app, { text: 'Hello world', from: 'auto', to: 'zh' });
    expect(await j<TranslateResponse>(res)).toEqual({ text: '你好世界', provider: 'google', detectedFrom: 'en' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('translate.googleapis.com/translate_a/single');
    expect(calls[0].url).toContain('sl=auto');
    expect(calls[0].url).toContain('tl=zh-CN'); // zh 补成 zh-CN
    expect(new URLSearchParams(calls[0].body).get('q')).toBe('Hello world');
  });

  it('gtx 被拦（返回 HTML）→ 自动换 dict-chrome-ex 端点', async () => {
    const calls = mockFetch((c) => (c.url.includes('googleapis.com') ? new Response('<html>Sorry...</html>', { status: 200 }) : [['你好', 'en']]));
    const body = await j<TranslateResponse>(await tr(makeApp().app, { text: 'Hello', from: 'en', to: 'zh-CN' }));
    expect(body).toMatchObject({ text: '你好', detectedFrom: 'en' });
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['translate.googleapis.com', 'clients5.google.com']);
  });

  it('两个端点都失败 → 502 并带原因', async () => {
    mockFetch(() => new Response('blocked', { status: 429 }));
    const res = await tr(makeApp().app, { text: 'Hello', from: 'en', to: 'zh-CN' });
    expect(res.status).toBe(502);
    expect((await j<{ error: string }>(res)).error).toMatch(/翻译失败（google）.*gtx.*429.*dict-chrome-ex/);
  });

  it('长文本按段落/句子切块多次请求，空白（含换行）原样保留', async () => {
    const calls = mockFetch((c) => [[[`[${new URLSearchParams(c.body).get('q')!.length}]`]], null, 'en']);
    const text = `${'Sentence number one. '.repeat(150)}\n\n${'Another one here. '.repeat(150)}`;
    const res = await j<TranslateResponse>(await tr(makeApp().app, { text, from: 'en', to: 'zh-CN' }));
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((c) => new URLSearchParams(c.body).get('q')!.length <= 4500)).toBe(true);
    expect(res.text).toContain('\n\n'); // 段落分隔没丢
    const lens = [...res.text.matchAll(/\[(\d+)\]/g)].reduce((s, m) => s + Number(m[1]), 0);
    expect(lens).toBeGreaterThan(text.length - 100); // 每块去掉首尾空白后总字数基本等于原文
  });
});

describe('deepl / libretranslate / mymemory', () => {
  it('DeepL：免费 key（:fx）走 api-free，目标语言代码映射，鉴权头', async () => {
    const calls = mockFetch(() => ({ translations: [{ text: '你好', detected_source_language: 'EN' }] }));
    const { app } = makeApp({ MR_DEEPL_KEY: 'abc:fx' });
    const body = await j<TranslateResponse>(await tr(app, { text: 'Hello', from: 'auto', to: 'zh-TW', provider: 'deepl' }));
    expect(body).toEqual({ text: '你好', provider: 'deepl', detectedFrom: 'en' });
    expect(calls[0].url).toBe('https://api-free.deepl.com/v2/translate');
    expect(calls[0].headers.authorization).toBe('DeepL-Auth-Key abc:fx');
    expect(JSON.parse(calls[0].body)).toEqual({ text: ['Hello'], target_lang: 'ZH-HANT' });
    await tr(makeApp({ MR_DEEPL_KEY: 'pro-key' }).app, { text: 'x', from: 'de', to: 'en', provider: 'deepl' });
    expect(calls[1].url).toBe('https://api.deepl.com/v2/translate');
    expect(JSON.parse(calls[1].body)).toEqual({ text: ['x'], target_lang: 'EN-US', source_lang: 'DE' });
    await tr(makeApp({ MR_DEEPL_KEY: 'k', MR_DEEPL_URL: 'http://deepl.local/v2/translate' }).app, { text: 'x', from: 'auto', to: 'zh', provider: 'deepl' });
    expect(calls[2].url).toBe('http://deepl.local/v2/translate');
    expect(JSON.parse(calls[2].body).target_lang).toBe('ZH');
  });

  it('LibreTranslate：自定义地址、api_key、繁体代码 zt', async () => {
    const calls = mockFetch(() => ({ translatedText: '你好', detectedLanguage: { language: 'en' } }));
    const { app } = makeApp({ MR_LIBRETRANSLATE_URL: 'http://libre.local/', MR_LIBRETRANSLATE_KEY: 'lk' });
    const body = await j<TranslateResponse>(await tr(app, { text: 'Hello', from: 'auto', to: 'zh-TW', provider: 'libretranslate' }));
    expect(body).toEqual({ text: '你好', provider: 'libretranslate', detectedFrom: 'en' });
    expect(calls[0].url).toBe('http://libre.local/translate');
    expect(JSON.parse(calls[0].body)).toEqual({ q: 'Hello', source: 'auto', target: 'zt', format: 'text', api_key: 'lk' });
  });

  it('MyMemory：每块 ≤450 字符；auto 时按文字粗判源语言', async () => {
    const calls = mockFetch(() => ({ responseStatus: 200, responseData: { translatedText: '译' } }));
    const { app } = makeApp();
    await tr(app, { text: '你好。'.repeat(300), from: 'auto', to: 'en', provider: 'mymemory' });
    expect(calls.length).toBeGreaterThan(1);
    expect(new URL(calls[0].url).searchParams.get('langpair')).toBe('zh-CN|en');
    expect(calls.every((c) => new URL(c.url).searchParams.get('q')!.length <= 450)).toBe(true);
    mockFetch(() => ({ responseStatus: 403, responseDetails: 'QUOTA FINISHED' }));
    const bad = await tr(app, { text: 'hello', from: 'en', to: 'zh', provider: 'mymemory' });
    expect(bad.status).toBe(502);
    expect((await j<{ error: string }>(bad)).error).toContain('QUOTA FINISHED');
  });

  it('MR_TRANSLATE_PROVIDER 改默认引擎', async () => {
    const calls = mockFetch(() => ({ responseStatus: 200, responseData: { translatedText: '嗨' } }));
    const body = await j<TranslateResponse>(await tr(makeApp({ MR_TRANSLATE_PROVIDER: 'mymemory' }).app, { text: 'hi', from: 'en', to: 'zh' }));
    expect(body.provider).toBe('mymemory');
    expect(calls[0].url).toContain('mymemory');
  });
});

describe('参数校验', () => {
  it('缺 text / to、非 JSON、引擎不存在或没配置、文本过长', async () => {
    const { app } = makeApp();
    mockFetch(() => ({}));
    expect((await tr(app, { text: '  ', from: 'en', to: 'zh' })).status).toBe(400);
    expect((await tr(app, { text: 'x', from: 'en' })).status).toBe(400);
    expect((await app.request('/api/translate', { method: 'POST', body: 'nope' })).status).toBe(400);
    expect((await tr(app, { text: 'x', to: 'zh', provider: 'nonexistent' })).status).toBe(400);
    expect((await tr(app, { text: 'x', to: 'zh', provider: 'deepl' })).status).toBe(400); // 没配 key
    expect((await tr(app, { text: 'x'.repeat(20_001), to: 'zh' })).status).toBe(413);
  });
});

// 联网（默认跳过）：MR_TEST_NET=1 npx vitest run server/src/routes/translate.test.ts
describe.skipIf(!process.env.MR_TEST_NET)('联网：真实 Google gtx', () => {
  it('Hello world → 中文', async () => {
    vi.unstubAllGlobals();
    const body = await j<TranslateResponse>(await tr(makeApp().app, { text: 'Hello world', from: 'auto', to: 'zh-CN' }));
    expect(body.text).toMatch(/你好|世界/);
  }, 30_000);
});
