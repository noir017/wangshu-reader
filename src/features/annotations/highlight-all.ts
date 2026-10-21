// 「高亮显示本书所有的“xxx”」（ANNO-004）：按词存样式，渲染时全书匹配处都套用。
import { create } from 'zustand';
import type { HighlightStyle } from '@/core/library';
import type { Decoration } from '@/core/reader';
import { getKV, setKV } from '@/storage/db';

export interface HlAllItem {
  text: string;
  style: HighlightStyle;
  color: string;
}

const key = (bookId: string) => `features.hlAll.${bookId}`;
const MAX_PER_SECTION = 2000;

export const useHlAll = create<{ bookId: string | null; items: HlAllItem[] }>(() => ({ bookId: null, items: [] }));

export async function loadHlAll(bookId: string): Promise<void> {
  const items = (await getKV<HlAllItem[]>(key(bookId))) ?? [];
  useHlAll.setState({ bookId, items });
}

async function save(bookId: string, items: HlAllItem[]): Promise<void> {
  useHlAll.setState({ bookId, items });
  await setKV(key(bookId), items);
}

export async function upsertHlAll(bookId: string, item: HlAllItem): Promise<void> {
  const cur = useHlAll.getState().items.filter((i) => i.text !== item.text);
  await save(bookId, [...cur, item]);
}

export async function removeHlAllByText(bookId: string, text: string): Promise<void> {
  const cur = useHlAll.getState().items;
  if (cur.some((i) => i.text === text)) await save(bookId, cur.filter((i) => i.text !== text));
}

/** 文本里所有（不重叠）出现位置 */
export function findAll(text: string, needle: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  if (!needle) return out;
  for (let i = text.indexOf(needle); i !== -1 && out.length < MAX_PER_SECTION; i = text.indexOf(needle, i + needle.length)) {
    out.push({ start: i, end: i + needle.length });
  }
  return out;
}

export const HLALL_PREFIX = 'hlall:';

export function hlAllDecorations(section: number, text: string, items: HlAllItem[]): Decoration[] {
  const out: Decoration[] = [];
  items.forEach((it, idx) => {
    for (const m of findAll(text, it.text)) {
      out.push({ id: `${HLALL_PREFIX}${idx}:${m.start}`, range: { section, start: m.start, end: m.end }, style: it.style, color: it.color });
    }
  });
  return out;
}
