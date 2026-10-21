// 高亮对话框（ANNO-004，原 PrefSelectHighlight）：样式单选 + 各样式颜色 + 最近颜色 + 选项。
import { useState } from 'react';
import type { HighlightStyle } from '@/core/library';
import { Button, GroupTitle, openOverlay, Row, Sheet, Switch } from '@/ui';
import { tc } from '../common/messages';
import { pickColor } from './ColorEdit';
import { ta } from './messages';
import { annoSettings, HL_STYLES, setStyleColor, styleColorOf } from './settings';
import css from '../common/features.module.css';
import { StyleSample } from './StyleSample';

export const STYLE_LABEL: Record<HighlightStyle, () => string> = {
  highlight: () => ta('highlight'),
  underline: () => ta('underline'),
  strikethrough: () => ta('strikethrough'),
  squiggly: () => ta('squiggly'),
};

export interface HighlightChoice {
  style: HighlightStyle;
  color: string;
  /** 「高亮显示本书所有的“xxx”」是否勾选 */
  highlightAll: boolean;
}

interface Props {
  /** 当前样式（改已有标注时为它的样式） */
  initialStyle: HighlightStyle;
  initialColor?: string;
  /** 选中的原文；有值才显示「高亮本书所有…」 */
  text?: string;
  /** 是否在改已有标注：取消按钮变删除 */
  editing: boolean;
  onDone: (r: { choice: HighlightChoice } | { deleted: true } | null) => void;
}

function Body({ initialStyle, initialColor, text, editing, onDone }: Props) {
  const s = annoSettings.use((x) => x);
  const [style, setStyle] = useState<HighlightStyle>(initialStyle);
  // 本次对话框里各样式的颜色（改已有标注时，当前样式用它自己的颜色）
  const [colors, setColors] = useState<Record<HighlightStyle, string>>(() => {
    const c = {} as Record<HighlightStyle, string>;
    for (const st of HL_STYLES) c[st] = styleColorOf(s, st);
    if (initialColor) c[initialStyle] = initialColor;
    return c;
  });
  const [all, setAll] = useState(false);

  const setColor = (st: HighlightStyle, c: string) => {
    setColors((x) => ({ ...x, [st]: c }));
    // 原 app：非背景样式总是同步全局色；背景样式只在「使用最后标注类型」打开时同步
    if (st !== 'highlight' || s.highlightStyleAsSelec) setStyleColor(st, c);
  };

  const swapRecent = (i: number) => {
    const presets = [...s.presetColors];
    const picked = presets[i];
    presets[i] = colors[style];
    annoSettings.set({ presetColors: presets });
    setColor(style, picked);
  };

  return (
    <Sheet
      open
      position="center"
      title={ta('highlightTitle')}
      onClose={() => onDone(null)}
      actions={
        <>
          <Button onClick={() => onDone(editing ? { deleted: true } : null)}>{editing ? tc('delete') : tc('cancel')}</Button>
          <Button primary onClick={() => onDone({ choice: { style, color: colors[style], highlightAll: all } })}>
            {tc('ok')}
          </Button>
        </>
      }
    >
      {HL_STYLES.map((st) => (
        <Row
          key={st}
          title={
            <label className={css.row2} style={{ cursor: 'pointer' }}>
              <input type="radio" name="hl-style" checked={style === st} onChange={() => setStyle(st)} />
              <StyleSample style={st} color={colors[st]}>
                {STYLE_LABEL[st]()}
              </StyleSample>
            </label>
          }
          right={
            <button
              type="button"
              className={`${css.dot} ${css.swatchBtn}`}
              style={{ background: colors[st], width: 28, height: 28 }}
              aria-label={`${STYLE_LABEL[st]()} ${ta('color')}`}
              onClick={async () => {
                const c = await pickColor(ta('pickColor'), colors[st]);
                if (c) {
                  setStyle(st);
                  setColor(st, c);
                }
              }}
            />
          }
        />
      ))}
      <GroupTitle>{ta('recentColors')}</GroupTitle>
      <div className={css.chips} style={{ gap: 12, padding: '4px 16px 8px' }}>
        {s.presetColors.slice(0, 3).map((c, i) => (
          <button key={i} type="button" className={`${css.dot} ${css.swatchBtn}`} style={{ background: c, width: 30, height: 30 }} aria-label={c} onClick={() => swapRecent(i)} />
        ))}
      </div>
      <Row title={ta('lastStyle')} onClick={() => annoSettings.set({ highlightStyleAsSelec: !s.highlightStyleAsSelec })} right={<Switch checked={s.highlightStyleAsSelec} onChange={(v) => annoSettings.set({ highlightStyleAsSelec: v })} />} />
      <Row title={ta('directHighlight')} onClick={() => annoSettings.set({ directHighlight: !s.directHighlight })} right={<Switch checked={s.directHighlight} onChange={(v) => annoSettings.set({ directHighlight: v })} />} />
      <Row title={ta('magnifier')} onClick={() => annoSettings.set({ showMagnifier: !s.showMagnifier })} right={<Switch checked={s.showMagnifier} onChange={(v) => annoSettings.set({ showMagnifier: v })} />} />
      <Row title={ta('showTemplate')} onClick={() => annoSettings.set({ showColorTemplate: !s.showColorTemplate })} right={<Switch checked={s.showColorTemplate} onChange={(v) => annoSettings.set({ showColorTemplate: v })} />} />
      {text && !editing && (
        <Row
          title={ta('highlightAll', { text: text.length > 24 ? text.slice(0, 24) + '…' : text })}
          onClick={() => setAll((v) => !v)}
          right={<Switch checked={all} onChange={setAll} />}
        />
      )}
    </Sheet>
  );
}

/** 弹出高亮对话框。取消/关闭 → null；删除（仅 editing）→ { deleted } */
export function openHighlightDialog(p: Omit<Props, 'onDone'>): Promise<{ choice: HighlightChoice } | { deleted: true } | null> {
  return new Promise((resolve) => {
    openOverlay((close) => (
      <Body
        {...p}
        onDone={(r) => {
          close();
          resolve(r);
        }}
      />
    ));
  });
}
