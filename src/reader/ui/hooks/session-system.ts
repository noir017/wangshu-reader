// 阅读会话的系统级副作用：输入绑定、常亮、屏幕方向、字体注入、自动日夜/跟随系统深色、倾斜/摇一摇、媒体键、翻页声音。
import { useEffect, type RefObject } from 'react';
import type { ReaderLocation } from '@/core/reader';
import type { ReaderSession } from '@/core/reader-session';
import { ReaderAction, controlSettings, flipSettings, screenSettings, themeSettings } from '@/reader/settings';
import { confirmDialog, toast } from '@/ui';
import { performAction, type ActionHost } from '../actions/actions';
import { bindController, createInputHandlers, handledKeys, type InputHandlers } from '../actions/input';
import { stopAutoScroll } from '../autoscroll';
import { MotionDetector, tiltPageAction } from '../services/motion';
import { listenMotion } from '../services/motion-source';
import { PAGE_SOUND_USER, pageSound } from '../services/page-sound';
import { loadUserPageSound } from '../settings/MiscDialogs';
import { AwakeController, applyScreenState, enterFullscreen, exitFullscreen, fullscreenSupported, isFullscreen } from '../services/system';
import { setBrightness } from '../services/brightness-actions';
import { autoThemeDecision, loadTheme } from '../themes/theme-manager';
import { uiSettings } from '../ui-settings';
import { useReaderUi } from '../store';
import { t } from '../messages';

/** 输入：引擎事件 + window 键盘兜底 + 媒体键 */
export function useInputBindings(session: ReaderSession | null, host: ActionHost, hostRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!session) return;
    const handlers: InputHandlers = createInputHandlers({
      host,
      size: () => {
        const r = hostRef.current?.getBoundingClientRect();
        return { w: r?.width ?? window.innerWidth, h: r?.height ?? window.innerHeight };
      },
      confirmSwipe: (message) => confirmDialog(message),
    });
    const unbind = bindController(session.controller, handlers, {
      onEndOfBook: () => {
        stopAutoScroll({ silent: true });
        toast(t('end_of_book'));
      },
    });
    // 引擎只在焦点位于正文时才上报 key；这里在 window 上兜底，用 handledKeys 去重
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || handledKeys.has(e)) return;
      // 有对话框（取色器、确认框…）时，按键归对话框
      if (document.querySelector('[role="dialog"]')) return;
      handledKeys.add(e);
      if (handlers.key(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);

    // 耳机/媒体键（Media Session，P2；只有页面有音频在播时系统才会派发）
    const ms = navigator.mediaSession;
    const mediaKeys: Record<string, string> = { nexttrack: 'MediaTrackNext', previoustrack: 'MediaTrackPrevious', play: 'MediaPlayPause', pause: 'MediaPlayPause' };
    if (ms) {
      try {
        ms.metadata = new MediaMetadata({ title: session.record.title, artist: session.record.authors.join(', ') });
      } catch {
        /* 老浏览器 */
      }
      for (const [action, key] of Object.entries(mediaKeys)) {
        try {
          ms.setActionHandler(action as MediaSessionAction, () => void handlers.key({ key }));
        } catch {
          /* 该动作不被支持 */
        }
      }
    }
    return () => {
      unbind();
      window.removeEventListener('keydown', onKey);
      if (ms) for (const action of Object.keys(mediaKeys)) {
        try {
          ms.setActionHandler(action as MediaSessionAction, null);
        } catch {
          /* ignore */
        }
      }
    };
  }, [session, host, hostRef]);
}

/** 位置 → 界面状态；翻页声音 */
export function useLocationState(session: ReaderSession | null): void {
  useEffect(() => {
    if (!session) return;
    let prev: ReaderLocation | null = null;
    void loadUserPageSound();
    const off = session.controller.on('relocate', (loc) => {
      useReaderUi.getState().setLoc(loc);
      const f = flipSettings.get();
      if (f.pageSound && prev) {
        const turned = prev.section !== loc.section ? Math.abs(prev.section - loc.section) === 1 : prev.page !== loc.page && prev.pages === loc.pages && Math.abs(prev.page - loc.page) <= 2;
        if (turned) {
          if (f.pageSoundIndex === PAGE_SOUND_USER) pageSound.playUser();
          else pageSound.play(f.pageSoundIndex);
        }
      }
      prev = loc;
    });
    const first = session.controller.getLocation();
    if (first) useReaderUi.getState().setLoc(first);
    return off;
  }, [session]);
}

/** 常亮、屏幕方向、全屏（用户/服务端字体由引擎自己注入章节 iframe，这里不管） */
export function useSystemEffects(session: ReaderSession | null): void {
  const keep = screenSettings.use((s) => s.keepScreenAwake);
  const extend = screenSettings.use((s) => s.screenAwakeExtend);
  const auto = useReaderUi((s) => s.autoRunning || s.speedRead);
  const state = screenSettings.use((s) => s.screenState);
  const fullscreen = screenSettings.use((s) => s.fullscreen);

  // 全屏（VIEW-012）：浏览器要求用户手势才能进全屏，所以只在触屏设备（对应原 app 的手机/平板沉浸阅读）上、
  // 用阅读页里的第一次触摸去触发；桌面浏览器不自动进入（用选项菜单里的「全屏模式」）。离开阅读页时退出。
  useEffect(() => {
    if (!session || !fullscreen || !fullscreenSupported() || isFullscreen()) return;
    if (typeof matchMedia === 'undefined' || !matchMedia('(pointer: coarse)').matches) return;
    let entered = false;
    const onUp = () => {
      window.removeEventListener('pointerup', onUp, true);
      void enterFullscreen().then((ok) => (entered = ok));
    };
    window.addEventListener('pointerup', onUp, true);
    return () => {
      window.removeEventListener('pointerup', onUp, true);
      if (entered && isFullscreen()) void exitFullscreen();
    };
  }, [session, fullscreen]);

  // 常亮：每次操作刷新计时；自动滚屏/速读强制常亮
  useEffect(() => {
    if (!session) return;
    const awake = new AwakeController();
    awake.configure(screenSettings.get().keepScreenAwake, screenSettings.get().screenAwakeExtend);
    awakeRef.current = awake;
    const onAct = () => awake.activity();
    const onVis = () => awake.visibilityChanged(document.visibilityState === 'visible');
    window.addEventListener('pointerdown', onAct, { passive: true });
    window.addEventListener('keydown', onAct);
    document.addEventListener('visibilitychange', onVis);
    const off = session.controller.on('relocate', onAct);
    return () => {
      off();
      window.removeEventListener('pointerdown', onAct);
      window.removeEventListener('keydown', onAct);
      document.removeEventListener('visibilitychange', onVis);
      awake.dispose();
      awakeRef.current = null;
    };
  }, [session]);
  useEffect(() => awakeRef.current?.configure(keep, extend), [keep, extend]);
  useEffect(() => awakeRef.current?.setForce(auto), [auto]);

  // 屏幕方向：进入阅读页时静默应用（多数浏览器要求全屏，失败不提示）
  useEffect(() => {
    if (session && state !== 0) void applyScreenState(state);
  }, [session, state]);
}

const awakeRef: { current: AwakeController | null } = { current: null };

/** 自动日夜（THEME-004）与跟随系统深色（THEME-005） */
export function useThemeAutomation(session: ReaderSession | null): void {
  const follow = themeSettings.use((s) => s.sysDarkModeFollow);
  const autoTheme = themeSettings.use((s) => s.autoTheme);

  useEffect(() => {
    if (!session) return;
    const apply = () => {
      const s = themeSettings.get();
      if (!s.autoTheme) return;
      const b = autoThemeDecision(new Date(), uiSettings.get().lastReadTime, s);
      if (b === 0) return;
      const fixed = session.book.kind === 'fixed';
      const target = b === 1 ? s.dayTheme : s.nightTheme;
      if (!fixed && s.lastTheme !== target) loadTheme(target);
      const sc = screenSettings.get();
      if (b === 1) {
        if (s.autoDaySetBright) {
          if (sc.brightnessValue < s.autoThemeDayBrightness) setBrightness(s.autoThemeDayBrightness);
        } else if (sc.brightnessValue !== -100) setBrightness(-100);
      } else if (s.autoNightSetBright) {
        if (sc.brightnessValue > s.autoThemeNightBrightness) setBrightness(s.autoThemeNightBrightness);
      } else if (sc.brightnessValue !== -100) setBrightness(-100);
    };
    apply(); // 打开阅读页 = 恢复阅读
    const onVis = () => document.visibilityState === 'visible' && apply();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [session, autoTheme]);

  useEffect(() => {
    if (!session || typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const s = themeSettings.get();
      if (!s.sysDarkModeFollow || s.autoTheme) return;
      const name = mq.matches ? s.nightTheme : s.dayTheme;
      if (s.lastTheme !== name && session.book.kind !== 'fixed') loadTheme(name);
    };
    apply();
    mq.addEventListener('change', apply);
    // 首次检测到系统深色且未开启：问一次
    if (mq.matches && !follow && uiSettings.get().sysDarkModeTip && !themeSettings.get().autoTheme) {
      uiSettings.set({ sysDarkModeTip: false });
      void confirmDialog(t('sys_dark_ask')).then((ok) => ok && themeSettings.set({ sysDarkModeFollow: true }));
    }
    return () => mq.removeEventListener('change', apply);
  }, [session, follow]);
}

/** 摇一摇 / 倾斜翻页（DeviceMotion，仅手机浏览器） */
export function useMotion(session: ReaderSession | null, host: ActionHost): void {
  const tilt = controlSettings.use((c) => c.tiltTurnPage);
  const shake = controlSettings.use((c) => c.doShakePhone);
  useEffect(() => {
    if (!session) return;
    const shakeOn = shake !== ReaderAction.None;
    if (!tilt && !shakeOn) return;
    const c = controlSettings.get();
    const det = new MotionDetector(
      { shakeEnabled: shakeOn, tiltEnabled: tilt, forwardSens: c.tiltForwardSensitive, backwardSens: c.tiltBackwardSensitive },
      {
        onShake: () => performAction(controlSettings.get().doShakePhone, host),
        onTilt: (dir) => {
          const cc = controlSettings.get();
          const act = tiltPageAction(dir === 'forward' ? cc.tiltForward : cc.tiltBackward);
          performAction(act === 'next' ? ReaderAction.PageDown : ReaderAction.PageUp, host);
        },
      },
    );
    const stop = listenMotion((x, y, z, now) => {
      const ui = useReaderUi.getState();
      // 自动滚屏/速读/菜单打开时不响应倾斜
      det.opts.tiltEnabled = controlSettings.get().tiltTurnPage && !ui.autoRunning && !ui.speedRead && !ui.menu;
      det.opts.forwardSens = controlSettings.get().tiltForwardSensitive;
      det.opts.backwardSens = controlSettings.get().tiltBackwardSensitive;
      det.feed(x, y, z, now);
    });
    return stop;
  }, [session, tilt, shake, host]);
}
