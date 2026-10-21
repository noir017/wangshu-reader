// @vitest-environment node
import type { DictResponse } from '@shared/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { j, makeApp } from '../test-utils';
import { cleanWord, sourceOrder } from './dict';

const urls: string[] = [];

/** 按 URL 里的主机分发替身响应；返回 undefined 视为 404 */
function mockFetch(routes: Record<string, (url: URL) => unknown>): void {
  urls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const u = new URL(String(input));
      urls.push(u.href);
      const h = routes[u.host];
      const r = h ? h(u) : undefined;
      if (r === undefined) return new Response('not found', { status: 404 });
      if (r instanceof Response) return r;
      return new Response(JSON.stringify(r), { status: 200 });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

const dict = async (app: ReturnType<typeof makeApp>['app'], qs: string) => app.request(`/api/dict?${qs}`);

const YOUDAO_EN = {
  ec: { word: { ukphone: 'ˈhelləʊ', usphone: 'həˈloʊ', usspeech: 'hello&type=2', trs: [{ pos: 'int.', tran: '喂；你好' }, { pos: 'n.', tran: '问候 <b>x</b>' }] }, exam_type: ['CET4', 'GRE'] },
};

describe('选词与来源顺序', () => {
  it('cleanWord：去首尾标点引号与多余空白', () => {
    expect(cleanWord('  “Hello,”  ')).toBe('Hello');
    expect(cleanWord('(a   b)')).toBe('a b');
    expect(cleanWord('...')).toBe('');
  });

  it('sourceOrder：汉字优先有道；目标中文先有道；英英先 Free Dictionary；其他语言只走 Wiktionary', () => {
    const ids = (w: string, f: string, t: string) => sourceOrder(w, f, t).map((s) => s.id);
    expect(ids('你好', 'auto', 'en')).toEqual(['youdao', 'wiktionary']);
    expect(ids('hello', 'en', 'zh-CN')).toEqual(['youdao', 'freedict', 'wiktionary']);
    expect(ids('hello', 'en', 'en')).toEqual(['freedict', 'wiktionary', 'youdao']);
    expect(ids('bonjour', 'fr', 'zh')).toEqual(['wiktionary']);
  });
});

describe('/api/dict', () => {
  it('有道（英→汉）：释义 HTML、音标、发音地址包成本服务端的 /api/dict/audio', async () => {
    mockFetch({ 'dict.youdao.com': () => YOUDAO_EN });
    const { app } = makeApp();
    const res = await app.request('/api/dict?word=hello&from=en&to=zh-CN', { headers: { Host: 'srv.local:8090' } });
    const body = await j<DictResponse>(res);
    expect(body).toMatchObject({ word: 'hello', source: 'youdao', phonetic: '英 [ˈhelləʊ]  美 [həˈloʊ]' });
    expect(body.html).toContain('<span class="mr-pos">int.</span> <span class="mr-def">喂；你好</span>');
    expect(body.html).toContain('GRE');
    expect(body.html).not.toContain('<b>'); // 释义里的标签被转义
    expect(body.audio).toBe(`http://srv.local:8090/api/dict/audio?url=${encodeURIComponent('https://dict.youdao.com/dictvoice?audio=hello&type=2')}`);
  });

  it('有道（汉→英）与汉汉', async () => {
    mockFetch({
      'dict.youdao.com': () => ({
        ce: { word: [{ phone: 'nǐ hǎo', trs: [{ '#text': 'hello', '#tran': '' }], }] },
        newhh: { dataList: [{ pinyin: 'nǐ hǎo', sense: [{ cat: '叹', def: ['问候语'], examples: ['你好，<self>世界</self>'] }] }] },
      }),
    });
    const body = await j<DictResponse>(await dict(makeApp().app, `word=${encodeURIComponent('你好')}&from=zh&to=en`));
    expect(body.source).toBe('youdao');
    expect(body.phonetic).toBe('nǐ hǎo');
    expect(body.html).toContain('问候语');
    expect(body.html).toContain('你好，世界');
    expect(body.html).not.toContain('self');
  });

  it('Free Dictionary（英英）：音标、美式发音、前 5 条释义与例句', async () => {
    mockFetch({
      'api.dictionaryapi.dev': () => [
        {
          word: 'run',
          phonetic: '/rʌn/',
          phonetics: [{ audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/run-uk.mp3' }, { audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/run-us.mp3' }],
          meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'To move <fast>.', example: 'I run.' }, ...Array.from({ length: 8 }, (_, i) => ({ definition: `d${i}` }))] }],
        },
      ],
    });
    const body = await j<DictResponse>(await dict(makeApp().app, 'word=run&from=en&to=en'));
    expect(body.source).toBe('freedict');
    expect(body.phonetic).toBe('/rʌn/');
    expect(body.audio).toContain(encodeURIComponent('run-us.mp3'));
    expect(body.html).toContain('To move &lt;fast&gt;.');
    expect(body.html.match(/<li>/g)).toHaveLength(5);
    expect(body.html).toContain('<div class="mr-example">I run.</div>');
  });

  it('Free Dictionary 查不到（404 / Cloudflare 530）→ 退到 Wiktionary，释义里的脚本被清洗', async () => {
    mockFetch({
      'api.dictionaryapi.dev': () => new Response('error code: 1033', { status: 530 }),
      'en.wiktionary.org': () => ({ en: [{ language: 'English', partOfSpeech: 'Noun', definitions: [{ definition: 'A <a href="/wiki/x" onclick="evil()">gift</a><script>alert(1)</script>.' }] }] }),
    });
    const body = await j<DictResponse>(await dict(makeApp().app, 'word=serendipity&from=en&to=en'));
    expect(body.source).toBe('wiktionary');
    expect(body.html).toContain('<li>A gift.</li>');
    expect(body.html).not.toMatch(/script|onclick|href/);
  });

  it('句首大写的词查不到时退回小写再试；查无此词返回空 html 而不是错误', async () => {
    mockFetch({ 'api.dictionaryapi.dev': (u) => (u.pathname.endsWith('/apple') ? [{ word: 'apple', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fruit.' }] }] }] : undefined), 'en.wiktionary.org': () => undefined, 'dict.youdao.com': () => ({}) });
    const { app } = makeApp();
    expect((await j<DictResponse>(await dict(app, 'word=Apple&from=en&to=en'))).html).toContain('A fruit.');
    const none = await j<DictResponse>(await dict(app, 'word=xyzzyqwerty&from=en&to=en'));
    expect(none).toMatchObject({ word: 'xyzzyqwerty', html: '' });
  });

  it('所有来源都出错（网络故障）→ 502；有一个来源正常答复「查无」就不算错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const res = await dict(makeApp().app, 'word=hello&from=en&to=en');
    expect(res.status).toBe(502);
    expect((await j<{ error: string }>(res)).error).toMatch(/词典查询失败/);
  });

  it('结果缓存：相同查询不再请求外部站点', async () => {
    mockFetch({ 'dict.youdao.com': () => YOUDAO_EN });
    const { app } = makeApp();
    await dict(app, 'word=hello&from=en&to=zh');
    const n = urls.length;
    await dict(app, 'word=hello&from=en&to=zh');
    expect(urls.length).toBe(n);
  });

  it('source 参数指定来源；未知来源 400；缺 word / 过长 400', async () => {
    mockFetch({ 'en.wiktionary.org': () => ({ en: [{ language: 'English', partOfSpeech: 'Noun', definitions: [{ definition: 'x' }] }] }) });
    const { app } = makeApp();
    expect((await j<DictResponse>(await dict(app, 'word=test&source=wiktionary'))).source).toBe('wiktionary');
    expect((await dict(app, 'word=test&source=nope')).status).toBe(400);
    expect((await dict(app, 'word=')).status).toBe(400);
    expect((await dict(app, `word=${'a'.repeat(101)}`)).status).toBe(400);
    const src = await j<{ sources: { id: string }[] }>(await app.request('/api/dict/sources'));
    expect(src.sources.map((s) => s.id)).toEqual(['auto', 'youdao', 'freedict', 'wiktionary']);
  });

  it('设了 MR_TOKEN 时发音地址带 token（<audio> 不能加请求头）；X-Forwarded-* 决定对外地址', async () => {
    mockFetch({ 'dict.youdao.com': () => YOUDAO_EN });
    const { app } = makeApp({ MR_TOKEN: 'tk en' });
    const res = await app.request('/api/dict?word=hello&from=en&to=zh&token=tk%20en', { headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'books.example.com', 'X-Forwarded-Prefix': '/mr/' } });
    const body = await j<DictResponse>(res);
    expect(body.audio).toMatch(/^https:\/\/books\.example\.com\/mr\/api\/dict\/audio\?url=.*&token=tk%20en$/);
  });
});

describe('/api/dict/audio', () => {
  it('只允许白名单主机、只给音频；不是任意代理', async () => {
    const { app } = makeApp();
    const get = (u: string) => app.request(`/api/dict/audio?url=${encodeURIComponent(u)}`);
    expect((await get('http://127.0.0.1:1/x.mp3')).status).toBe(403);
    expect((await get('https://example.com/x.mp3')).status).toBe(403);
    expect((await get('http://169.254.169.254/latest')).status).toBe(403);
    expect((await get('https://evil.test/dictionaryapi.dev')).status).toBe(403);
    expect((await get('ftp://dict.youdao.com/x')).status).toBe(400);
    expect((await get('not a url')).status).toBe(400);
    expect((await app.request('/api/dict/audio')).status).toBe(400);
  });
});

// 联网（默认跳过）：MR_TEST_NET=1 npx vitest run server/src/routes/dict.test.ts
describe.skipIf(!process.env.MR_TEST_NET)('联网：真实词典', () => {
  it('英文词（有道/Wiktionary）与中文词，发音文件可经本服务端取到', async () => {
    vi.unstubAllGlobals();
    const { app } = makeApp();
    const en = await j<DictResponse>(await dict(app, 'word=serendipity&from=en&to=zh-CN'));
    expect(en.html).toContain('mr-sense');
    const zh = await j<DictResponse>(await dict(app, `word=${encodeURIComponent('你好')}&from=zh&to=en`));
    expect(zh.html).toContain('hello');
    expect(en.audio).toBeTruthy();
    const audio = await app.request(new URL(en.audio!).pathname + new URL(en.audio!).search);
    expect(audio.status).toBe(200);
    expect(audio.headers.get('Content-Type')).toMatch(/^audio\//);
    expect((await audio.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  }, 40_000);
});
