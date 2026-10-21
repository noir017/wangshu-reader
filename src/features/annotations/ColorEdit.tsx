// 取色弹层：预设色块 + 原生取色器 + 十六进制 + 不透明度滑块（原 app 的颜色带 alpha）。
import { useState } from 'react';
import { Button, ColorPicker, Sheet, Slider } from '@/ui';
import { openOverlay } from '@/ui';
import { alphaOf, rgbOf, withAlpha, parseCssColor } from '../common/colors';
import { tc } from '../common/messages';
import { ta } from './messages';

/** 面向标注的色板：常用荧光色 + 灰/黑，和原 app 的取色器预设相近 */
export const ANNOTATION_PALETTE = [
  '#ffeb3b', '#ff9200', '#f44336', '#e91e63', '#cc99c0', '#9c27b0', '#00aaff', '#2196f3',
  '#4caf50', '#99aa77', '#00ff00', '#8bc34a', '#555555', '#888888', '#000000', '#ffffff',
];

function ColorEditBody({ title, initial, onDone }: { title: string; initial: string; onDone: (c: string | null) => void }) {
  const [rgb, setRgb] = useState(rgbOf(initial));
  const [alpha, setAlpha] = useState(Math.round(alphaOf(initial) * 100));
  const value = withAlpha(rgb, alpha / 100);
  return (
    <Sheet
      open
      position="center"
      title={title}
      onClose={() => onDone(null)}
      actions={
        <>
          <Button onClick={() => onDone(null)}>{tc('cancel')}</Button>
          <Button primary onClick={() => onDone(value)}>
            {tc('ok')}
          </Button>
        </>
      }
    >
      <ColorPicker
        value={rgb}
        presets={ANNOTATION_PALETTE}
        onChange={(c) => {
          const p = parseCssColor(c);
          if (p) setRgb(rgbOf(c));
        }}
      />
      <Slider label={ta('alpha')} value={alpha} min={5} max={100} step={5} format={(v) => `${v}%`} onChange={setAlpha} />
      <div style={{ padding: '4px 16px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 56, height: 26, borderRadius: 6, border: '1px solid var(--mr-border)', background: value }} />
        <span style={{ fontSize: 13, color: 'var(--mr-muted)' }}>{value}</span>
      </div>
    </Sheet>
  );
}

/** 弹出取色器，确定返回 #rrggbb[aa]，取消返回 null */
export function pickColor(title: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    openOverlay((close) => (
      <ColorEditBody
        title={title}
        initial={initial}
        onDone={(c) => {
          close();
          resolve(c);
        }}
      />
    ));
  });
}
