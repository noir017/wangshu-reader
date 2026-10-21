// POST /api/translate、GET /api/translate/providers
// 引擎：google（免费 gtx 端点，被拦时自动换 dict-chrome-ex 端点）、deepl（MR_DEEPL_KEY）、libretranslate（MR_LIBRETRANSLATE_URL）、mymemory（免费、每次 ≤500 字节）。
import type { TranslateRequest, TranslateResponse } from '@shared/api';
import type { RouteModule } from '../index';
import type { TranslateConfig } from '../config';
import { httpError } from '../util/http';
import { chunkText } from '../util/text';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const MAX_TEXT = 20_000;

interface Piece {
  text: string;
  detected?: string;
}

interface Provider {
  id: string;
  name: string;
  available(cfg: TranslateConfig): boolean;
  /** 单块文本（已按 chunk 大小切好）翻译 */
  chunkSize: number;
  translate(text: string, from: string, to: string, cfg: TranslateConfig): Promise<Piece>;
}

async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 15_000), headers: { 'User-Agent': UA, ...(init.headers as Record<string, string> | undefined) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}：${text.slice(0, 120).replace(/\s+/g, ' ')}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`返回的不是 JSON（可能被限流/验证码拦截）：${text.slice(0, 80).replace(/\s+/g, ' ')}`);
  }
}

// ── google ──
const googleCode = (c: string): string => (c === 'auto' ? 'auto' : c === 'zh' ? 'zh-CN' : c);

const google: Provider = {
  id: 'google',
  name: 'Google 翻译',
  chunkSize: 4500,
  available: () => true,
  async translate(text, from, to) {
    const sl = googleCode(from);
    const tl = googleCode(to);
    const errors: string[] = [];
    // 1) gtx：数据中心 IP 常被拦（返回 "Sorry..." 页面）
    try {
      const j = (await fetchJson(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ q: text }),
      })) as [[string, string][], unknown, string];
      return { text: j[0].map((s) => s[0] ?? '').join(''), detected: typeof j[2] === 'string' ? j[2] : undefined };
    } catch (e) {
      errors.push(`gtx ${(e as Error).message}`);
    }
    // 2) dict-chrome-ex：Google 词典扩展用的端点，同样免费
    try {
      const j = (await fetchJson(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ q: text }),
      })) as (string | [string, string])[];
      const first = j[0];
      if (Array.isArray(first)) return { text: first[0], detected: first[1] };
      if (typeof first === 'string') return { text: first };
      throw new Error('返回格式不认识');
    } catch (e) {
      errors.push(`dict-chrome-ex ${(e as Error).message}`);
    }
    throw new Error(errors.join('；'));
  },
};

// ── deepl ──
const deeplTarget = (c: string): string => {
  const l = c.toLowerCase();
  if (l === 'zh-tw' || l === 'zh-hk' || l === 'zh-hant') return 'ZH-HANT';
  if (l === 'zh' || l.startsWith('zh-')) return 'ZH';
  if (l === 'en') return 'EN-US';
  if (l === 'pt') return 'PT-BR';
  return c.toUpperCase();
};

const deepl: Provider = {
  id: 'deepl',
  name: 'DeepL',
  chunkSize: 4500,
  available: (cfg) => !!cfg.deeplKey,
  async translate(text, from, to, cfg) {
    const url = cfg.deeplUrl ?? (cfg.deeplKey.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate');
    const body: Record<string, unknown> = { text: [text], target_lang: deeplTarget(to) };
    if (from !== 'auto') body.source_lang = from.split('-')[0].toUpperCase();
    const j = (await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `DeepL-Auth-Key ${cfg.deeplKey}` },
      body: JSON.stringify(body),
    })) as { translations: { text: string; detected_source_language?: string }[] };
    const t = j.translations?.[0];
    if (!t) throw new Error('DeepL 没有返回译文');
    return { text: t.text, detected: t.detected_source_language?.toLowerCase() };
  },
};

// ── libretranslate ──
const libreCode = (c: string): string => {
  if (c === 'auto') return 'auto';
  const l = c.toLowerCase();
  if (l === 'zh-tw' || l === 'zh-hk' || l === 'zh-hant') return 'zt';
  return l.split('-')[0];
};

const libretranslate: Provider = {
  id: 'libretranslate',
  name: 'LibreTranslate',
  chunkSize: 4000,
  available: (cfg) => !!cfg.libreUrl,
  async translate(text, from, to, cfg) {
    const j = (await fetchJson(`${cfg.libreUrl!.replace(/\/+$/, '')}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: libreCode(from), target: libreCode(to), format: 'text', ...(cfg.libreKey ? { api_key: cfg.libreKey } : {}) }),
    })) as { translatedText?: string; detectedLanguage?: { language?: string }; error?: string };
    if (j.error || j.translatedText === undefined) throw new Error(j.error ?? 'LibreTranslate 没有返回译文');
    return { text: j.translatedText, detected: j.detectedLanguage?.language };
  },
};

// ── mymemory ──
const mymemory: Provider = {
  id: 'mymemory',
  name: 'MyMemory',
  chunkSize: 450, // 免费接口每次最多 500 字节
  available: () => true,
  async translate(text, from, to) {
    // MyMemory 不支持 auto：源语言按文字粗判
    const src = from === 'auto' ? (/[一-鿿]/.test(text) ? 'zh-CN' : /[぀-ヿ]/.test(text) ? 'ja' : /[가-힯]/.test(text) ? 'ko' : 'en') : from;
    const j = (await fetchJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`${src}|${to}`)}`)) as {
      responseData?: { translatedText?: string };
      responseStatus?: number | string;
      responseDetails?: string;
    };
    if (Number(j.responseStatus) !== 200 || !j.responseData?.translatedText) throw new Error(j.responseDetails || 'MyMemory 没有返回译文');
    return { text: j.responseData.translatedText, detected: src === from ? undefined : src };
  },
};

const PROVIDERS: Provider[] = [google, deepl, libretranslate, mymemory];

export const route: RouteModule = {
  register(app, ctx) {
    const { config } = ctx;
    config.features.translate = true;
    const cfg = config.translate;

    app.get('/api/translate/providers', (c) => c.json({ providers: PROVIDERS.filter((p) => p.available(cfg)).map((p) => ({ id: p.id, name: p.name })) }));

    app.post('/api/translate', async (c) => {
      let req: TranslateRequest;
      try {
        req = (await c.req.json()) as TranslateRequest;
      } catch {
        throw httpError(400, '请求体不是有效的 JSON');
      }
      const text = typeof req?.text === 'string' ? req.text : '';
      if (!text.trim()) throw httpError(400, '缺少 text');
      if (text.length > MAX_TEXT) throw httpError(413, `文本过长（上限 ${MAX_TEXT} 字）`);
      const to = (req.to ?? '').trim();
      if (!to) throw httpError(400, '缺少目标语言 to');
      const from = (req.from ?? 'auto').trim() || 'auto';
      const id = req.provider || cfg.defaultProvider;
      const provider = PROVIDERS.find((p) => p.id === id);
      if (!provider || !provider.available(cfg)) throw httpError(400, `翻译引擎不可用：${id}`);

      try {
        const parts: string[] = [];
        let detected: string | undefined;
        for (const chunk of chunkText(text, provider.chunkSize)) {
          if (!chunk.trim()) {
            parts.push(chunk);
            continue;
          }
          const lead = /^\s*/.exec(chunk)![0];
          const tail = /\s*$/.exec(chunk)![0];
          const r = await provider.translate(chunk.trim(), from, to, cfg);
          detected ??= r.detected;
          parts.push(lead + r.text + tail);
        }
        const body: TranslateResponse = { text: parts.join(''), provider: provider.id, ...(detected ? { detectedFrom: detected } : {}) };
        return c.json(body);
      } catch (e) {
        throw httpError(502, `翻译失败（${provider.id}）：${(e as Error).message}`);
      }
    });
  },
};
