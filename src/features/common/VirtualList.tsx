// 定高行的最小虚拟列表：目录可能有几千章，只渲染可视窗口内的行。
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';

export interface VirtualListHandle {
  scrollToIndex(index: number, align?: 'start' | 'center'): void;
}

export function VirtualList<T>(props: {
  items: T[];
  rowHeight: number;
  renderRow: (item: T, index: number) => ReactNode;
  overscan?: number;
  handle?: Ref<VirtualListHandle>;
  className?: string;
  testId?: string;
}) {
  const { items, rowHeight, overscan = 8 } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(600);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setHeight(el.clientHeight || 600);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => setHeight(el.clientHeight || 600)) : undefined;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  useEffect(() => {
    if (!props.handle) return;
    const h: VirtualListHandle = {
      scrollToIndex(index, align = 'center') {
        const el = ref.current;
        if (!el) return;
        const y = index * rowHeight;
        el.scrollTop = align === 'center' ? Math.max(0, y - el.clientHeight / 2 + rowHeight / 2) : y;
      },
    };
    if (typeof props.handle === 'function') props.handle(h);
    else (props.handle as { current: VirtualListHandle | null }).current = h;
  });

  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const last = Math.min(items.length, Math.ceil((top + height) / rowHeight) + overscan);
  const rows: ReactNode[] = [];
  for (let i = first; i < last; i++) {
    rows.push(
      <div key={i} style={{ position: 'absolute', top: i * rowHeight, left: 0, right: 0, height: rowHeight }}>
        {props.renderRow(items[i], i)}
      </div>,
    );
  }
  return (
    <div ref={ref} className={props.className} data-testid={props.testId} style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative', overscrollBehavior: 'contain' }} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>{rows}</div>
    </div>
  );
}
