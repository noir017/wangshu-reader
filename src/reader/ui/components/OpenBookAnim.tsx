// 打开书动画（ANIM-012，原 FlipImageView type −100）：黑底上的封面从中缝向左右两侧分开，露出正文。
// 原版只在「仿真翻页 + 竖屏」时启用；时长 600 − flipSpeed·10 ms，位移 W/2·(t/T)²（先慢后快，即 ease-in 二次曲线）。
import { useEffect, useState } from 'react';
import { getCover } from '@/storage/db';
import { FlipAnimation, flipSettings, screenSettings } from '@/reader/settings';

/** 这次打开要不要播（在挂载时判断一次：设置开着、仿真翻页、竖屏） */
export function wantOpenBookAnim(): boolean {
  return screenSettings.get().openBookAnim && flipSettings.get().flipAnimation === FlipAnimation.Curl && window.innerHeight > window.innerWidth;
}

/** start=false 时停在合拢状态（书还在加载），true 时开始分开；没有封面或播完调 onDone */
export function OpenBookAnim({ bookId, start, onDone }: { bookId: string; start: boolean; onDone: () => void }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    let u: string | null = null;
    void (async () => {
      const blob = (await getCover(bookId, 'cover').catch(() => undefined)) ?? (await getCover(bookId, 'thumb').catch(() => undefined));
      if (!alive) return;
      u = blob ? URL.createObjectURL(blob) : null;
      setUrl(u);
    })();
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [bookId]);
  // 没有封面：直接结束（不放一块黑屏）
  useEffect(() => {
    if (url === null) onDone();
  }, [url, onDone]);
  const ms = Math.max(150, 600 - flipSettings.get().flipSpeed * 10);
  // 合拢状态至少画出一帧再开始分开，过渡才会生效；transitionend 万一没来（标签页在后台）也按时结束
  const [go, setGo] = useState(false);
  useEffect(() => {
    if (!url || !start) return;
    let r = requestAnimationFrame(() => (r = requestAnimationFrame(() => setGo(true))));
    const timer = setTimeout(onDone, ms + 400);
    return () => {
      cancelAnimationFrame(r);
      clearTimeout(timer);
    };
  }, [url, start, ms, onDone]);
  if (!url) return null;
  const half = (side: 'left' | 'right') => ({
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    [side]: 0,
    width: '50%',
    backgroundImage: `url("${url}")`,
    backgroundSize: '200% 100%',
    backgroundPosition: side === 'left' ? 'left center' : 'right center',
    backgroundRepeat: 'no-repeat',
    transform: go ? `translateX(${side === 'left' ? '-100%' : '100%'})` : 'none',
    transition: `transform ${ms}ms cubic-bezier(0.55, 0.085, 0.68, 0.53)`,
  });
  return (
    <div
      data-testid="open-book-anim"
      aria-hidden
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: go ? 'transparent' : '#000', pointerEvents: 'none', overflow: 'hidden', transition: `background ${ms}ms` }}
    >
      <div style={half('left')} />
      <div style={half('right')} onTransitionEnd={(e) => e.propertyName === 'transform' && onDone()} />
    </div>
  );
}
