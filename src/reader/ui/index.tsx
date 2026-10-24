// 阅读页：取书 → openBook → createReader → 挂载、恢复进度；组装顶栏/底栏/状态栏/面板/亮度遮罩/动作分发；
// 在 <ReaderSessionContext.Provider> 里挂 <ReaderFeatures />（features 经 bus 接收命令）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Emitter } from '@/core/emitter';
import { back } from '@/core/router';
import type { ReaderCommands, ReaderSession } from '@/core/reader-session';
import { ReaderSessionContext } from '@/core/reader-session';
import { fixedSettings, textSettings, statusSettings } from '@/reader/settings';
import { createReader as realCreateReader } from '@/reader/engine';
import type { CreateReader } from '@/core/reader';
import { ReaderFeatures } from '@/features';
import { getPosition } from '@/storage/db';
import { chooseDialog, openOverlay } from '@/ui';
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
import { useFontCheck, useInputBindings, useLocationState, useMotion, useSystemEffects, useThemeAutomation } from './hooks/session-system';
import { ArchiveChoiceNeededError, BookNotFoundError, PasswordNeededError, ServerNeededError, loadBook as realLoadBook, type LoadedBook } from './session/load';
import { askPassword, savePassword } from './session/password';
import { canReflow, isReflowed, reflowFixedBook } from './session/pdf-reflow';
import { OpenBookAnim, wantOpenBookAnim } from './components/OpenBookAnim';
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

type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'password'; wrong: boolean } | { kind: 'choose'; entries: string[] } | { kind: 'error'; message: string; retry: boolean };

export function ReaderPage({ bookId, deps }: { bookId: string; deps?: Partial<ReaderDeps> }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [session, setSession] = useState<ReaderSession | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [password, setPassword] = useState<string | undefined>(undefined);
  /** 多本书的压缩包里选中的那一本（条目路径） */
  const [entry, setEntry] = useState<string | undefined>(undefined);
  /** 用户在密码框里勾了「保存密码」：打开成功后才写入 */
  const savePw = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const host = useMemo(() => createActionHost(), []);

  const night = useUiNightMode();
  const bg = useReaderBackground();
  const fontColor = textSettings.use((x) => x.fontColor);
  const statusTop = statusSettings.use((x) => x.statusBarOnTop);
  const panel = useReaderUi((x) => x.panel);
  const speedRead = useReaderUi((x) => x.speedRead);
  const menu = useReaderUi((x) => x.menu);
  // 打开书动画（ANIM-012）：挂载时判断一次
  const [bookAnim, setBookAnim] = useState(wantOpenBookAnim);
  const endBookAnim = useCallback(() => setBookAnim(false), []);

  // features 的浮层（书签角标）挂在 body 上，层级压过本页根节点里的顶栏：菜单栏显示时角标会盖住顶栏右上角的 ⋮。
  // 用 html 上的标记通知它让位（样式在 features.module.css 的 .bookmarkCorner）
  useEffect(() => {
    document.documentElement.dataset.readerMenu = String(menu);
    return () => {
      delete document.documentElement.dataset.readerMenu;
    };
  }, [menu]);

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
        const loaded = await loadFn(bookId, { password, entry });
        if (cancelled) return void loaded.book.destroy();
        if (password !== undefined && savePw.current) void savePassword(bookId, password);
        savePw.current = false;
        book = loaded.book;
        // PDF 文本重排（PDF-006）：开着就把固定版式书包成「一页一章」的文本书，交给文本引擎
        if (canReflow(book) && fixedSettings.get().textReflow) book = reflowFixedBook(book as Parameters<typeof reflowFixedBook>[0]);
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
        else if (e instanceof ArchiveChoiceNeededError) setPhase({ kind: 'choose', entries: e.entries });
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
      // 引擎可能还没 open 完（切书很快、严格模式的 effect 清理）：销毁失败不能影响页面
      try {
        controller?.destroy();
      } catch (e) {
        console.warn('[reader] destroy', e);
      }
      book?.destroy();
    };
  }, [bookId, reloadKey, password, entry]);

  // 压缩包里有多本书：列出来让用户挑（FMT-020），取消则回书库
  useEffect(() => {
    if (phase.kind !== 'choose') return;
    let alive = true;
    void chooseDialog(
      t('choose_book_in_archive'),
      phase.entries.map((e) => ({ value: e, label: e.split('/').pop() ?? e, subtitle: e.includes('/') ? e : undefined })),
    ).then((v) => {
      if (!alive) return;
      if (v === null) back();
      else setEntry(v);
    });
    return () => {
      alive = false;
    };
  }, [phase]);

  // 需要密码：弹密码框（带「保存密码」），取消则回书库
  useEffect(() => {
    if (phase.kind !== 'password') return;
    let alive = true;
    void askPassword({ wrong: phase.wrong }).then((v) => {
      if (!alive) return;
      if (!v) back();
      else {
        savePw.current = v.save;
        setPassword(v.password);
      }
    });
    return () => {
      alive = false;
    };
  }, [phase]);

  // 挂载到容器并恢复进度
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
    const offError = session.controller.on('error', (e) => console.error('[reader]', e));
    return () => {
      cancelled = true;
      offError();
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

  // 切换 PDF 文本重排：同样重开（重排书与原书偏移基准相同，位置/标注照旧）
  useEffect(() => {
    let prev = fixedSettings.get().textReflow;
    return fixedSettings.subscribe((next) => {
      if (next.textReflow === prev) return;
      prev = next.textReflow;
      const b = useReaderUi.getState().session?.book;
      if (b && (canReflow(b) || isReflowed(b))) setReloadKey((k) => k + 1);
    });
  }, []);

  usePositionSaving(session);
  useReadingStats(session);
  useLocationState(session);
  useInputBindings(session, host, hostRef);
  useSystemEffects(session);
  useFontCheck(session);
  useThemeAutomation(session);
  useMotion(session, host);


  return (
    <HostContext.Provider value={host}>
      <div className={s.root} data-night={night} style={{ ...bg, ['--reader-fg' as string]: fontColor }}>
        {statusTop && <StatusBar />}
        <div className={s.host} ref={hostRef}>
          {/* 正文挂载点：color-scheme 固定 light。界面切到深色时（color-scheme: dark），浏览器会给与父级配色不同的
             iframe 铺一层不透明底色，引擎的正文 iframe 会因此变成白底；正文颜色由主题决定，与界面配色无关 */}
          <div ref={containerRef} style={{ position: 'absolute', inset: 0, colorScheme: 'light' }} />
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
                <button type="button" className={s.btn} onClick={back}>
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
        {bookAnim && <OpenBookAnim bookId={bookId} start={phase.kind !== 'loading'} onDone={endBookAnim} />}
        {/* features 要在引擎 open 完之后才能挂：它们渲染时会直接问引擎当前选区/位置 */}
        <ReaderSessionContext.Provider value={session}>{session && phase.kind === 'ready' && <ReaderFeatures />}</ReaderSessionContext.Provider>
      </div>
    </HostContext.Provider>
  );
}
