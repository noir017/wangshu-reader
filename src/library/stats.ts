// 阅读统计（STAT-001..005）：只读 stats store，采集在阅读页做。8 张卡片的计算口径见 spec 01 STAT-003。
import type { BookRecord } from '@/core/library';
import type { StatRecord } from '@/storage/db';

export interface StatCards {
  books: number;
  readBooks: number;
  hours: number;
  pages: number;
  hoursPerDay: number;
  secPerPage: number;
  pagesPerHour: number;
  wordsPerMinute: number;
  /** 一条统计都没有 */
  empty: boolean;
}

export function computeStatCards(books: Pick<BookRecord, 'onShelf' | 'progress'>[], stats: StatRecord[], positionCount: number): StatCards {
  const ms = stats.reduce((a, s) => a + s.usedMs, 0);
  const words = stats.reduce((a, s) => a + s.words, 0);
  const pages = stats.reduce((a, s) => a + (s.pages ?? 0), 0);
  const days = new Set<number>();
  for (const s of stats) for (const d of Object.keys(s.days)) days.add(Number(d));
  const hours = ms / 3_600_000;
  const minutes = ms / 60_000;
  return {
    books: books.filter((b) => b.onShelf !== false).length,
    readBooks: positionCount,
    hours,
    pages,
    hoursPerDay: hours / Math.max(1, days.size),
    secPerPage: pages > 0 ? ms / 1000 / pages : 0,
    pagesPerHour: pages / (hours || 0.1),
    wordsPerMinute: words / (minutes || 0.1),
    empty: stats.length === 0,
  };
}

/** 单本书的阅读速度（字/分钟） */
export function bookSpeed(s: Pick<StatRecord, 'usedMs' | 'words'> | undefined): number {
  return s && s.usedMs > 0 && s.words > 0 ? Math.round(s.words / (s.usedMs / 60_000)) : 0;
}

/** dayNumber（本地日期的 floor(本地毫秒/86400000)）→ yyyy-mm-dd */
export function dayToDate(day: number): string {
  const d = new Date(day * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** 最近阅读条目用的日期范围：首日 - 末日 */
export function dateRange(s: Pick<StatRecord, 'days'> | undefined): string {
  if (!s) return '';
  const ds = Object.keys(s.days).map(Number).sort((a, b) => a - b);
  if (!ds.length) return '';
  return ds.length === 1 ? dayToDate(ds[0]) : `${dayToDate(ds[0])} - ${dayToDate(ds[ds.length - 1])}`;
}
