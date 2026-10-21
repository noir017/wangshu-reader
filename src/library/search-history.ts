// 各标签页的搜索历史（LIB-010）：只在提交时记录，每个作用域最多 50 条
import { useEffect, useState } from 'react';
import { dbEvents, getKV, setKV } from '@/storage/db';

const key = (scope: string) => `library.search.${scope}`;

export async function getSearchHistory(scope: string): Promise<string[]> {
  return (await getKV<string[]>(key(scope))) ?? [];
}

export async function saveSearchKey(scope: string, q: string): Promise<void> {
  const k = q.trim();
  if (!k) return;
  const list = (await getSearchHistory(scope)).filter((x) => x !== k);
  list.unshift(k);
  await setKV(key(scope), list.slice(0, 50));
}

export async function clearSearchHistory(scope: string): Promise<void> {
  await setKV(key(scope), []);
}

export function useSearchHistory(scope: string): string[] {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void getSearchHistory(scope).then((l) => live && setList(l));
    load();
    const off = dbEvents.on('change', (e) => e.store === 'kv' && e.key === key(scope) && load());
    return () => {
      live = false;
      off();
    };
  }, [scope]);
  return list;
}
