// 搜索历史（SRCH-003）。
import { getKV, setKV } from '@/storage/db';

const KEY = 'features.searchHistory';
const MAX = 50;

export async function getSearchHistory(): Promise<string[]> {
  return (await getKV<string[]>(KEY)) ?? [];
}

export function mergeSearchHistory(list: string[], key: string, max = MAX): string[] {
  const k = key.trim();
  if (!k) return list;
  return [k, ...list.filter((x) => x !== k)].slice(0, max);
}

export async function addSearchHistory(key: string): Promise<void> {
  await setKV(KEY, mergeSearchHistory(await getSearchHistory(), key));
}

export async function clearSearchHistory(): Promise<void> {
  await setKV(KEY, []);
}
