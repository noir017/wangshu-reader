// GET /api/dict?word=&from=&to=&source= 、GET /api/dict/sources 、GET /api/dict/audio?url=
// 词条来源：有道词典（中英互查，jsonapi_s）、Free Dictionary API（英英）、Wiktionary（多语种）。
// 返回的 html 由服务端拼好并清洗：只含白名单标签，class 只有 mr-* 前缀（前端按需给样式）。
import type { DictResponse } from '@shared/api';
import type { Context } from 'hono';
import { Readable } from 'node:stream';
import type { RouteModule } from '../index';
import { followRequest, ProxyError } from './proxy';
import { SAFE_HEADERS } from '../lib/serve-file';
import { httpError } from '../util/http';
import { escapeHtml as esc, sanitizeHtml } from '../util/text';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const API_UA = 'wangshu-reader/0.1 (+https://github.com/; dictionary lookup)';

interface Entry {
  html: string;
  phonetic?: string;
  /** 发音音频的原始 URL（返回前再包成本服务端的 /api/dict/audio 链接） */
  audio?: string;
}

interface Source {
  id: string;
  name: string;
  langs: string[];
  lookup(word: string, opts: { from: string; to: string }): Promise<Entry | null>;
}

async function getJson(url: string, ua = UA): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  // Free Dictionary API 对查不到的词有时回 404，有时回 Cloudflare 的 530
  if (res.status === 404 || res.status === 400 || res.status === 530) return { status: res.status, json: null };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { status: res.status, json: await res.json() };
}

const div = (cls: string, inner: string) => `<div class="mr-${cls}">${inner}</div>`;
const span = (cls: string, inner: string) => `<span class="mr-${cls}">${inner}</span>`;
const head = (word: string, phon?: string) => div('head', span('word', esc(word)) + (phon ? ' ' + span('phon', esc(phon)) : ''));

// ───────────────────────── 有道 ─────────────────────────

type J = Record<string, any>; // 有道返回结构深且不稳定，这里按需取用

const youdao: Source = {
  id: 'youdao',
  name: '有道词典',
  langs: ['en', 'zh'],
  async lookup(word) {
    const { json } = await getJson(`https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4&client=web&le=en&q=${encodeURIComponent(word)}`);
    const j = json as J | null;
    if (!j) return null;
    const parts: string[] = [];
    let phonetic: string | undefined;
    let audio: string | undefined;
    const cjk = /[㐀-鿿]/.test(word);

    // 英 → 汉
    const ec = j.ec?.word;
    const ecw: J | undefined = Array.isArray(ec) ? ec[0] : ec;
    if (ecw?.trs?.length) {
      const uk = ecw.ukphone ? `英 [${ecw.ukphone}]` : '';
      const us = ecw.usphone ? `美 [${ecw.usphone}]` : '';
      phonetic = [uk, us].filter(Boolean).join('  ') || undefined;
      if (ecw.usspeech || ecw.ukspeech) audio = `https://dict.youdao.com/dictvoice?audio=${ecw.usspeech ?? ecw.ukspeech}`;
      parts.push(head(word, phonetic));
      const exam: string[] = j.ec?.exam_type ?? [];
      for (const t of ecw.trs as J[]) parts.push(div('sense', (t.pos ? span('pos', esc(t.pos)) + ' ' : '') + span('def', esc(t.tran ?? ''))));
      if (exam.length) parts.push(div('tags', esc(exam.join(' / '))));
    }
    // 汉 → 英 / 汉汉
    if (cjk) {
      const ce = j.ce?.word;
      const cew: J | undefined = Array.isArray(ce) ? ce[0] : ce;
      const pinyin: string | undefined = cew?.phone ?? j.newhh?.dataList?.[0]?.pinyin;
      if (!parts.length) parts.push(head(word, pinyin));
      if (pinyin) phonetic = pinyin;
      for (const d of (j.newhh?.dataList ?? []) as J[]) {
        for (const s of (d.sense ?? []) as J[]) {
          const def = (s.def ?? []).join('；');
          if (def) parts.push(div('sense', (s.cat ? span('pos', esc(s.cat)) + ' ' : '') + span('def', esc(def))));
          for (const ex of ((s.examples ?? []) as string[]).slice(0, 2)) parts.push(div('example', sanitizeHtml(String(ex).replace(/<\/?self>/g, ''))));
        }
      }
      for (const t of (cew?.trs ?? []) as J[]) {
        const en = t['#text'] ?? '';
        const zh = t['#tran'] ?? '';
        if (en) parts.push(div('sense', span('def', esc(en)) + (zh ? ' ' + esc(zh) : '')));
      }
      if (cew?.trs?.[0]?.voice) audio ??= `https://dict.youdao.com/dictvoice?audio=${cew.trs[0].voice}`;
    }
    // 兜底：网络释义
    if (!parts.length) {
      const web: J[] = j.web_trans?.['web-translation'] ?? [];
      const hit = web.find((w) => String(w.key).toLowerCase() === word.toLowerCase()) ?? web[0];
      const vals = ((hit?.trans ?? []) as J[]).map((t) => t.value).filter(Boolean).slice(0, 6);
      if (!vals.length) return null;
      parts.push(head(word), div('sense', span('pos', '网络释义') + ' ' + span('def', esc(vals.join('；')))));
    }
    parts.push(div('src', '有道词典'));
    return { html: parts.join(''), phonetic, audio };
  },
};

// ───────────────────────── Free Dictionary API ─────────────────────────

const freedict: Source = {
  id: 'freedict',
  name: 'Free Dictionary（英英）',
  langs: ['en'],
  async lookup(word) {
    const { json } = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, API_UA);
    const entries = json as J[] | null;
    if (!Array.isArray(entries) || !entries.length) return null;
    const first = entries[0];
    const phonetics = (entries.flatMap((e) => e.phonetics ?? []) as J[]) ?? [];
    const phonetic: string | undefined = first.phonetic ?? phonetics.find((p) => p.text)?.text;
    const audioHit = phonetics.find((p) => /-us\.mp3/.test(p.audio ?? '')) ?? phonetics.find((p) => p.audio);
    const parts: string[] = [head(first.word ?? word, phonetic)];
    for (const e of entries) {
      for (const m of (e.meanings ?? []) as J[]) {
        const defs = ((m.definitions ?? []) as J[]).slice(0, 5);
        parts.push(
          div(
            'meaning',
            div('pos', esc(m.partOfSpeech ?? '')) +
              `<ol>${defs.map((d) => `<li>${esc(d.definition ?? '')}${d.example ? div('example', esc(d.example)) : ''}</li>`).join('')}</ol>`,
          ),
        );
      }
    }
    parts.push(div('src', 'Free Dictionary API / Wiktionary'));
    return { html: parts.join(''), phonetic, audio: audioHit?.audio || undefined };
  },
};

// ───────────────────────── Wiktionary ─────────────────────────

const wiktionary: Source = {
  id: 'wiktionary',
  name: 'Wiktionary',
  langs: ['*'],
  async lookup(word, { from }) {
    const { json } = await getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`, API_UA);
    const data = json as Record<string, J[]> | null;
    if (!data || typeof data !== 'object') return null;
    const langs = Object.keys(data);
    if (!langs.length) return null;
    // 词条的语言优先：用户指定的 from，其次中日韩/英
    const pref = [from.split('-')[0], /[぀-ヿ]/.test(word) ? 'ja' : '', /[가-힯]/.test(word) ? 'ko' : '', /[一-鿿]/.test(word) ? 'zh' : '', 'en'].filter(Boolean);
    langs.sort((a, b) => {
      const ia = pref.indexOf(a);
      const ib = pref.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const parts: string[] = [head(word)];
    for (const lang of langs.slice(0, 3)) {
      const blocks = data[lang];
      if (!blocks?.length) continue;
      parts.push(div('lang', esc(blocks[0].language ?? lang)));
      for (const b of blocks) {
        const defs = ((b.definitions ?? []) as J[]).filter((d) => d.definition).slice(0, 6);
        if (!defs.length) continue;
        parts.push(div('meaning', div('pos', esc(b.partOfSpeech ?? '')) + `<ol>${defs.map((d) => `<li>${sanitizeHtml(String(d.definition))}</li>`).join('')}</ol>`));
      }
    }
    parts.push(div('src', 'Wiktionary'));
    return { html: parts.join('') };
  },
};

const SOURCES: Source[] = [youdao, freedict, wiktionary];

/** 按词的语言与目标语言决定尝试顺序 */
export function sourceOrder(word: string, from: string, to: string): Source[] {
  const cjk = /[㐀-鿿぀-ヿ가-힯]/.test(word);
  const f = from.toLowerCase();
  if (f !== 'auto' && f !== '' && !f.startsWith('en') && !f.startsWith('zh')) return [wiktionary];
  if (cjk) return [youdao, wiktionary];
  if (to.toLowerCase().startsWith('zh')) return [youdao, freedict, wiktionary];
  return [freedict, wiktionary, youdao];
}

export function cleanWord(raw: string): string {
  return raw
    .trim()
    .replace(/^[\s"'“”‘’()[\]{}<>.,;:!?…—–\-_*]+|[\s"'“”‘’()[\]{}<>.,;:!?…—–\-_*]+$/g, '')
    .replace(/\s+/g, ' ');
}

/** 发音文件只允许从这些主机经本服务端取（不开放成任意代理） */
const AUDIO_HOSTS = ['dictionaryapi.dev', 'youdao.com', 'wikimedia.org', 'gstatic.com', 'merriam-webster.com', 'cambridge.org', 'oxfordlearnersdictionaries.com'];

export const route: RouteModule = {
  register(app, ctx) {
    const { config } = ctx;
    config.features.dict = true;
    const cache = new Map<string, { at: number; entry: { source: string; entry: Entry } | null }>();

    const audioUrl = (c: Context, raw: string): string => {
      const proto = c.req.header('X-Forwarded-Proto') ?? new URL(c.req.url).protocol.replace(':', '');
      const host = c.req.header('X-Forwarded-Host') ?? c.req.header('Host') ?? new URL(c.req.url).host;
      const prefix = (c.req.header('X-Forwarded-Prefix') ?? '').replace(/\/+$/, '');
      return `${proto}://${host}${prefix}/api/dict/audio?url=${encodeURIComponent(raw)}${config.token ? `&token=${encodeURIComponent(config.token)}` : ''}`;
    };

    app.get('/api/dict/sources', (c) =>
      c.json({ sources: [{ id: 'auto', name: '自动', langs: ['*'] }, ...SOURCES.map((s) => ({ id: s.id, name: s.name, langs: s.langs }))] }),
    );

    app.get('/api/dict', async (c) => {
      const word = cleanWord(c.req.query('word') ?? '');
      if (!word) throw httpError(400, '缺少 word');
      if (word.length > 100) throw httpError(400, 'word 过长');
      const from = c.req.query('from') ?? 'auto';
      const to = c.req.query('to') ?? 'en';
      const sourceId = c.req.query('source') || 'auto';
      let order: Source[];
      if (sourceId === 'auto') order = sourceOrder(word, from, to);
      else {
        const s = SOURCES.find((x) => x.id === sourceId);
        if (!s) throw httpError(400, `未知词典来源：${sourceId}`);
        order = [s];
      }
      const key = `${order.map((s) => s.id).join(',')}\0${word}\0${from}\0${to}`;
      const hit = cache.get(key);
      let found = hit && Date.now() - hit.at < 3600_000 ? hit.entry : undefined;
      let lastErr: Error | undefined;
      let answered = 0; // 正常给出答复（含「查无此词」）的来源数
      if (found === undefined) {
        found = null;
        for (const s of order) {
          try {
            let e = await s.lookup(word, { from, to });
            // 句首大写的词在 Wiktionary/Free Dictionary 里查不到时，退回小写再试一次
            if (!e && word !== word.toLowerCase() && s.id !== 'youdao') e = await s.lookup(word.toLowerCase(), { from, to });
            answered++;
            if (e) {
              found = { source: s.id, entry: e };
              break;
            }
          } catch (err) {
            lastErr = err as Error;
          }
        }
        // 所有来源都出错（而不是「查无此词」）才报错，且不缓存
        if (!found && !answered && lastErr) throw httpError(502, `词典查询失败：${lastErr.message}`);
        cache.set(key, { at: Date.now(), entry: found });
        if (cache.size > 500) cache.delete(cache.keys().next().value!);
      }
      const body: DictResponse = found
        ? {
            word,
            source: found.source,
            html: sanitizeHtml(found.entry.html),
            ...(found.entry.phonetic ? { phonetic: found.entry.phonetic } : {}),
            ...(found.entry.audio ? { audio: audioUrl(c, found.entry.audio) } : {}),
          }
        : { word, source: order[0].id, html: '' };
      return c.json(body);
    });

    app.get('/api/dict/audio', async (c) => {
      const raw = c.req.query('url') ?? '';
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        throw httpError(400, 'url 无法解析');
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw httpError(400, '只支持 http/https');
      try {
        const { res } = await followRequest(
          url,
          'GET',
          { host: url.host, 'user-agent': UA, accept: 'audio/*,*/*;q=0.5', 'accept-encoding': 'identity', ...(c.req.header('Range') ? { range: c.req.header('Range') } : {}) },
          null,
          { ...config.proxy, allowHosts: AUDIO_HOSTS, blockPrivate: true, maxRedirects: 5 },
          15_000,
          c.req.raw.signal,
        );
        const ct = String(res.headers['content-type'] ?? '');
        if (!/^audio\/|^application\/(octet-stream|ogg)/i.test(ct)) {
          res.resume();
          throw httpError(502, '目标不是音频');
        }
        const h = new Headers({ 'Content-Type': ct, 'Cache-Control': 'private, max-age=86400', ...SAFE_HEADERS });
        for (const n of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) if (res.headers[n]) h.set(n, String(res.headers[n]));
        return new Response(Readable.toWeb(res) as ReadableStream, { status: res.statusCode ?? 200, headers: h });
      } catch (e) {
        if (e instanceof ProxyError) throw httpError(e.status === 403 ? 403 : 502, e.message);
        throw e;
      }
    });
  },
};
