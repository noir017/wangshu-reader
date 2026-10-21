// 用与正文相同的样式预览一小段文字：高亮=背景色、下划线、删除线、波浪线。
import type { CSSProperties, ReactNode } from 'react';
import type { HighlightStyle } from '@/core/library';

export function styleCss(style: HighlightStyle, color: string): CSSProperties {
  switch (style) {
    case 'underline':
      return { textDecoration: 'underline', textDecorationColor: color, textDecorationThickness: 2, textUnderlineOffset: 3 };
    case 'strikethrough':
      return { textDecoration: 'line-through', textDecorationColor: color, textDecorationThickness: 2 };
    case 'squiggly':
      return { textDecoration: 'underline wavy', textDecorationColor: color, textUnderlineOffset: 3 };
    default:
      return { background: color, borderRadius: 2 };
  }
}

export function StyleSample({ style, color, children }: { style: HighlightStyle; color: string; children: ReactNode }) {
  return <span style={{ padding: '0 3px', ...styleCss(style, color) }}>{children}</span>;
}
