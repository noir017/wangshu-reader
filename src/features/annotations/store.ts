// 当前书的标注列表（zustand）。阅读页挂载时由 AnnotationSync 装载并监听 dbEvents；各面板直接订阅。
import { create } from 'zustand';
import type { AnnotationRecord } from '@/core/library';
import { dbEvents, listAnnotations } from '@/storage/db';

interface State {
  bookId: string | null;
  items: AnnotationRecord[];
  ready: boolean;
}

export const useAnnotations = create<State>(() => ({ bookId: null, items: [], ready: false }));

async function reload(bookId: string): Promise<void> {
  const items = await listAnnotations(bookId);
  // 切书途中到达的旧结果丢弃
  if (useAnnotations.getState().bookId === bookId) useAnnotations.setState({ items, ready: true });
}

/** 开始同步指定书的标注，返回停止函数 */
export function startAnnotationSync(bookId: string): () => void {
  useAnnotations.setState({ bookId, items: [], ready: false });
  void reload(bookId);
  const off = dbEvents.on('change', (e) => {
    if (e.store === 'annotations' && (!e.bookId || e.bookId === bookId)) void reload(bookId);
  });
  return () => {
    off();
    if (useAnnotations.getState().bookId === bookId) useAnnotations.setState({ bookId: null, items: [], ready: false });
  };
}

export function currentAnnotations(): AnnotationRecord[] {
  return useAnnotations.getState().items;
}

export function findAnnotation(id: string): AnnotationRecord | undefined {
  return useAnnotations.getState().items.find((a) => a.id === id);
}
