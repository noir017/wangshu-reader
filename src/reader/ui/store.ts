// 阅读页界面状态（zustand）：菜单栏、面板、定位、自动滚屏状态等。设置类状态在 reader/settings.ts，不在这里。
import { create } from 'zustand';
import type { ReaderLocation } from '@/core/reader';
import type { ReaderSession } from '@/core/reader-session';

export type PanelId = 'font' | 'brightness' | 'brightness-mini' | null;

export interface ReaderUiState {
  session: ReaderSession | null;
  loc: ReaderLocation | null;
  /** 顶栏 + 底栏是否显示 */
  menu: boolean;
  /** 点底栏 ◀/▶ 换章时只收起顶栏（VIEW-003），再次呼出菜单时恢复 */
  hideTop: boolean;
  panel: PanelId;
  /** 自动滚屏：运行中 / 被点击暂停（暂停时引擎已停止，恢复时重新 start） */
  autoRunning: boolean;
  autoPaused: boolean;
  speedRead: boolean;
  /** 书籍是否仍在加载 */
  ready: boolean;
  setSession(s: ReaderSession | null): void;
  setLoc(l: ReaderLocation | null): void;
  setMenu(v: boolean): void;
  setHideTop(v: boolean): void;
  toggleMenu(): void;
  setPanel(p: PanelId): void;
  setAuto(p: { running?: boolean; paused?: boolean }): void;
  setSpeedRead(v: boolean): void;
}

export const useReaderUi = create<ReaderUiState>((set, get) => ({
  session: null,
  loc: null,
  menu: false,
  hideTop: false,
  panel: null,
  autoRunning: false,
  autoPaused: false,
  speedRead: false,
  ready: false,
  setSession: (session) => set({ session, ready: !!session }),
  setLoc: (loc) => set({ loc }),
  setMenu: (menu) => set((s) => (s.menu === menu ? s : { menu, hideTop: false, panel: menu ? null : s.panel })),
  setHideTop: (hideTop) => set({ hideTop }),
  toggleMenu: () => get().setMenu(!get().menu),
  // 面板（字号/亮度）打开时收起菜单栏；点击正文先关面板（同菜单栏的规则）
  setPanel: (panel) => set((s) => ({ panel, menu: panel ? false : s.menu })),
  setAuto: (p) => set((s) => ({ autoRunning: p.running ?? s.autoRunning, autoPaused: p.paused ?? s.autoPaused })),
  setSpeedRead: (speedRead) => set({ speedRead }),
}));

/** 重置（离开阅读页时） */
export function resetReaderUi(): void {
  useReaderUi.setState({ session: null, loc: null, menu: false, hideTop: false, panel: null, autoRunning: false, autoPaused: false, speedRead: false, ready: false });
}
