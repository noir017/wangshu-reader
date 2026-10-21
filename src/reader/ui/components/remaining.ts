// 剩余阅读时间（STATUS-003）：速度 = 本书已读字数/已读分钟（累计阅读 >10 分钟才用本书数据，否则全局统计，否则默认值）。
import { useEffect, useState } from 'react';
import type { ReaderLocation } from '@/core/reader';
import type { ReaderSession } from '@/core/reader-session';
import { getStats, listStats } from '@/storage/db';
import { t } from '../messages';

/** 默认速度：中日韩 400 字/分，其他 220 词/分 */
export function defaultWpm(lang: string | undefined): number {
  return /^(zh|ja|ko)/i.test(lang ?? '') ? 400 : 220;
}

export function pickSpeed(bookStat: { usedMs: number; words: number } | undefined, globalStats: { usedMs: number; words: number }[], lang: string | undefined): number {
  if (bookStat && bookStat.usedMs > 10 * 60_000 && bookStat.words > 0) return (bookStat.words / bookStat.usedMs) * 60_000;
  const g = globalStats.reduce((a, s) => ({ usedMs: a.usedMs + s.usedMs, words: a.words + s.words }), { usedMs: 0, words: 0 });
  if (g.usedMs > 10 * 60_000 && g.words > 0) return (g.words / g.usedMs) * 60_000;
  return defaultWpm(lang);
}

/** 剩余字数 → 分钟；charCount 是字符数，非 CJK 书折成词（≈5.5 字符/词） */
export function remainingMinutes(chars: number, wpm: number, cjk: boolean): number {
  const words = cjk ? chars : chars / 5.5;
  return Math.max(0, Math.ceil(words / Math.max(wpm, 1)));
}

export function remainingText(chapterMin: number, bookMin: number): string {
  const h = Math.floor(bookMin / 60);
  const m = bookMin % 60;
  return t('remaining_both', { c: chapterMin, h, m });
}

export function remainingChars(session: ReaderSession, loc: ReaderLocation): { chapter: number; book: number } | null {
  const book = session.book;
  if (book.kind !== 'reflowable') return null;
  const sec = book.sections[loc.section];
  if (!sec) return null;
  const chapter = Math.max(0, sec.charCount - loc.locator.offset);
  let rest = chapter;
  for (let i = loc.section + 1; i < book.sections.length; i++) rest += book.sections[i].charCount;
  return { chapter, book: rest };
}

export function useRemainingText(session: ReaderSession | null, loc: ReaderLocation | null, enabled: boolean): string {
  const [wpm, setWpm] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || !session) return;
    let alive = true;
    void (async () => {
      const [mine, all] = await Promise.all([getStats(session.bookId), listStats()]);
      if (alive) setWpm(pickSpeed(mine, all, session.book.metadata.language));
    })();
    return () => {
      alive = false;
    };
  }, [enabled, session]);
  if (!enabled || !session || !loc || wpm === null) return '';
  const rest = remainingChars(session, loc);
  if (!rest) return '';
  const cjk = /^(zh|ja|ko)/i.test(session.book.metadata.language ?? '');
  return remainingText(remainingMinutes(rest.chapter, wpm, cjk), remainingMinutes(rest.book, wpm, cjk));
}
