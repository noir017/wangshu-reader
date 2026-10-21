// 阅读会话的持久化与统计：防抖保存进度（savePosition）、阅读时长/字数（STAT-001）、历史记录。
import { useEffect } from 'react';
import type { ReaderLocation } from '@/core/reader';
import type { ReaderSession } from '@/core/reader-session';
import { addReadingTime, savePosition, touchHistory } from '@/storage/db';
import { screenSettings } from '@/reader/settings';
import { ReadingTracker, countWords } from '../services/reading-time';
import { shouldRemind1, shouldRemind2, localDayNo } from '../services/system';
import { uiSettings } from '../ui-settings';
import { openRemindDialog } from '../settings/RemindDialog';
import { useReaderUi } from '../store';
import { t } from '../messages';

const SAVE_DEBOUNCE_MS = 800;

/** 进度保存：relocate 后去抖落盘；切后台/退出时立即落盘 */
export function usePositionSaving(session: ReaderSession | null): void {
  useEffect(() => {
    if (!session) return;
    const { controller, bookId } = session;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: ReaderLocation | null = null;
    void touchHistory(bookId);

    const write = () => {
      clearTimeout(timer);
      timer = undefined;
      const loc = pending;
      pending = null;
      if (!loc) return;
      uiSettings.set({ lastReadTime: Date.now() });
      void savePosition({ bookId, locator: loc.locator, progress: loc.atEnd ? 1 : loc.progress });
    };
    const off = controller.on('relocate', (loc) => {
      pending = loc;
      clearTimeout(timer);
      timer = setTimeout(write, SAVE_DEBOUNCE_MS);
    });
    const onHide = () => {
      // 以引擎当前位置为准，防止 pending 为空时丢失最后一次翻页
      const cur = controller.getLocation();
      if (cur) pending = cur;
      write();
    };
    const onVis = () => document.visibilityState === 'hidden' && onHide();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      onHide();
    };
  }, [session]);
}

/** 阅读时长与字数采集 + 健康提醒（连续阅读 / 固定时间） */
export function useReadingStats(session: ReaderSession | null): { touch(): void } | null {
  const trackerRef = { current: null as ReadingTracker | null };
  useEffect(() => {
    if (!session) return;
    const { controller, bookId } = session;
    const tracker = new ReadingTracker({ save: (ms, words) => addReadingTime(bookId, ms, words) });
    trackerRef.current = tracker;
    let prev: ReaderLocation | null = null;
    let remind2Day = uiSettings.get().remind2LastDay;
    let reminding = false;

    const offRel = controller.on('relocate', (loc) => {
      tracker.touch();
      // 仅前进翻页计字数：位置前进且只翻了不到几页
      if (prev && loc.progress > prev.progress && loc.visible.section === loc.section) {
        const range = loc.visible;
        void controller.getSectionText(range.section).then((text) => tracker.addWords(countWords(text.slice(range.start, range.end))));
      }
      prev = loc;
    });
    const onActive = () => tracker.touch();
    window.addEventListener('pointerdown', onActive, { passive: true });
    window.addEventListener('keydown', onActive);

    const interval = setInterval(() => {
      const ui = useReaderUi.getState();
      tracker.setExempt(ui.autoRunning || ui.speedRead);
      tracker.tick();
    }, 1000);

    // 健康提醒每 30 秒检查一次；自动滚屏/朗读中不计时由 tracker 的 exempt 保证
    const remindTimer = setInterval(() => {
      if (reminding) return;
      const sc = screenSettings.get();
      const now = new Date();
      let text = '';
      if (sc.remind1 && shouldRemind1(tracker.sessionMs, sc.remind1Time)) {
        text = t('remind1text');
        tracker.resetSession();
      } else if (sc.remind2 && shouldRemind2(now, sc.remind2TimeHour, sc.remind2TimeMinute, remind2Day)) {
        text = t('remind2text');
        remind2Day = localDayNo(now);
        uiSettings.set({ remind2LastDay: remind2Day });
      }
      if (!text) return;
      reminding = true;
      openRemindDialog(text, () => {
        reminding = false;
      });
    }, 30_000);

    const onHide = () => tracker.flush();
    const onVis = () => document.visibilityState === 'hidden' && onHide();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    return () => {
      offRel();
      clearInterval(interval);
      clearInterval(remindTimer);
      window.removeEventListener('pointerdown', onActive);
      window.removeEventListener('keydown', onActive);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      tracker.flush();
      trackerRef.current = null;
    };
  }, [session]);
  return null;
}
