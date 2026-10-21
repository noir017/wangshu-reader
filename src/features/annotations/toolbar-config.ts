// 选择条配置（ANNO-002）：11 个内置按钮的顺序与勾选。原 app 存在 xml_files_folder/select_bar，这里存设置。
import { defineSettings } from '@/core/settings';

export const SELECT_ITEMS = ['copy', 'highlight', 'note', 'dict', 'speak', 'share', 'search', 'translate', 'wiki', 'websearch', 'history'] as const;
export type SelectItemId = (typeof SELECT_ITEMS)[number];

export interface BarItem {
  id: SelectItemId;
  on: boolean;
}

/** 出厂顺序与勾选：拷贝/高亮/标注/词典/朗读/分享/搜索 ✔，翻译/维基/网络搜索/生词本 ✘ */
export const DEFAULT_BAR: BarItem[] = SELECT_ITEMS.map((id, i) => ({ id, on: i <= 6 }));

/** 工具条上常驻的主按钮个数；这些位置在设置里强制勾选 */
export const MAIN_SLOTS = 4;

/** 容错：补齐缺项、去重、忽略未知项，前 MAIN_SLOTS 个强制勾选 */
export function normalizeBar(raw: unknown): BarItem[] {
  const seen = new Set<SelectItemId>();
  const out: BarItem[] = [];
  if (Array.isArray(raw)) {
    for (const it of raw) {
      const id = (it as BarItem)?.id;
      if (SELECT_ITEMS.includes(id) && !seen.has(id)) {
        seen.add(id);
        out.push({ id, on: !!(it as BarItem).on });
      }
    }
  }
  for (const d of DEFAULT_BAR) if (!seen.has(d.id)) out.push({ ...d });
  for (let i = 0; i < Math.min(MAIN_SLOTS, out.length); i++) out[i].on = true;
  return out;
}

export function splitBar(items: BarItem[]): { main: SelectItemId[]; more: SelectItemId[] } {
  const norm = normalizeBar(items);
  const enabled = norm.filter((i) => i.on).map((i) => i.id);
  return { main: enabled.slice(0, MAIN_SLOTS), more: enabled.slice(MAIN_SLOTS) };
}

export const selectBarSettings = defineSettings('features.selectbar', {
  items: DEFAULT_BAR as BarItem[],
});

export function moveItem(items: BarItem[], from: number, to: number): BarItem[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const out = [...items];
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return normalizeBar(out);
}

export function toggleItem(items: BarItem[], index: number): BarItem[] {
  if (index < MAIN_SLOTS) return items;
  return normalizeBar(items.map((it, i) => (i === index ? { ...it, on: !it.on } : it)));
}
