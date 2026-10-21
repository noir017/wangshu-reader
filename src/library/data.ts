// 书库数据的 React 订阅：书、最近阅读历史。多个组件共用一个 store，只在有组件挂载时监听数据库变化。
import { useEffect } from 'react';
import { create } from 'zustand';
import type { BookRecord } from '@/core/library';
import { dbEvents, getHistory, listBooks } from '@/storage/db';
import type { HistoryItem } from './shelf-model';

interface LibState {
  books: BookRecord[];
  byId: Map<string, BookRecord>;
  history: HistoryItem[];
  loaded: boolean;
}

export const useLibraryStore = create<LibState>(() => ({ books: [], byId: new Map(), history: [], loaded: false }));

let seq = 0;
export async function reloadLibrary(): Promise<void> {
  const my = ++seq;
  const [books, history] = await Promise.all([listBooks(), getHistory()]);
  if (my !== seq) return; // 更晚的一次加载已发起
  useLibraryStore.setState({ books, byId: new Map(books.map((b) => [b.id, b])), history, loaded: true });
}

let watchers = 0;
let off: (() => void) | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function attach() {
  off = dbEvents.on('change', (e) => {
    if (e.store === 'books' || e.store === 'kv' || e.store === 'positions') {
      clearTimeout(timer);
      timer = setTimeout(() => void reloadLibrary(), 60);
    }
  });
}

/** 订阅书库。返回全部书（含 onShelf=false 的临时书）与历史 */
export function useLibrary(): LibState {
  useEffect(() => {
    if (watchers++ === 0) attach();
    void reloadLibrary();
    return () => {
      if (--watchers === 0) {
        off?.();
        off = undefined;
      }
    };
  }, []);
  return useLibraryStore();
}

/** 最近阅读：历史顺序，只保留还存在的书 */
export function recentBooks(s: Pick<LibState, 'byId' | 'history'>): BookRecord[] {
  const out: BookRecord[] = [];
  for (const h of s.history) {
    const b = s.byId.get(h.bookId);
    if (b) out.push(b);
  }
  return out;
}
