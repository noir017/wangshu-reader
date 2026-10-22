// 阅读会话的持久化与统计：防抖保存进度（savePosition）、阅读时长/字数（STAT-001）、历史记录。
import { useEffect } from 'react';
import type { ReaderLocation } from '@/core/reader';
import type { ReaderSession } from '@/core/reader-session';
import { addReadingTime, dbEvents, savePosition, touchHistory } from '@/storage/db';
import { screenSettings } from '@/reader/settings';
import { ReadingTracker, countWords } from '../services/reading-time';
import { shouldRemind1, shouldRemind2, localDayNo } from '../services/system';
import { uiSettings } from '../ui-settings';
import { openRemindDialog } from '../settings/RemindDialog';
import { useReaderUi } from '../store';
import { t } from '../messages';

const SAVE_DEBOUNCE_MS = 800;

/**
 * 进度保存：relocate 后去抖落盘；切后台/退出时立即落盘。
 * 云同步（别的模块）可能在阅读期间改写这本书的进度、随后让阅读页重开：那次写入不是我们写的，
 * 之后离开页面时不能再用当前位置把它盖回去——直到用户再次翻页为止。
 */
export function usePositionSaving(session: ReaderSession | null): void {
  useEffect(() => {
    if (!session) return;
    const { controller, bookId } = session;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: ReaderLocation | null = null;
    let own = 0; // 正在进行的自己的写入数（它们触发的 change 事件不算外部改动）
    let external = false;
    void touchHistory(bookId);

    const write = () => {
      clearTimeout(timer);
      timer = undefined;
      const loc = pending;
      pending = null;
      if (!loc || external) return;
      uiSettings.set({ lastReadTime: Date.now() });
      own++;
      void savePosition({ bookId, locator: loc.locator, progress: loc.atEnd ? 1 : loc.progress })
        .catch((e) => console.warn('[reader] savePosition', e))
        .finally(() => own--);
    };
    const off = controller.on('relocate', (loc) => {
      external = false; // 用户又翻页了：以当前位置为准
      pending = loc;
      clearTimeout(timer);
      timer = setTimeout(write, SAVE_DEBOUNCE_MS);
    });
    const offDb = dbEvents.on('change', (e) => {
      if (e.store === 'positions' && e.bookId === bookId && own === 0) {
        external = true;
        pending = null;
        clearTimeout(timer);
      }
    });
    const onHide = () => {
      if (external) return;
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
      offDb();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      onHide();
    };
  }, [session]);
}

/** 前进翻页（而不是拖进度条/目录跳转）：同章内页码前进，或进到相邻章；固定版式一次翻 1–2 页（双页） */
export function advancedByTurning(prev: ReaderLocation, loc: ReaderLocation): boolean {
  if (loc.section === prev.section) return loc.page > prev.page || loc.locator.offset > prev.locator.offset;
  return loc.section - prev.section >= 1 && loc.section - prev.section <= 2;
}

/** 阅读时长与字数采集 + 健康提醒（连续阅读 / 固定时间） */
export function useReadingStats(session: ReaderSession | null): { touch(): void } | null {
  const trackerRef = { current: null as ReadingTracker | null };
  useEffect(() => {
    if (!session) return;
    const { controller, bookId } = session;
    const tracker = new ReadingTracker({ save: (ms, words, pages) => addReadingTime(bookId, ms, words, Date.now(), pages) });
    trackerRef.current = tracker;
    let prev: ReaderLocation | null = null;
    let remind2Day = uiSettings.get().remind2LastDay;
    let reminding = false;

    const offRel = controller.on('relocate', (loc) => {
      tracker.touch();
      // 仅前进翻页计字数和页数：位置前进，且不是拖进度条/跳转式的大跨度（章差 ≤ 1，固定版式即页差 ≤ 2）
      if (prev && loc.progress > prev.progress && advancedByTurning(prev, loc)) {
        tracker.addPages(1);
        if (loc.visible.section === loc.section) {
          const range = loc.visible;
          void controller.getSectionText(range.section).then((text) => tracker.addWords(countWords(text.slice(range.start, range.end))));
        }
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
