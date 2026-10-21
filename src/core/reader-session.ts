// 阅读会话：阅读页（reader/ui）创建，向各功能模块（features）提供当前书、引擎与命令总线。
// 点击区/按键/工具栏按钮触发的动作由 reader/ui 的动作分发器处理；属于 features 的动作经 bus 发出，由 features 订阅执行。
import { createContext, useContext } from 'react';
import type { Book, Locator, TextRange } from './book';
import type { BookRecord } from './library';
import type { ReaderController } from './reader';
import type { Emitter } from './emitter';

export interface ReaderCommands {
  [k: string]: unknown;
  /** 打开目录面板（目录/书签/笔记/高亮 标签页，TOC-*） */
  'toc.open': { tab?: 'toc' | 'bookmarks' | 'notes' | 'highlights' };
  /** 在当前位置加书签（doEvent2(5)） */
  'bookmark.add': { at?: Locator };
  /** 打开书签列表（动作 5） */
  'bookmarks.open': Record<string, never>;
  /** 书内搜索（动作 4） */
  'search.open': { query?: string };
  /** 朗读：开始/暂停切换（动作 19） */
  'tts.toggle': { from?: Locator };
  'tts.stop': Record<string, never>;
  /** 朗读菜单（工具栏朗读按钮长按）；x,y 为菜单锚点的视口坐标 */
  'tts.menu': { x?: number; y?: number };
  /** 进入文字选择（动作 17：在 x,y 处选词；不给坐标则选当前页首段） */
  'selection.start': { x?: number; y?: number };
  /** 查词 / 翻译 */
  'dict.lookup': { text: string; range?: TextRange };
  'translate.open': { text: string };
  /** 打开看图器 */
  'image.open': { src: string };
  /** 显示脚注弹窗 */
  'footnote.open': { html: string; rect?: DOMRect };
  /** 链接回退：弹出回退栈栈顶并跳回去（返回键/动作）。回退栈只由 features 维护，reader/ui 只发这个命令 */
  'linkback.back': Record<string, never>;
  /** 阅读器菜单栏显示/隐藏（features 打开面板前可以要求收起菜单） */
  'menu.hide': Record<string, never>;
}

export interface ReaderSession {
  bookId: string;
  record: BookRecord;
  book: Book;
  controller: ReaderController;
  bus: Emitter<ReaderCommands>;
}

export const ReaderSessionContext = createContext<ReaderSession | null>(null);

export function useReaderSession(): ReaderSession {
  const s = useContext(ReaderSessionContext);
  if (!s) throw new Error('useReaderSession 必须在阅读页内使用');
  return s;
}
