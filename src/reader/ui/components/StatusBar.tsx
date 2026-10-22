// 迷你状态栏（STATUS-001/002/004，CTRL-010）：左 电量+时间 / 中 章节名 (页码) / 右 阅读百分比；
// 左中右各自可绑「点击」和「长按」动作。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { controlSettings, statusSettings, textSettings, type ReaderActionId } from '@/reader/settings';
import { ReaderAction } from '@/reader/settings';
import { performAction } from '../actions/actions';
import { useHost } from '../context';
import { percentText } from '../ops';
import { ensureFont } from '../services/fonts';
import { useReaderUi } from '../store';
import { useRemainingText } from './remaining';
import { t } from '../messages';
import s from '../reader-ui.module.css';

interface BatteryState {
  level: number;
  charging: boolean;
}

function useBattery(): BatteryState | null {
  const [b, setB] = useState<BatteryState | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void }> };
    if (!nav.getBattery) return; // 非 Chromium：隐藏电池块
    let alive = true;
    let cleanup = () => {};
    void nav
      .getBattery()
      .then((bat) => {
        if (!alive) return;
        const update = () => setB({ level: bat.level, charging: bat.charging });
        update();
        bat.addEventListener('levelchange', update);
        bat.addEventListener('chargingchange', update);
        cleanup = () => {
          bat.removeEventListener('levelchange', update);
          bat.removeEventListener('chargingchange', update);
        };
      })
      .catch(() => {});
    return () => {
      alive = false;
      cleanup();
    };
  }, []);
  return b;
}

export function formatClock(d: Date, use12Hour: boolean, lang: string): string {
  return new Intl.DateTimeFormat(lang, { hour: use12Hour ? 'numeric' : '2-digit', minute: '2-digit', hour12: use12Hour }).format(d);
}

function useClock(use12Hour: boolean): string {
  const lang = navigator.language || 'zh-CN';
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return useMemo(() => formatClock(now, use12Hour, lang), [now, use12Hour, lang]);
}

function Seg(props: { click: ReaderActionId; long: ReaderActionId; className?: string; testId?: string; children: ReactNode }) {
  const host = useHost();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fired = useRef(false);
  const clickable = props.click !== ReaderAction.None || props.long !== ReaderAction.None;
  return (
    <button
      type="button"
      className={`${s.statusSeg} ${props.className ?? ''}`}
      data-click={clickable ? 'true' : undefined}
      data-testid={props.testId}
      tabIndex={clickable ? 0 : -1}
      style={{ pointerEvents: clickable ? 'auto' : 'none' }}
      onPointerDown={() => {
        fired.current = false;
        if (props.long === ReaderAction.None) return;
        timer.current = setTimeout(() => {
          fired.current = true;
          performAction(props.long, host);
        }, 500);
      }}
      onPointerUp={() => clearTimeout(timer.current)}
      onPointerLeave={() => clearTimeout(timer.current)}
      onClick={() => {
        if (!fired.current && props.click !== ReaderAction.None) performAction(props.click, host);
        fired.current = false;
      }}
    >
      {props.children}
    </button>
  );
}

export function StatusBar() {
  const st = statusSettings.use((x) => x);
  const c = controlSettings.use((x) => x);
  const fontColor = textSettings.use((x) => x.fontColor);
  const session = useReaderUi((x) => x.session);
  const loc = useReaderUi((x) => x.loc);
  const clock = useClock(st.use12Hour);
  const battery = useBattery();
  const [family, setFamily] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (st.statusCustomizeFont) void ensureFont(st.statusFontName).then(setFamily);
    else setFamily(undefined);
  }, [st.statusCustomizeFont, st.statusFontName]);

  const remaining = useRemainingText(session, loc, st.showRemainingTime);

  if (!st.showStatusbar) return null;
  const book = session?.book;
  let chapter = '';
  if (loc && book) {
    if (book.kind === 'fixed') chapter = `${loc.section + 1}/${book.pageCount}`;
    else {
      const title = loc.sectionTitle ?? session?.record.title ?? '';
      // TXT 用全书页数估算，其余用章内页码
      const useBook = session?.record.format === 'txt' && loc.bookPage !== undefined && loc.bookPages !== undefined;
      const page = useBook ? loc.bookPage! : loc.page;
      const pages = useBook ? loc.bookPages! : loc.pages;
      chapter = t('status_chapter_pages', { title, page, pages });
    }
  }
  const pct = loc ? percentText(loc.progress, loc.atEnd) : '';
  const custom = st.statusCustomizeFont;
  const style = {
    color: custom ? st.statusFontColor : fontColor,
    fontSize: custom ? st.statusFontSize : Math.max(10, st.statusFontSize),
    fontFamily: family ?? (custom ? st.statusFontName : undefined),
    background: custom ? st.statusBackColor : 'transparent',
    padding: `${2 + (custom ? st.statusMargin : 0)}px ${12 + (custom ? st.statusMargin : 0)}px`,
  } as const;

  return (
    <>
      {remaining && !st.remainingTimeInStatusBar && (
        <div className={s.remaining} style={{ color: fontColor }}>
          {remaining}
        </div>
      )}
      <div className={s.status} style={style}>
        {st.statusTime ? (
          <Seg testId="status-time" click={c.statusClickLeft} long={c.statusLongClickLeft}>
            {battery && (
              <span className={s.battery} title={`${Math.round(battery.level * 100)}%`}>
                <span className={s.batteryFill} style={{ width: `${Math.round(battery.level * 100) * 0.16}px` }} />
              </span>
            )}
            <span>{clock}</span>
          </Seg>
        ) : (
          <span />
        )}
        {st.statusChapter ? (
          <Seg testId="status-chapter" className={s.statusMid} click={c.statusClickMiddle} long={c.statusLongClickMiddle}>
            <span className={s.statusText}>{[chapter, st.remainingTimeInStatusBar ? remaining : ''].filter(Boolean).join('  ')}</span>
          </Seg>
        ) : (
          <span style={{ flex: 1 }} />
        )}
        {st.statusProgress ? (
          <Seg testId="status-progress" click={c.statusClickRight} long={c.statusLongClickRight}>
            <span>{pct}</span>
          </Seg>
        ) : (
          <span />
        )}
      </div>
    </>
  );
}
