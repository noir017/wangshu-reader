// 浮层定位：贴着选区/点击处，上下自动翻转，左右夹在视口内。

export interface Placement {
  left: number;
  top: number;
  /** 浮层在锚点的上方还是下方（画箭头用） */
  side: 'above' | 'below';
}

export function placeNear(
  anchor: { left: number; right: number; top: number; bottom: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: { gap?: number; margin?: number; prefer?: 'above' | 'below' | 'auto' } = {},
): Placement {
  const gap = opts.gap ?? 8;
  const margin = opts.margin ?? 6;
  const spaceAbove = anchor.top - margin;
  const spaceBelow = viewport.height - anchor.bottom - margin;
  let side: 'above' | 'below';
  if (opts.prefer === 'above') side = spaceAbove >= size.height + gap || spaceAbove >= spaceBelow ? 'above' : 'below';
  else if (opts.prefer === 'below') side = spaceBelow >= size.height + gap || spaceBelow >= spaceAbove ? 'below' : 'above';
  else side = spaceBelow >= size.height + gap ? 'below' : spaceAbove >= size.height + gap ? 'above' : spaceBelow >= spaceAbove ? 'below' : 'above';

  let top = side === 'below' ? anchor.bottom + gap : anchor.top - gap - size.height;
  top = Math.max(margin, Math.min(top, viewport.height - size.height - margin));
  const cx = (anchor.left + anchor.right) / 2;
  let left = cx - size.width / 2;
  left = Math.max(margin, Math.min(left, viewport.width - size.width - margin));
  return { left, top, side };
}
