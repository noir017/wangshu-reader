// 会话/引擎事件订阅的 React 封装：回调用 ref 保存最新值，避免每次渲染重新订阅。
import { useEffect, useRef } from 'react';
import type { ReaderCommands } from '@/core/reader-session';
import { useReaderSession } from '@/core/reader-session';
import type { ReaderEvents } from '@/core/reader';

export function useBus<K extends keyof ReaderCommands & string>(type: K, fn: (payload: ReaderCommands[K]) => void): void {
  const { bus } = useReaderSession();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => bus.on(type, (p) => ref.current(p)), [bus, type]);
}

export function useControllerEvent<K extends keyof ReaderEvents>(type: K, fn: (payload: ReaderEvents[K]) => void): void {
  const { controller } = useReaderSession();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => controller.on(type, (p) => ref.current(p)), [controller, type]);
}

/** 长按：按住 ms 毫秒触发 onLong；触发后紧随的 click 应被忽略（consumed()） */
export function useLongPress(onLong: () => void, ms = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fired = useRef(false);
  const cb = useRef(onLong);
  cb.current = onLong;
  const clear = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  return {
    bind: {
      onPointerDown: () => {
        fired.current = false;
        timer.current = setTimeout(() => {
          fired.current = true;
          cb.current();
        }, ms);
      },
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
    },
    /** 若刚触发过长按，返回 true 并复位 */
    consumed: () => {
      const f = fired.current;
      fired.current = false;
      return f;
    },
  };
}
