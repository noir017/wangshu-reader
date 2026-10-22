// 链接返回栈（TOC-005）：内部链接、目录/搜索跳转前压入当前位置，「返回」弹出并回到那里。
import { create } from 'zustand';
import type { Locator } from '@/core/book';
import { currentLang } from '@/core/i18n';
import type { ReaderController } from '@/core/reader';
import { peekLocation } from './safe';
import { getSectionText } from './section-text';

export interface LinkBackEntry {
  locator: Locator;
  /** 菜单里显示："(进度%) 当前行前 N 个字符..." */
  title: string;
}

interface State {
  stack: LinkBackEntry[];
}

export const useLinkBack = create<State>(() => ({ stack: [] }));

const MAX = 50;

/** 压栈；与栈顶位置相同则不重复压（原 app 去重） */
export function pushLinkBack(entry: LinkBackEntry): void {
  useLinkBack.setState((s) => {
    const top = s.stack[s.stack.length - 1];
    if (top && top.locator.section === entry.locator.section && top.locator.offset === entry.locator.offset) return s;
    return { stack: [...s.stack, entry].slice(-MAX) };
  });
}

/** 弹出栈顶 */
export function popLinkBack(): LinkBackEntry | undefined {
  const { stack } = useLinkBack.getState();
  const top = stack[stack.length - 1];
  if (top) useLinkBack.setState({ stack: stack.slice(0, -1) });
  return top;
}

/** 回到栈中第 i 条（i 从栈顶数起 0 = 栈顶）：其上的记录一并丢弃 */
export function popLinkBackTo(i: number): LinkBackEntry | undefined {
  const { stack } = useLinkBack.getState();
  const idx = stack.length - 1 - i;
  const target = stack[idx];
  if (target) useLinkBack.setState({ stack: stack.slice(0, idx) });
  return target;
}

export function clearLinkBack(): void {
  useLinkBack.setState({ stack: [] });
}

/** 标题：(12.3%) 开头若干字符... */
export function linkBackTitle(progress: number | undefined, text: string, cjk: boolean): string {
  const n = cjk ? 15 : 20;
  const head = text.replace(/[\n\r\t　]+/g, ' ').trim().slice(0, n);
  const pct = progress === undefined ? '' : `(${(progress * 100).toFixed(1)}%) `;
  return `${pct}${head}...`;
}

/**
 * 把引擎当前位置压栈（reader/ui 在拖进度条、换章、跳百分比等「跳走」之前调用）。
 * 位置同步取，标题先用章节名顶上，随后异步换成「(进度) 当前行前若干字...」
 */
export function pushLinkBackHere(controller: ReaderController): void {
  const loc = peekLocation(controller);
  if (!loc) return;
  const cjk = currentLang() === 'zh';
  pushLinkBack({ locator: loc.locator, title: linkBackTitle(loc.progress, loc.sectionTitle ?? '', cjk) });
  void getSectionText(controller, loc.locator.section)
    .then((text) => {
      const title = linkBackTitle(loc.progress, text.slice(loc.locator.offset, loc.locator.offset + 40), cjk);
      useLinkBack.setState((s) => ({ stack: s.stack.map((e) => (e.locator === loc.locator ? { ...e, title } : e)) }));
    })
    .catch(() => {});
}
