// 章节纯文本缓存：getSectionText 对未加载章节会临时加载，开销不小；偏移基准不会变，所以按引擎实例缓存。
import type { ReaderController } from '@/core/reader';
import { textWithBreaks } from '@/core/text';

interface Entry {
  text?: string;
  breaks?: number[];
  pending?: Promise<string>;
}

const caches = new WeakMap<ReaderController, Map<number, Entry>>();

function mapOf(c: ReaderController): Map<number, Entry> {
  let m = caches.get(c);
  if (!m) caches.set(c, (m = new Map()));
  return m;
}

export function sectionCount(c: ReaderController): number {
  const b = c.book;
  return b.kind === 'reflowable' ? b.sections.length : b.pageCount;
}

/** 已缓存的章节文本（没有则 undefined，不触发加载） */
export function peekSectionText(c: ReaderController, section: number): string | undefined {
  return mapOf(c).get(section)?.text;
}

/** 引擎加载完某章（sectionReady）时顺手缓存，省一次临时加载 */
export function primeSectionText(c: ReaderController, section: number, doc: Document): string {
  const { text, breaks } = textWithBreaks(doc.body);
  mapOf(c).set(section, { text, breaks });
  return text;
}

export async function getSectionText(c: ReaderController, section: number): Promise<string> {
  const m = mapOf(c);
  const e = m.get(section);
  if (e?.text !== undefined) return e.text;
  if (e?.pending) return e.pending;
  const pending = c.getSectionText(section).then(
    (text) => {
      m.set(section, { text, breaks: m.get(section)?.breaks });
      return text;
    },
    (err) => {
      m.delete(section);
      throw err;
    },
  );
  m.set(section, { pending });
  return pending;
}

export async function getSectionTextWithBreaks(c: ReaderController, section: number): Promise<{ text: string; breaks: number[] }> {
  const e = mapOf(c).get(section);
  if (e?.text !== undefined && e.breaks) return { text: e.text, breaks: e.breaks };
  const r = await c.getSectionTextWithBreaks(section);
  mapOf(c).set(section, { text: r.text, breaks: r.breaks });
  return r;
}

export function clearSectionTexts(c: ReaderController): void {
  caches.delete(c);
}
