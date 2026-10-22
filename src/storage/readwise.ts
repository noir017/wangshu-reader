// Readwise 高亮同步（SYNC-012 / ANNO-011）。CORS 实测允许浏览器直连；直连失败再走服务端代理。
import type { AnnotationRecord, BookRecord } from '@/core/library';
import { describeNetworkError, describeStatus, hasServer } from '@/core/server';
import { dbEvents, getBook, getDb, getKV, setKV } from './db';
import { proxyFetch } from './http';
import { readwiseSettings } from '@/library/settings';

export interface ReadwiseHighlight {
  title: string;
  text: string;
  author: string;
  note?: string;
  chapter?: string;
}

export interface ReadwiseConfig {
  token: string;
  url: string;
}

export const DEFAULT_READWISE_URL = 'https://readwise.io/api/v2/highlights/';

export class ReadwiseError extends Error {}

export async function postHighlights(items: ReadwiseHighlight[], cfg: ReadwiseConfig, fetchImpl: typeof fetch = fetch): Promise<void> {
  const url = cfg.url.trim() || DEFAULT_READWISE_URL;
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8', Authorization: `Token ${cfg.token}` },
    body: JSON.stringify({ highlights: items }),
  };
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    if (!hasServer()) throw new ReadwiseError(describeNetworkError(e));
    res = await proxyFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8', 'X-Proxy-Authorization': `Token ${cfg.token}` }, body: init.body as string });
  }
  if (res.status !== 200) {
    let detail: string | undefined;
    try {
      const j = (await res.json()) as { detail?: string; message?: string };
      detail = j.detail ?? j.message;
    } catch {
      /* 非 JSON */
    }
    // Readwise 给的 detail 是英文原文，附在本地化的状态说明后面
    throw new ReadwiseError(detail ? `${describeStatus(res.status, res.statusText)} | ${detail}` : describeStatus(res.status, res.statusText));
  }
}

/** token 变更时发的测试高亮（同原 app，只把作者换成本应用的名字） */
export function sendTestHighlight(cfg: ReadwiseConfig, fetchImpl?: typeof fetch): Promise<void> {
  return postHighlights([{ title: 'test', author: 'Wangshu Reader', text: 'test highlight', note: 'test note' }], cfg, fetchImpl);
}

/** 标注 → Readwise 高亮；书签、没有原文的不分享（A.addNote 只在 original 非空时发） */
export function toReadwise(a: AnnotationRecord, book: Pick<BookRecord, 'title' | 'authors'>, withChapter: boolean): ReadwiseHighlight | null {
  if (a.kind !== 'highlight' || !a.text.trim() || a.deletedAt) return null;
  return {
    title: book.title,
    text: a.text,
    author: book.authors.join(', '),
    ...(a.note ? { note: a.note } : {}),
    ...(withChapter && a.chapterTitle ? { chapter: a.chapterTitle } : {}),
  };
}

const SENT_KEY = 'readwise.sent';

async function markSent(id: string): Promise<void> {
  const sent = (await getKV<string[]>(SENT_KEY)) ?? [];
  if (!sent.includes(id)) await setKV(SENT_KEY, [...sent, id].slice(-3000));
}

/** 手动分享单条（标注列表 ⋮ → Readwise） */
export async function shareAnnotation(a: AnnotationRecord): Promise<void> {
  const cfg = readwiseSettings.get();
  if (!cfg.token) throw new ReadwiseError('请先在设置里填写 Readwise 访问令牌');
  const book = await getBook(a.bookId);
  const h = book ? toReadwise(a, book, cfg.withChapter) : null;
  if (!h) throw new ReadwiseError('这条标注没有可分享的原文');
  await postHighlights([h], cfg);
  await markSent(a.id);
}

let started = false;
/** 自动分享新建的高亮和笔记：监听 annotations 变更，只处理「刚创建」的（createdAt 在 90 秒内）且没发过的 */
export function startReadwiseAutoShare(onError?: (msg: string) => void): void {
  if (started) return;
  started = true;
  dbEvents.on('change', (e) => {
    if (e.store !== 'annotations' || !e.key) return;
    const cfg = readwiseSettings.get();
    if (!cfg.auto || !cfg.token) return;
    void (async () => {
      const a = await (await getDb()).get('annotations', e.key!);
      if (!a || a.kind !== 'highlight' || a.deletedAt || Date.now() - a.createdAt > 90_000) return;
      const sent = (await getKV<string[]>(SENT_KEY)) ?? [];
      if (sent.includes(a.id)) return;
      await markSent(a.id); // 先占位，避免连续两次 change 事件重复发送
      const book = await getBook(a.bookId);
      const h = book ? toReadwise(a, book, cfg.withChapter) : null;
      if (!h) return;
      try {
        await postHighlights([h], cfg);
      } catch (err) {
        onError?.((err as Error).message);
      }
    })();
  });
}
