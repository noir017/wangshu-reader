// 阅读页：取书 → openBook → createReader → 挂载、恢复进度；组装顶栏/底栏/状态栏/面板/亮度遮罩/动作分发；
// 在 <ReaderSessionContext.Provider> 里挂 <ReaderFeatures />（features 经 bus 接收命令）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Emitter } from '@/core/emitter';
import { navigate } from '@/core/router';
import type { ReaderCommands, ReaderSession } from '@/core/reader-session';
import { ReaderSessionContext } from '@/core/reader-session';
import { textSettings, statusSettings } from '@/reader/settings';
import { createReader as realCreateReader } from '@/reader/engine';
import type { CreateReader } from '@/core/reader';
import { ReaderFeatures } from '@/features';
import { getPosition } from '@/storage/db';
import { promptDialog, openOverlay } from '@/ui';
import { createActionHost } from './actions/host';
import { HostContext } from './context';
import { BottomBar, TopBar } from './components/Bars';
import { BrightnessPanel, FontPanel } from './components/Panels';
import { LinkBackButton, Shade } from './components/Overlays';
import { StatusBar } from './components/StatusBar';
import { ScrollLock, ThumbStrip } from './pdf/ThumbStrip';
import { SpeedRead } from './speedread/SpeedRead';
import { ClickTip } from './settings/ClickTip';
import { closeSettings } from './settings/open';
import { stopAutoScroll } from './autoscroll';
import { useUiNightMode, useReaderBackground } from './hooks/theme-style';
import { usePositionSaving, useReadingStats } from './hooks/session-persist';
import { useInputBindings, useLocationState, useMotion, useSystemEffects, useThemeAutomation } from './hooks/session-system';
import { BookNotFoundError, PasswordNeededError, ServerNeededError, loadBook as realLoadBook, type LoadedBook } from './session/load';
import { loadThemeForBook } from './themes/theme-manager';
import { resetReaderUi, useReaderUi } from './store';
import { uiSettings } from './ui-settings';
import { t } from './messages';
import s from './reader-ui.module.css';

/** 可替换的依赖：开发页与测试用 mock 的书与引擎（默认是真实的 formats / engine） */
export interface ReaderDeps {
  loadBook(bookId: string, opts: { password?: string }): Promise<LoadedBook>;
  createReader: CreateReader;
}

/** 开发模式下用 ?mrdev=1 打开阅读页，会换成 src/reader/ui/dev 里的假书与假引擎（生产构建会整段去掉） */
const devDeps: Promise<ReaderDeps | null> =
  import.meta.env.DEV && typeof location !== 'undefined' && /[?&]mrdev=1/.test(location.search) ? import('./dev/install').then((m) => m.devDeps) : Promise.resolve(null);

type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'password'; wrong: boolean } | { kind: 'error'; message: string; retry: boolean };

export function ReaderPage({ bookId, deps }: { bookId: string; deps?: Partial<ReaderDeps> }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [session, setSession] = useState<ReaderSession | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [password, setPassword] = useState<string | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const host = useMemo(() => createActionHost(), []);

  const night = useUiNightMode();
  const bg = useReaderBackground();
  const fontColor = textSettings.use((x) => x.fontColor);
  const statusTop = statusSettings.use((x) => x.statusBarOnTop);
  const panel = useReaderUi((x) => x.panel);
  const speedRead = useReaderUi((x) => x.speedRead);

  // 取书、打开、创建会话
  useEffect(() => {
    let cancelled = false;
    let controller: ReaderSession['controller'] | undefined;
    let book: ReaderSession['book'] | undefined;
    setPhase({ kind: 'loading' });
    setSession(null);
    void (async () => {
      try {
        const dev = deps ? null : await devDeps;
        const loadFn = deps?.loadBook ?? dev?.loadBook ?? realLoadBook;
        const create = deps?.createReader ?? dev?.createReader ?? realCreateReader;
        const loaded = await loadFn(bookId, { password });
        if (cancelled) return void loaded.book.destroy();
        book = loaded.book;
        // 书专属主题（名称 = 书文件名）：先暂存当前主题再完整载入
        loadThemeForBook(loaded.record.fileName);
        controller = create(book);
        const sess: ReaderSession = { bookId, record: loaded.record, book, controller, bus: new Emitter<ReaderCommands>() };
        sess.bus.on('menu.hide', () => useReaderUi.getState().setMenu(false));
        useReaderUi.getState().setSession(sess);
        setSession(sess);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof PasswordNeededError) setPhase({ kind: 'password', wrong: e.wrong });
        else if (e instanceof BookNotFoundError) setPhase({ kind: 'error', message: t('book_not_found'), retry: false });
        else if (e instanceof ServerNeededError) setPhase({ kind: 'error', message: t('server_needed', { fmt: e.format.toUpperCase() }), retry: true });
        else setPhase({ kind: 'error', message: t('open_failed', { msg: (e as Error)?.message ?? String(e) }), retry: true });
      }
    })();
    return () => {
      cancelled = true;
      stopAutoScroll({ silent: true });
      closeSettings();
      resetReaderUi();
      controller?.destroy();
      book?.destroy();
    };
  }, [bookId, reloadKey, password]);

  // 需要密码：弹密码框，取消则回书库
  useEffect(() => {
    if (phase.kind !== 'password') return;
    let alive = true;
    void promptDialog(phase.wrong ? `${t('password_title')} — ${t('password_wrong')}` : t('password_title'), '', { placeholder: t('password_hint'), type: 'password' }).then((v) => {
      if (!alive) return;
      if (v === null || v === '') navigate('');
      else setPassword(v);
    });
    return () => {
      alive = false;
    };
  }, [phase]);

  // 挂载到容器并恢复进度（在 features 的子 effect 之后执行，保证它们先订阅了事件）
  useEffect(() => {
    if (!session || !containerRef.current) return;
    let cancelled = false;
    void (async () => {
      const pos = await getPosition(session.bookId);
      if (cancelled) return;
      try {
        await session.controller.open(containerRef.current!, pos?.locator);
        if (cancelled) return;
        setPhase({ kind: 'ready' });
        // 首次进阅读页弹点击区示意（CTRL-013）
        if (!uiSettings.get().showedReaderClickTip) {
          uiSettings.set({ showedReaderClickTip: true });
          openOverlay((close) => <ClickTip onClose={close} />);
        }
      } catch (e) {
        if (!cancelled) setPhase({ kind: 'error', message: t('open_failed', { msg: (e as Error)?.message ?? String(e) }), retry: true });
      }
    })();
    session.controller.on('error', (e) => console.error('[reader]', e));
    return () => {
      cancelled = true;
    };
  }, [session]);

  // 改文字编码：重新读取（位置由 usePositionSaving 在清理时落盘，重开后恢复）
  useEffect(() => {
    let prev = textSettings.get().textEncode;
    return textSettings.subscribe((next) => {
      if (next.textEncode !== prev) {
        prev = next.textEncode;
        if (useReaderUi.getState().session) setReloadKey((k) => k + 1);
      }
    });
  }, []);

  usePositionSaving(session);
  useReadingStats(session);
  useLocationState(session);
  useInputBindings(session, host, hostRef);
  useSystemEffects(session);
  useThemeAutomation(session);
  useMotion(session, host);


  return (
    <HostContext.Provider value={host}>
      <div className={s.root} data-night={night} style={{ ...bg, ['--reader-fg' as string]: fontColor }}>
        {statusTop && <StatusBar />}
        <div className={s.host} ref={hostRef}>
          <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
          {phase.kind === 'loading' && (
            <div className={s.center}>
              <div className={s.spinner} />
              <div>{t('loading')}</div>
            </div>
          )}
          {phase.kind === 'error' && (
            <div className={s.center}>
              <div style={{ maxWidth: 420 }}>{phase.message}</div>
              <div className={s.btnRow}>
                {phase.retry && (
                  <button type="button" className={s.btn} onClick={() => setReloadKey((k) => k + 1)}>
                    {t('retry')}
                  </button>
                )}
                <button type="button" className={s.btn} onClick={() => navigate('')}>
                  {t('back_to_shelf')}
                </button>
              </div>
            </div>
          )}
        </div>
        <ThumbStrip />
        {!statusTop && <StatusBar />}
        {session && (
          <>
            <TopBar />
            <BottomBar />
            {panel === 'font' && <FontPanel />}
            {(panel === 'brightness' || panel === 'brightness-mini') && <BrightnessPanel mini={panel === 'brightness-mini'} />}
            <LinkBackButton />
            <ScrollLock />
            {speedRead && <SpeedRead />}
          </>
        )}
        <Shade />
        <ReaderSessionContext.Provider value={session}>{session && <ReaderFeatures />}</ReaderSessionContext.Provider>
      </div>
    </HostContext.Provider>
  );
}
