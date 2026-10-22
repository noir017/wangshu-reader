// 对当前阅读会话的操作封装：翻页、换章、跳转、链接返回。动作分发器、底栏、面板共用。
import type { Locator } from '@/core/book';
import { pushLinkBackHere } from '@/features';
import { fixedSettings } from '@/reader/settings';
import { toast } from '@/ui';
import { t } from './messages';
import { useReaderUi } from './store';

export const getSession = () => useReaderUi.getState().session;

export function currentLocator(): Locator | null {
  return useReaderUi.getState().loc?.locator ?? getSession()?.controller.getLocation()?.locator ?? null;
}

/** 记录当前位置供「↩」回退（拖进度条、换章、跳转前调用）。回退栈只有一份，由 features 维护 */
export function saveLinkBack(): void {
  const s = getSession();
  if (s) pushLinkBackHere(s.controller);
}

/** 「↩」：让 features 弹出栈顶并跳回去 */
export function goLinkBack(): void {
  getSession()?.bus.emit('linkback.back', {});
}

/**
 * 右到左漫画（日漫）：点击区与方向键的左右要反过来（点左边 = 下一页）。
 * 判据与引擎一致：漫画格式 && (用户设置 comicRtl || 书里声明 direction=rtl)；翻页/滑动的方向本身由引擎处理
 */
export function isRtlComic(): boolean {
  const book = getSession()?.book;
  if (!book || book.kind !== 'fixed' || !['cbz', 'cbr', 'cb7'].includes(book.format)) return false;
  return fixedSettings.get().comicRtl || book.metadata?.direction === 'rtl';
}

export async function pageNext(): Promise<void> {
  await getSession()?.controller.next();
}
export async function pagePrev(): Promise<void> {
  await getSession()?.controller.prev();
}

/** 章总数（固定版式为页数） */
export function sectionCount(): number {
  const s = getSession();
  if (!s) return 0;
  return s.book.kind === 'fixed' ? s.book.pageCount : s.book.sections.length;
}

/** 上一章/下一章；到头时提示（do_prior_chapter / do_next_chapter） */
export async function stepChapter(dir: 1 | -1): Promise<boolean> {
  const s = getSession();
  const loc = useReaderUi.getState().loc ?? s?.controller.getLocation();
  if (!s || !loc) return false;
  const last = sectionCount() - 1;
  if (dir === 1 && loc.section >= last) {
    toast(t('no_next_chapter'));
    return false;
  }
  if (dir === -1 && loc.section <= 0 && loc.locator.offset <= 0) {
    toast(t('no_prior_chapter'));
    return false;
  }
  saveLinkBack();
  if (dir === 1) await s.controller.nextSection();
  else await s.controller.prevSection();
  return true;
}

export async function goToProgress(progress: number): Promise<void> {
  const s = getSession();
  if (!s) return;
  await s.controller.goTo({ progress: Math.max(0, Math.min(1, progress)) });
}

/** 进度 0..1 → 百分比文字：两位小数，读完显示 100%（T.getPercentStr2） */
export function percentText(progress: number, atEnd: boolean): string {
  if (atEnd) return '100%';
  return `${(Math.max(0, Math.min(1, progress)) * 100).toFixed(2)}%`;
}

/** 解析用户输入的百分比（可带 %，0–100），非法返回 null */
export function parsePercentInput(raw: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(raw.replace('％', '%'));
  if (!m) return null;
  const v = Number(m[1]);
  return v >= 0 && v <= 100 ? v / 100 : null;
}
