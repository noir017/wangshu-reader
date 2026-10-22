// 输入分发：把引擎上报的原始事件（tap/longPress/swipe/key/verticalDrag/pinch/link…）翻译成动作。
// 全部是纯逻辑 + 依赖注入（宿主、容器尺寸、确认框），所以可以用 mock 引擎做单测。
import type { ReaderEvents } from '@/core/reader';
import { isTtsActive, openLinkBackHistory, useLinkBack } from '@/features';
import { ReaderAction, controlSettings, textSettings, screenSettings, type ReaderActionId } from '@/reader/settings';
import { toast } from '@/ui';
import { type ActionHost, decideTap, performAction } from './actions';
import { clickArea } from './tap-zones';
import { isTypingTarget, keyAction } from './keys';
import { edgeBrightnessStep, edgeFontSizeStep } from '../services/brightness';
import { setBrightness } from '../services/brightness-actions';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, clampFontSize } from '../settings/options-data';
import { isAutoActive, pauseOrResume, stopAutoScroll, changeSpeed, onEngineAutoScroll } from '../autoscroll';
import { uiSettings } from '../ui-settings';
import { isRtlComic } from '../ops';
import { useReaderUi } from '../store';
import { t } from '../messages';

export interface InputDeps {
  host: ActionHost;
  /** 阅读区尺寸（CSS px） */
  size(): { w: number; h: number };
  /** 划动手势绑到「上/下一文件」时的首次确认；返回 false 则取消并重置手势 */
  confirmSwipe?(message: string): Promise<boolean>;
  now?(): number;
}

/** 坐标可能是 0..1 的归一化值，也可能是像素：≤1 当归一化 */
export function toPx(v: number, size: number): number {
  return v <= 1.0001 ? v * size : v;
}

/** 边缘触发区宽度：40dp，防误触开启时向内缩进同样宽度（VIEW-018 / CTRL-007） */
const EDGE_ZONE = 40;

export type EdgeKind = 'brightness' | 'fontsize' | null;

/**
 * 起点落在哪个边缘调节区。左/右边沿（edge 0/1）是竖向拖动；给了 across（起点纵坐标与阅读区高度）时判断
 * 上/下边沿（edge 2/3），那是横向擦动（原版 brightness_edge/fontsize_edge 的四个取值）
 */
export function edgeKindAt(xPx: number, width: number, across?: { yPx: number; height: number }): EdgeKind {
  const c = controlSettings.get();
  let zone: (edge: number) => boolean;
  if (across) {
    const insetT = c.disableEdgeTouch ? c.topEdge : 0;
    const insetB = c.disableEdgeTouch ? c.bottomEdge : 0;
    const inTop = across.yPx >= insetT && across.yPx < insetT + EDGE_ZONE;
    const inBottom = across.yPx <= across.height - insetB && across.yPx > across.height - insetB - EDGE_ZONE;
    zone = (edge) => (edge === 2 ? inTop : edge === 3 ? inBottom : false);
  } else {
    const inset = c.disableEdgeTouch ? c.leftEdge : 0;
    const insetR = c.disableEdgeTouch ? c.rightEdge : 0;
    const inLeft = xPx >= inset && xPx < inset + EDGE_ZONE;
    const inRight = xPx <= width - insetR && xPx > width - insetR - EDGE_ZONE;
    zone = (edge) => (edge === 0 ? inLeft : edge === 1 ? inRight : false);
  }
  if (c.adjustBrightness && zone(c.brightnessEdge)) return 'brightness';
  if (c.adjustFontSizeAtSlide && zone(c.fontsizeEdge)) return 'fontsize';
  return null;
}

export function createInputHandlers(deps: InputDeps) {
  const { host } = deps;
  const now = deps.now ?? (() => performance.now());
  const ui = () => useReaderUi.getState();

  // 边缘拖动状态
  let drag: { kind: EdgeKind; last: number; accum: number; lastT: number; speed: number } | null = null;
  // 双指缩放状态
  let pinchBase: number | null = null;

  /** 防误触：落在边缘带内的点击忽略 */
  const inDeadEdge = (x: number, y: number): boolean => {
    const c = controlSettings.get();
    if (!c.disableEdgeTouch) return false;
    const { w, h } = deps.size();
    const px = toPx(x, w);
    const py = toPx(y, h);
    return px < c.leftEdge || px > w - c.rightEdge || py < c.topEdge || py > h - c.bottomEdge;
  };

  function tap(p: ReaderEvents['tap']): void {
    const s = ui();
    if (s.speedRead) return;
    if (inDeadEdge(p.x, p.y)) return;
    // 面板（字号/亮度）开着：点正文先关面板
    if (s.panel) {
      s.setPanel(null);
      return;
    }
    if (s.menu) {
      s.setMenu(false);
      return;
    }
    // 自动滚屏中点击 = 暂停/继续（CTRL-001）
    if (isAutoActive()) {
      pauseOrResume();
      return;
    }
    const c = controlSettings.get();
    // 右到左漫画：点击区左右镜像（引擎只管翻页方向，点击区归本层）
    const area = clickArea(c.tapMode, c.toggleTapMode, isRtlComic() ? 1 - p.x : p.x, p.y);
    const o = decideTap({ menuVisible: false, area, bindings: c });
    // 朗读中点中间（本该呼出菜单的区域）= 暂停/继续朗读（CTRL-001 / AUTO-005）；其他区照常翻页
    if (o.kind === 'toggle-menu' && s.session && isTtsActive()) {
      s.session.bus.emit('tts.toggle', {});
      return;
    }
    if (o.kind === 'toggle-menu') s.toggleMenu();
    else if (o.kind === 'action' && o.action !== undefined) performAction(o.action, host);
  }

  function longPress(p: ReaderEvents['longPress']): void {
    const s = ui();
    if (s.menu || s.panel || s.speedRead) return;
    performAction(controlSettings.get().doLongTap, host, { x: p.x, y: p.y });
  }

  async function swipe(p: ReaderEvents['swipe']): Promise<void> {
    const s = ui();
    if (s.speedRead) return;
    const c = controlSettings.get();
    const { w, h } = deps.size();
    // 自动滚屏中横向划动 = 停止（>80dp）
    if (isAutoActive() && (p.dir === 'left' || p.dir === 'right') && toPx(p.dist, w) > 80) {
      stopAutoScroll();
      return;
    }
    // 从调节边缘起手的竖划已被 verticalDrag 消费
    if (p.edge && (edgeKindAt(toPx(p.startX, w), w) || edgeKindAt(toPx(p.startX, w), w, { yPx: toPx(p.startY, h), height: h }))) return;
    const horizontal = p.dir === 'left' || p.dir === 'right';
    const need = horizontal ? Math.min(w / 2, 400) : Math.min(h / 2, 400);
    if (toPx(p.dist, horizontal ? w : h) < need) return;
    const id = p.dir === 'right' ? c.doSwipeLeftToRight : p.dir === 'left' ? c.doSwipeRightToLeft : p.dir === 'down' ? c.doSwipeTopToBottom : c.doSwipeBottomToTop;
    if (id === ReaderAction.None) return;
    // 绑到上/下一文件时首次确认，取消则两个方向都重置为 None（CTRL-004）
    if ((id === ReaderAction.NextFile || id === ReaderAction.PriorFile) && uiSettings.get().askForSwipeEvent && deps.confirmSwipe) {
      const ok = await deps.confirmSwipe(id === ReaderAction.NextFile ? t('swipe_hint_1') : t('swipe_hint_2'));
      if (!ok) {
        controlSettings.set({ doSwipeLeftToRight: ReaderAction.None, doSwipeRightToLeft: ReaderAction.None });
        return;
      }
      uiSettings.set({ askForSwipeEvent: false });
    }
    performAction(id, host);
  }

  function verticalDrag(p: ReaderEvents['verticalDrag']): void {
    if (p.phase === 'end') {
      drag = null;
      return;
    }
    const { w, h } = deps.size();
    if (!drag) {
      // axis='x'：上/下边沿横向擦动，dy 里是横向位移（往左 = 负 = 与往上同向，变亮/变大）
      const kind = p.axis === 'x' ? edgeKindAt(toPx(p.startX, w), w, { yPx: toPx(p.startY ?? 0, h), height: h }) : edgeKindAt(toPx(p.startX, w), w);
      drag = { kind, last: 0, accum: 0, lastT: now(), speed: 0 };
    }
    if (!drag.kind) return;
    const t0 = now();
    const delta = p.dy - drag.last;
    drag.last = p.dy;
    drag.accum += delta;
    const dt = Math.max(t0 - drag.lastT, 1);
    drag.speed = (Math.abs(delta) / dt) * 1000;
    drag.lastT = t0;
    if (drag.kind === 'brightness') {
      if (Math.abs(drag.accum) < 20) return;
      setBrightness(edgeBrightnessStep(screenSettings.get().brightnessValue, drag.accum, drag.speed));
      drag.accum = 0;
      s_showMiniBrightness();
    } else {
      if (Math.abs(drag.accum) < 40) return;
      const next = edgeFontSizeStep(textSettings.get().fontSize, drag.accum, MIN_FONT_SIZE, MAX_FONT_SIZE);
      drag.accum = 0;
      if (next !== textSettings.get().fontSize) {
        textSettings.set({ fontSize: next });
        toast(`${t('font_size')}: ${next.toFixed(1)}`, 600);
      }
    }
  }

  function s_showMiniBrightness(): void {
    useReaderUi.getState().setPanel('brightness-mini');
  }

  function pinch(p: ReaderEvents['pinch']): void {
    if (!controlSettings.get().multTouch) return;
    if (p.phase === 'end') {
      pinchBase = null;
      return;
    }
    pinchBase ??= textSettings.get().fontSize;
    const next = clampFontSize(pinchBase * p.scale);
    if (next !== textSettings.get().fontSize) {
      textSettings.set({ fontSize: next });
      toast(`${t('font_size')}: ${next.toFixed(1)}`, 500);
    }
  }

  /** 返回 true = 已处理（调用方应 preventDefault） */
  function key(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; target?: EventTarget | null }): boolean {
    if (e.target && isTypingTarget(e.target)) return false;
    const s = ui();
    if (s.speedRead) return false;
    if (e.key === 'Escape') {
      // 返回键优先级：面板 → 菜单栏 → 停止自动滚屏/朗读 → 绑定动作（默认：返回书库）
      if (s.panel) {
        s.setPanel(null);
        return true;
      }
      if (s.menu) {
        s.setMenu(false);
        return true;
      }
      if (isAutoActive()) {
        stopAutoScroll();
        return true;
      }
      // 链接返回栈非空：返回键不直接退出，弹返回记录菜单（末项「退出」才离开阅读器，TOC-005）
      if (s.session && useLinkBack.getState().stack.length > 0) {
        openLinkBackHistory(s.session, { x: 16, y: window.innerHeight / 3, onExit: () => host.backToShelf() });
        return true;
      }
      const bound = controlSettings.get().keyMap.Escape;
      if (bound === undefined || !performAction(bound, host)) host.backToShelf();
      return true;
    }
    // 右到左漫画：← 是下一页、→ 是上一页
    const k = isRtlComic() && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') ? { key: e.key === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft', ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey } : e;
    const action = keyAction(controlSettings.get().keyMap, k);
    if (action === undefined || action === ReaderAction.None) return false;
    // 自动滚屏中翻页键 = 翻一页但不终止滚屏（performAction 本身不停滚屏）
    return performAction(action, host);
  }

  return { tap, longPress, swipe, verticalDrag, pinch, key, onAutoScroll: (e: ReaderEvents['autoScroll']) => onEngineAutoScroll(e), speed: changeSpeed };
}

export type InputHandlers = ReturnType<typeof createInputHandlers>;

/** 把处理器接到控制器事件上，返回解绑函数 */
export function bindController(
  controller: { on<K extends keyof ReaderEvents>(type: K, fn: (p: ReaderEvents[K]) => void): () => void },
  h: InputHandlers,
  extra: { onEndOfBook(): void },
): () => void {
  const offs = [
    controller.on('tap', h.tap),
    controller.on('longPress', h.longPress),
    controller.on('swipe', (p) => void h.swipe(p)),
    controller.on('verticalDrag', h.verticalDrag),
    controller.on('pinch', h.pinch),
    controller.on('autoScroll', h.onAutoScroll),
    controller.on('endOfBook', extra.onEndOfBook),
    controller.on('key', ({ event }) => {
      if (handledKeys.has(event)) return;
      handledKeys.add(event);
      if (h.key(event)) event.preventDefault();
    }),
  ];
  return () => offs.forEach((off) => off());
}

/** 已处理过的键盘事件（引擎的 key 事件与 window 兜底监听共用，避免重复执行） */
export const handledKeys = new WeakSet<Event>();

export type { ReaderActionId };
