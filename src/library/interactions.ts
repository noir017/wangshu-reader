// 交互辅助：长按（进入多选）、容器宽度、多选集合。
import { useCallback, useEffect, useRef, useState } from 'react';

/** 长按 / 右键 / 点击的统一处理。长按触发 onLong，不再触发 onClick */
export function useLongPress(opts: { onClick: (e: React.PointerEvent | React.MouseEvent) => void; onLong: (e: React.PointerEvent | React.MouseEvent) => void; ms?: number }) {
  const state = useRef<{ x: number; y: number; timer?: ReturnType<typeof setTimeout>; fired: boolean; down: boolean }>({ x: 0, y: 0, fired: false, down: false });
  const { onClick, onLong } = opts;
  const clear = () => {
    clearTimeout(state.current.timer);
    state.current.down = false;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      const st = state.current;
      // 右键只靠 contextmenu 事件触发长按；这里要先清掉上一次留下的 fired，否则同一个条目第二次右键没反应
      if (e.button !== 0 && e.pointerType === 'mouse') {
        st.fired = false;
        return;
      }
      st.x = e.clientX;
      st.y = e.clientY;
      st.fired = false;
      st.down = true;
      clearTimeout(st.timer);
      st.timer = setTimeout(() => {
        st.fired = true;
        onLong(e);
      }, opts.ms ?? 450);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!state.current.down) return;
      if (Math.abs(e.clientX - state.current.x) > 8 || Math.abs(e.clientY - state.current.y) > 8) {
        if (!state.current.fired) clear();
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      const st = state.current;
      const wasDown = st.down;
      clearTimeout(st.timer);
      st.down = false;
      if (wasDown && !st.fired) onClick(e);
    },
    onPointerCancel: clear,
    onPointerLeave: () => {
      if (!state.current.fired) clear();
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      if (!state.current.fired) {
        clearTimeout(state.current.timer);
        state.current.fired = true;
        onLong(e);
      }
    },
  };
}

/** 监听元素宽度（网格列数计算用） */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver((es) => setW(es[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** 多选集合 */
export function useSelection() {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setIds((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);
  const add = useCallback((id: string) => setIds((p) => (p.has(id) ? p : new Set(p).add(id))), []);
  const clear = useCallback(() => setIds(new Set()), []);
  const setAll = useCallback((all: string[]) => setIds(new Set(all)), []);
  return { ids, active: ids.size > 0, toggle, add, clear, setAll };
}

export type Selection = ReturnType<typeof useSelection>;
