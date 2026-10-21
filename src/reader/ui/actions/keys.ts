// 键盘映射（CTRL-005）：KeyboardEvent → keyMap 的键名 → 动作。
import type { ReaderActionId } from '@/reader/settings';

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** 事件 → keyMap 的键名：Ctrl+f / Alt+x / PageDown / ' '（空格） */
export function keyName(e: KeyLike): string {
  let k = e.key;
  if (k === 'Spacebar') k = ' ';
  if (e.ctrlKey || e.metaKey) return `Ctrl+${k.length === 1 ? k.toLowerCase() : k}`;
  if (e.altKey) return `Alt+${k.length === 1 ? k.toLowerCase() : k}`;
  return k;
}

/** 查映射；Shift+空格 = 与 PageUp 相同（浏览器惯例）。没有绑定返回 undefined */
export function keyAction(keyMap: Record<string, ReaderActionId>, e: KeyLike): ReaderActionId | undefined {
  const name = keyName(e);
  if (name in keyMap) return keyMap[name];
  if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === ' ' && 'PageUp' in keyMap) return keyMap.PageUp;
    if (e.key.length > 1 && `Shift+${e.key}` in keyMap) return keyMap[`Shift+${e.key}`];
  }
  return undefined;
}

/** 输入控件里的按键不处理 */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
