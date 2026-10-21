// 词典历史 / 生词本（DICT-006）：原版只存词，web 额外存时间、书名、上下文，可导出 CSV。
import { getKV, setKV } from '@/storage/db';

export interface DictHistoryItem {
  word: string;
  /** 最近查询时间 */
  at: number;
  count: number;
  book?: string;
  context?: string;
}

const KEY = 'features.dictHistory';
const MAX = 1000;

export async function getDictHistory(): Promise<DictHistoryItem[]> {
  return (await getKV<DictHistoryItem[]>(KEY)) ?? [];
}

/** 同词合并（计数 +1、移到最前），超过上限丢最旧的 */
export function mergeHistory(list: DictHistoryItem[], item: Omit<DictHistoryItem, 'count'>, max = MAX): DictHistoryItem[] {
  const old = list.find((h) => h.word === item.word);
  const rest = list.filter((h) => h.word !== item.word);
  const next: DictHistoryItem = { ...old, ...item, count: (old?.count ?? 0) + 1, context: item.context ?? old?.context, book: item.book ?? old?.book };
  return [next, ...rest].slice(0, max);
}

export async function addDictHistory(item: Omit<DictHistoryItem, 'count' | 'at'> & { at?: number }): Promise<void> {
  const list = await getDictHistory();
  await setKV(KEY, mergeHistory(list, { ...item, at: item.at ?? Date.now() }));
}

export async function removeDictHistory(word: string): Promise<void> {
  await setKV(KEY, (await getDictHistory()).filter((h) => h.word !== word));
}

export async function clearDictHistory(): Promise<void> {
  await setKV(KEY, []);
}

function csvCell(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 导出 CSV（可导入 Anki）：单词、次数、时间、书名、上下文 */
export function historyToCsv(list: DictHistoryItem[]): string {
  const rows = [['word', 'count', 'time', 'book', 'context'], ...list.map((h) => [h.word, String(h.count), new Date(h.at).toISOString(), h.book ?? '', h.context ?? ''])];
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
