// 翻页动画缩略图（原版 flip_none/apple/google/hori/vert/fade/hori_shift/vert_shift 的 SVG 重绘，不用 apk 位图）
export function FlipIcon({ kind, size = 36 }: { kind: number; size?: number }) {
  const w = size;
  const h = Math.round(size * 1.25);
  const common = { stroke: 'currentColor', strokeWidth: 1.4, fill: 'none', strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const lines = (x: number, y: number, ww: number, n: number) =>
    Array.from({ length: n }, (_, i) => <line key={i} x1={x} y1={y + i * 4} x2={x + ww} y2={y + i * 4} {...common} strokeWidth={1} opacity={0.5} />);
  return (
    <svg width={w} height={h} viewBox="0 0 36 45" aria-hidden>
      {kind === 0 && (
        <>
          <rect x="6" y="4" width="24" height="37" rx="2" {...common} />
          {lines(10, 11, 16, 6)}
        </>
      )}
      {kind === 1 && (
        <>
          <path d="M6 4h24v24l-11 13H8a2 2 0 0 1-2-2z" {...common} />
          <path d="M30 28l-11 13V30a2 2 0 0 1 2-2z" {...common} fill="currentColor" opacity={0.3} />
          {lines(10, 11, 16, 4)}
        </>
      )}
      {kind === 2 && (
        <>
          <path d="M6 4h24v37H8a2 2 0 0 1-2-2z" {...common} />
          <path d="M30 6c-12 4-12 30 0 33" {...common} />
          {lines(10, 11, 12, 5)}
        </>
      )}
      {kind === 3 && (
        <>
          <rect x="2" y="6" width="17" height="33" rx="2" {...common} />
          <rect x="21" y="6" width="14" height="33" rx="2" {...common} opacity={0.5} />
          <path d="M9 22h20M24 17l5 5-5 5" {...common} />
        </>
      )}
      {kind === 4 && (
        <>
          <rect x="6" y="1" width="24" height="19" rx="2" {...common} />
          <rect x="6" y="24" width="24" height="19" rx="2" {...common} opacity={0.5} />
          <path d="M18 8v28M13 31l5 5 5-5" {...common} />
        </>
      )}
      {kind === 5 && (
        <>
          <rect x="4" y="4" width="22" height="34" rx="2" {...common} />
          <rect x="10" y="8" width="22" height="34" rx="2" {...common} fill="currentColor" opacity={0.25} />
        </>
      )}
      {kind === 6 && (
        <>
          <rect x="3" y="5" width="30" height="35" rx="2" {...common} opacity={0.5} />
          <rect x="3" y="5" width="18" height="35" rx="2" {...common} fill="currentColor" opacity={0.3} />
          <path d="M21 5v35" {...common} strokeWidth={2.4} />
        </>
      )}
      {kind === 7 && (
        <>
          <rect x="6" y="2" width="24" height="41" rx="2" {...common} opacity={0.5} />
          <rect x="6" y="2" width="24" height="22" rx="2" {...common} fill="currentColor" opacity={0.3} />
          <path d="M6 24h24" {...common} strokeWidth={2.4} />
        </>
      )}
    </svg>
  );
}
