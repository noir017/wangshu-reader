// 搜索执行与状态（SRCH-001/002）：逐章搜索、结果边出边显示、跳转与全文高亮、导航面板状态。
import { create } from 'zustand';
import { currentLang } from '@/core/i18n';
import type { Locator } from '@/core/book';
import type { Decoration } from '@/core/reader';
import type { ReaderSession } from '@/core/reader-session';
import { isCjkText, isTabletViewport } from '../common/format';
import { clearLinkBack, linkBackTitle, popLinkBack, pushLinkBack } from '../common/linkback';
import { getSectionText, sectionCount } from '../common/section-text';
import { progressFn } from '../toc/toc-utils';
import { buildRegExp, findMatches, makeSnippet, MAX_RESULTS, snippetRadius } from './engine';
import { addSearchHistory } from './history';
import { ts } from './messages';
import { searchSettings } from './settings';

export interface SearchResultItem {
  section: number;
  start: number;
  end: number;
  pre: string;
  hit: string;
  post: string;
  /** 0..1 */
  progress: number;
}

interface SearchState {
  /** 搜索对话框是否打开 */
  open: boolean;
  /** 导航面板（上一个/下一个）是否显示 */
  panel: boolean;
  query: string;
  results: SearchResultItem[];
  running: boolean;
  progress: [number, number];
  error: string | null;
  capped: boolean;
  /** 当前结果下标，-1 = 尚未跳转 */
  current: number;
  /** 这次搜索起点位置（返回按钮用，也压在链接返回栈里） */
  searched: boolean;
}

export const useSearch = create<SearchState>(() => ({
  open: false,
  panel: false,
  query: '',
  results: [],
  running: false,
  progress: [0, 1],
  error: null,
  capped: false,
  current: -1,
  searched: false,
}));

const set = useSearch.setState;
let abort: AbortController | undefined;

export function openSearchDialog(query?: string): void {
  set({ open: true, ...(query !== undefined ? { query } : {}) });
}

export function closeSearchDialog(): void {
  set({ open: false });
}

export function cancelSearch(): void {
  abort?.abort();
  abort = undefined;
  set({ running: false });
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

function isAsian(session: ReaderSession, sample: string): boolean {
  const l = (session.book.metadata.language ?? '').toLowerCase();
  if (/^(zh|ja|ko)/.test(l)) return true;
  if (l) return false;
  return currentLang() === 'zh' || isCjkText(sample);
}

/** 开始搜索。关键词语法错误时设 error 不抛出 */
export async function startSearch(session: ReaderSession, key: string): Promise<void> {
  const k = key.trim();
  if (!k) return;
  cancelSearch();
  const o = searchSettings.get();
  let re: RegExp;
  try {
    re = buildRegExp(k, o);
  } catch (e) {
    set({ error: ts('badRegex', { msg: (e as Error).message.replace(/^Invalid regular expression: /, '') }), results: [], running: false });
    return;
  }
  const ac = new AbortController();
  abort = ac;
  set({ query: k, results: [], running: true, error: null, capped: false, current: -1, progress: [0, 1], panel: false, searched: true });
  clearSearchHighlight(session);
  searchSettings.set({ lastKey: k });
  void addSearchHistory(k);

  const { controller, book } = session;
  const total = sectionCount(controller);
  const loc = controller.getLocation();
  const here = loc?.locator ?? { section: 0, offset: 0 };
  // 向后 = 只搜已读（当前位置之前），向前 = 只搜未读（当前位置之后）
  const first = o.forwardOnly ? here.section : 0;
  const last = o.backwardOnly ? here.section : total - 1;
  const prog = progressFn(book);
  const tablet = isTabletViewport();
  let asian: boolean | undefined;
  let found = 0;

  for (let s = first; s <= last; s++) {
    if (ac.signal.aborted) return;
    let text: string;
    try {
      text = await getSectionText(controller, s);
    } catch {
      continue;
    }
    if (ac.signal.aborted) return;
    asian ??= isAsian(session, text.slice(0, 200));
    const pl = snippetRadius(asian, tablet);
    const batch: SearchResultItem[] = [];
    for (const m of findMatches(text, re, MAX_RESULTS - found)) {
      if (s === here.section && o.backwardOnly && m.start >= here.offset) continue;
      if (s === here.section && o.forwardOnly && m.start < here.offset) continue;
      const sn = makeSnippet(text, m.start, m.end, pl);
      batch.push({ section: s, start: m.start, end: m.end, ...sn, progress: prog(s, m.start) });
    }
    found += batch.length;
    set((st) => ({ results: batch.length ? [...st.results, ...batch] : st.results, progress: [s - first + 1, last - first + 1] }));
    if (found >= MAX_RESULTS) {
      set({ capped: true });
      break;
    }
    await yieldToUi();
  }
  if (abort === ac) {
    abort = undefined;
    set({ running: false });
  }
}

// ───────────── 跳转、高亮、导航 ─────────────

const COLOR_ALL = '#ffd54f88';
const COLOR_CUR = '#ff7043aa';

function decorationsFor(results: SearchResultItem[], current: number): Decoration[] {
  return results.map((r, i) => ({
    id: `s${i}`,
    range: { section: r.section, start: r.start, end: r.end },
    style: 'search',
    color: i === current ? COLOR_CUR : COLOR_ALL,
  }));
}

export function clearSearchHighlight(session: ReaderSession): void {
  session.controller.setDecorations('search', []);
}

function refreshHighlight(session: ReaderSession): void {
  const { results, current, panel } = useSearch.getState();
  session.controller.setDecorations('search', panel ? decorationsFor(results, current) : []);
}

/** 跳到第 i 个结果。从对话框第一次跳转时先清空链接返回栈并压入搜索前的位置 */
export async function gotoResult(session: ReaderSession, i: number): Promise<void> {
  const st = useSearch.getState();
  const r = st.results[i];
  if (!r) return;
  if (!st.panel) {
    const loc = session.controller.getLocation();
    clearLinkBack();
    if (loc) {
      const text = await getSectionText(session.controller, loc.locator.section).catch(() => '');
      pushLinkBack({ locator: loc.locator, title: linkBackTitle(loc.progress, text.slice(loc.locator.offset, loc.locator.offset + 40), currentLang() === 'zh') });
    }
  }
  set({ current: i, panel: st.results.length > 1 || st.panel });
  refreshHighlight(session);
  await session.controller.goTo({ range: { section: r.section, start: r.start, end: r.end }, flash: true });
}

export function stepResult(session: ReaderSession, dir: 1 | -1): void {
  const { results, current } = useSearch.getState();
  if (!results.length) return;
  const next = current < 0 ? (dir === 1 ? 0 : results.length - 1) : (current + dir + results.length) % results.length;
  void gotoResult(session, next);
}

export function closeNavPanel(session: ReaderSession): void {
  set({ panel: false, current: -1 });
  clearSearchHighlight(session);
}

/** 导航面板的「返回」：回到搜索前的位置 */
export async function backToBeforeSearch(session: ReaderSession): Promise<void> {
  const e = popLinkBack();
  if (e) await session.controller.goTo(e.locator as Locator);
}
