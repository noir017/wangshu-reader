// 选择手柄（ANNO-001）：触屏上正文是 user-select:none，选区高亮由引擎画，手柄由这里画；
// 拖动手柄 → 视口坐标反查字符偏移 → controller.setSelection，引擎再回报新的 selection 事件。
// 桌面（精确指针）用浏览器原生选择，不画手柄；设置里 selectionHandles 可强制开/关。
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReaderSession } from '@/core/reader-session';
import type { ReaderSelection } from '@/core/reader';
import { hitTestPoint } from '../common/hit-test';
import { useControllerEvent } from '../common/hooks';
import { useHandleDrag } from './handle-state';
import { annoSettings } from './settings';
import css from './handles.module.css';

/** 手指在手柄上，目标字符在手柄上方：取点往上偏一点，免得手指挡住正在选的字 */
const FINGER_LIFT = 18;
const EDGE = 36;
const EDGE_FLIP_MS = 700;

import { dragRange, type Which } from './handle-math';
import { peekSelection } from '../common/safe';

export function SelectionHandles() {
  const { controller } = useReaderSession();
  const mode = annoSettings.use((s) => s.selectionHandles);
  const [sel, setSel] = useState<ReaderSelection | null>(() => peekSelection(controller));
  const [tick, setTick] = useState(0);
  const drag = useRef<{ which: Which; edgeTimer?: ReturnType<typeof setInterval>; raf?: number } | null>(null);

  useControllerEvent('selection', (s) => setSel(s && s.text.trim() ? s : null));
  // 翻页/滚动后选区矩形变了：重新取
  useControllerEvent('relocate', () => setTick((n) => n + 1));

  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const enabled = mode === 'on' || (mode === 'auto' && coarse);

  const rects = useMemo(() => (sel && enabled ? controller.getRangeRects(sel.range) : []), [sel, enabled, controller, tick]);
  useEffect(() => () => useHandleDrag.setState({ dragging: false }), []);
  if (!sel || !enabled || !rects.length) return null;

  const first = rects[0];
  const last = rects[rects.length - 1];

  const onDown = (which: Which) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { which };
    useHandleDrag.setState({ dragging: true });
  };

  const stopEdge = () => {
    if (drag.current?.edgeTimer) clearInterval(drag.current.edgeTimer);
    if (drag.current) drag.current.edgeTimer = undefined;
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.preventDefault();
    const x = e.clientX;
    const y = e.clientY;
    const cur = peekSelection(controller)?.range ?? sel.range;
    if (d.raf) cancelAnimationFrame(d.raf);
    d.raf = requestAnimationFrame(() => {
      const hit = hitTestPoint(x, y - FINGER_LIFT);
      const next = hit && dragRange(cur, d.which, hit);
      if (next && (next.start !== cur.start || next.end !== cur.end)) controller.setSelection(next);
    });
    // 贴着屏幕上/下边缘不放：隔一会儿翻一页（原 app 是自动滚一行，引擎没有逐行接口）
    const h = window.innerHeight;
    const dir = y > h - EDGE ? 1 : y < EDGE ? -1 : 0;
    if (!dir) return stopEdge();
    if (!d.edgeTimer) d.edgeTimer = setInterval(() => void (dir === 1 ? controller.next() : controller.prev()), EDGE_FLIP_MS);
  };

  const onUp = (e: React.PointerEvent) => {
    stopEdge();
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* 已释放 */
    }
    useHandleDrag.setState({ dragging: false });
  };

  const bind = (which: Which) => ({ onPointerDown: onDown(which), onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp });

  return createPortal(
    <>
      <div className={css.handle} data-testid="handle-start" data-which="start" style={{ left: first.left, top: first.bottom }} {...bind('start')}>
        <span className={css.knob} data-which="start" />
      </div>
      <div className={css.handle} data-testid="handle-end" data-which="end" style={{ left: last.right, top: last.bottom }} {...bind('end')}>
        <span className={css.knob} data-which="end" />
      </div>
    </>,
    document.body,
  );
}
