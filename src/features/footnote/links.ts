// 链接分类与「链接返回」所需的纯逻辑。
export type LinkKind = 'web' | 'mailto' | 'tel' | 'other';

export function classifyHref(href: string): LinkKind {
  const h = href.trim();
  if (/^https?:\/\//i.test(h)) return 'web';
  if (/^mailto:/i.test(h)) return 'mailto';
  if (/^tel:/i.test(h)) return 'tel';
  return 'other';
}

/** 外链确认框里显示/打开的地址；不放行 javascript:、data: 等 */
export function openableHref(href: string): string | null {
  return classifyHref(href) === 'other' ? null : href.trim();
}

/**
 * 判定内部链接跳转前该取哪个位置压栈。
 * 引擎可能先跳转再派发 link 事件：如果 relocate 刚刚（graceMs 内）发生过，说明当前位置已经是目标，要用跳转之前的那个。
 */
export function pickBackLocation<T>(prev: T | undefined, cur: T | undefined, curAt: number, now: number, graceMs = 120): T | undefined {
  return cur !== undefined && now - curAt < graceMs && prev !== undefined ? prev : (cur ?? prev);
}
