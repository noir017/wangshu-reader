// 选择工具条（ANNO-002）：监听引擎 selection 事件，在选区上/下方弹出。
// 前 4 个按钮常驻，其余收进「⋯」菜单；长按「高亮」= 按上次样式直接高亮，长按「词典」= 词典 2。
// 工具条上方可选「颜色快速选择模板」（上行 4 个样式、下行 5 个预设色，长按改色）。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Copy, BookText, Ellipsis, Highlighter, Languages, Globe, History, PenLine, Search, Share2, Volume2, Info } from 'lucide-react';
import { useReaderSession, type ReaderSession } from '@/core/reader-session';
import type { HighlightStyle } from '@/core/library';
import type { ReaderSelection } from '@/core/reader';
import { popupMenu, toast } from '@/ui';
import { copyText, normalizeSelectedText, selectedWordOf, shareText } from '../common/clipboard';
import { useBus, useControllerEvent } from '../common/hooks';
import { placeNear, type Placement } from '../common/position';
import { getSectionText } from '../common/section-text';
import { hitTestPoint } from '../common/hit-test';
import { tc } from '../common/messages';
import css from '../common/features.module.css';
import { lookupWord, openWebSearch, openWikipedia, translateSelection } from '../dict/lookup';
import { dictSettings } from '../dict/settings';
import { openDictHistory, openDictSettings } from '../dict/Dialogs';
import { speakText } from '../tts/api';
import { createHighlight, patchAnnotation, removeAnnotation } from './actions';
import { barItemLabel } from './bar-labels';
import { pickColor } from './ColorEdit';
import { openHighlightDialog, STYLE_LABEL } from './HighlightDialog';
import { removeHlAllByText, upsertHlAll } from './highlight-all';
import { ta } from './messages';
import { openEditNote, openNewNote } from './NoteEditor';
import { annoSettings, HL_STYLES, setStyleColor, styleColorOf } from './settings';
import { currentAnnotations } from './store';
import { selectBarSettings, splitBar, type SelectItemId } from './toolbar-config';
import { firstSentenceFrom, wordRangeAt } from './select-word';
import { StyleSample } from './StyleSample';
import { useHandleDrag } from './handle-state';
import { peekLocation, peekSelection } from '../common/safe';

const ICONS: Record<SelectItemId, ReactNode> = {
  copy: <Copy size={16} />,
  highlight: <Highlighter size={16} />,
  note: <PenLine size={16} />,
  dict: <BookText size={16} />,
  speak: <Volume2 size={16} />,
  share: <Share2 size={16} />,
  search: <Search size={16} />,
  translate: <Languages size={16} />,
  wiki: <Globe size={16} />,
  websearch: <Globe size={16} />,
  history: <History size={16} />,
};

const LONG_PRESS_MS = 500;

/** 带长按的按钮：按住 500ms 触发 onLong（之后的抬起不再算点击） */
function PressButton(p: { onClick: (el: HTMLElement) => void; onLong?: () => void; children: ReactNode; className?: string; testId?: string; title?: string; active?: boolean }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fired = useRef(false);
  const clear = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  return (
    <button
      type="button"
      className={p.className}
      data-testid={p.testId}
      data-active={p.active ? 'true' : undefined}
      title={p.title}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
        if (p.onLong) {
          timer.current = setTimeout(() => {
            fired.current = true;
            p.onLong!();
          }, LONG_PRESS_MS);
        }
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        if (fired.current) {
          fired.current = false;
          return;
        }
        p.onClick(e.currentTarget);
      }}
    >
      {p.children}
    </button>
  );
}

/** 选区对应的已有高亮（范围完全一致）；改样式/删除时用 */
function sameRangeAnnotation(sel: ReaderSelection) {
  return currentAnnotations().find(
    (a) => a.kind === 'highlight' && !a.deletedAt && a.range.section === sel.range.section && a.range.start === sel.range.start && a.range.end === sel.range.end,
  );
}

/** 用指定样式+颜色创建/覆盖高亮，并同步全局色（原 doHighlight2） */
async function applyHighlight(session: ReaderSession, sel: ReaderSelection, style: HighlightStyle, color: string): Promise<void> {
  const s = annoSettings.get();
  if (style !== 'highlight' || s.highlightStyleAsSelec) setStyleColor(style, color);
  annoSettings.set({ highlightMode: Math.max(0, HL_STYLES.indexOf(style)) });
  const old = sameRangeAnnotation(sel);
  if (old) await patchAnnotation(old.id, { style, color });
  else await createHighlight(session, { range: sel.range, style, color, text: sel.text });
  session.controller.setSelection(null);
}

async function doHighlight(session: ReaderSession, sel: ReaderSelection, direct: boolean): Promise<void> {
  const s = annoSettings.get();
  const old = sameRangeAnnotation(sel);
  if (direct && !old) {
    const style = HL_STYLES[s.highlightMode] ?? 'highlight';
    await applyHighlight(session, sel, style, styleColorOf(s, style));
    toast(ta('highlightSaved'));
    return;
  }
  const r = await openHighlightDialog({
    initialStyle: old?.style ?? HL_STYLES[s.highlightMode] ?? 'highlight',
    initialColor: old?.color,
    text: normalizeSelectedText(sel.text),
    editing: !!old,
  });
  if (!r) return; // 取消：保留选区
  if ('deleted' in r) {
    if (old) {
      await removeAnnotation(old.id);
      await removeHlAllByText(session.bookId, old.text);
    }
    session.controller.setSelection(null);
    return;
  }
  await applyHighlight(session, sel, r.choice.style, r.choice.color);
  if (r.choice.highlightAll) await upsertHlAll(session.bookId, { text: normalizeSelectedText(sel.text), style: r.choice.style, color: r.choice.color });
}

export function SelectionToolbar() {
  const session = useReaderSession();
  const { controller } = session;
  const [sel, setSel] = useState<ReaderSelection | null>(() => peekSelection(controller));
  const [place, setPlace] = useState<Placement | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const barItems = selectBarSettings.use((s) => s.items);
  const showTpl = annoSettings.use((s) => s.showColorTemplate);
  const direct = annoSettings.use((s) => s.directHighlight);
  const openDictDirect = dictSettings.use((s) => s.openDictDirect);
  const mode = annoSettings.use((s) => s.highlightMode);
  const presets = annoSettings.use((s) => s.presetColors);
  // 选择器必须返回稳定引用：每次新建数组会让 zustand 判定状态一直在变，进入无限重渲染
  const anno = annoSettings.use((s) => s);
  const styleColors = [anno.highlightColor, anno.underlineColor, anno.strikethroughColor, anno.squigglyColor] as const;
  const { main, more } = useMemo(() => splitBar(barItems), [barItems]);
  const dragging = useHandleDrag((s) => s.dragging);

  useControllerEvent('selection', (s) => setSel(s && s.text.trim() ? s : null));

  const selText = sel?.text ?? '';
  const clearSel = useCallback(() => controller.setSelection(null), [controller]);

  // 「允许长按+拖动直接标注」：选区稳定 700ms 后直接标注。「选词后立即打开词典」同理，稳定 450ms 后查词
  useEffect(() => {
    if (!sel || !(direct || openDictDirect)) return;
    const t = setTimeout(
      () => {
        if (direct) void doHighlight(session, sel, true);
        else {
          lookupWord(session, sel.text, { rect: sel.rect, range: sel.range });
          clearSel();
        }
      },
      direct ? 700 : 450,
    );
    return () => clearTimeout(t);
  }, [sel, direct, openDictDirect, session, clearSel]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!sel || !el) return setPlace(null);
    setPlace(placeNear(sel.rect, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, { prefer: 'above', gap: 10 }));
  }, [sel, showTpl, main.length, more.length]);

  // selection.start：由 reader/ui 的「选择文本」动作触发。有坐标 → 取该点的词；没有 → 选页首第一句
  useBus('selection.start', ({ x, y }) => void startSelection(session, x, y));

  const run = useCallback(
    (id: SelectItemId) => {
      if (!sel) return;
      const text = selectedWordOf(session.book.kind, sel.text);
      switch (id) {
        case 'copy':
          void copyText(text).then((ok) => toast(ok ? ta('copiedNote') : tc('copyFailed')));
          clearSel();
          break;
        case 'highlight':
          void doHighlight(session, sel, false);
          break;
        case 'note': {
          const old = sameRangeAnnotation(sel);
          clearSel();
          if (old) void openEditNote(session, old);
          else void openNewNote(session, sel.range, sel.text);
          break;
        }
        case 'dict':
          lookupWord(session, text, { rect: sel.rect, range: sel.range });
          clearSel();
          break;
        case 'speak':
          speakText(session, text);
          clearSel();
          break;
        case 'share':
          void shareText(text, ta('sharePage', { title: session.record.title }));
          clearSel();
          break;
        case 'search':
          session.bus.emit('search.open', { query: text });
          clearSel();
          break;
        case 'translate':
          translateSelection(session, text, sel.rect);
          clearSel();
          break;
        case 'wiki':
          openWikipedia(session, text);
          clearSel();
          break;
        case 'websearch':
          openWebSearch(text);
          clearSel();
          break;
        case 'history':
          openDictHistory(session);
          break;
      }
    },
    [sel, session, clearSel],
  );

  if (!sel) return null;

  const openMore = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    popupMenu(r.left, r.bottom + 4, [
      ...more.map((id) => ({ label: barItemLabel(id), icon: ICONS[id], onSelect: () => run(id) })),
      { label: ta('customize'), icon: <Info size={16} />, onSelect: () => openDictSettings(session) },
    ]);
  };

  const tplRowStyle = (i: number) => annoSettings.get()[(['highlightColor', 'underlineColor', 'strikethroughColor', 'squigglyColor'] as const)[i]];

  return createPortal(
    <div
      ref={ref}
      className={css.floating}
      data-testid="selection-toolbar"
      style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place && !dragging ? 'visible' : 'hidden' }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {showTpl && (
        <div className={css.template} data-testid="color-template">
          {HL_STYLES.map((st, i) => (
            <PressButton
              key={st}
              className={css.tplCell}
              testId={`tpl-style-${st}`}
              active={mode === i}
              title={STYLE_LABEL[st]()}
              onClick={() => void applyHighlight(session, sel, st, tplRowStyle(i)).then(() => toast(ta('highlightSaved')))}
              onLong={async () => {
                const c = await pickColor(`${STYLE_LABEL[st]()} ${ta('color')}`, tplRowStyle(i));
                if (c) setStyleColor(st, c);
              }}
            >
              <StyleSample style={st} color={styleColors[i]}>
                A
              </StyleSample>
            </PressButton>
          ))}
          <button type="button" className={css.tplCell} title={ta('templateTip')} onClick={() => toast(ta('templateTip'))}>
            <Info size={15} />
          </button>
          {presets.map((c, i) => (
            <PressButton
              key={i}
              className={css.tplCell}
              testId={`tpl-color-${i}`}
              title={c}
              onClick={() => void applyHighlight(session, sel, HL_STYLES[mode] ?? 'highlight', c).then(() => toast(ta('highlightSaved')))}
              onLong={async () => {
                const next = await pickColor(ta('pickColor'), c);
                if (next) annoSettings.set({ presetColors: presets.map((x, j) => (j === i ? next : x)) });
              }}
            >
              <span className={css.tplColor} style={{ background: c, width: 22, height: 22 }} />
            </PressButton>
          ))}
        </div>
      )}
      <div className={css.bar} role="toolbar" aria-label={ta('highlight')}>
        {main.map((id) => (
          <PressButton
            key={id}
            className={css.barBtn}
            testId={`sel-${id}`}
            onClick={() => run(id)}
            onLong={
              id === 'highlight'
                ? () => void doHighlight(session, sel, true)
                : id === 'dict'
                  ? () => {
                      lookupWord(session, selText, { second: true, rect: sel.rect, range: sel.range });
                      clearSel();
                    }
                  : undefined
            }
          >
            {barItemLabel(id)}
          </PressButton>
        ))}
        <PressButton className={css.barBtn} testId="sel-more" title={ta('more')} onClick={openMore}>
          <Ellipsis size={18} />
        </PressButton>
      </div>
    </div>,
    document.body,
  );
}

/** 在 (x,y) 处选词；没有坐标则选当前页首第一句。引擎没有 hitTest 接口，这里用 caretPositionFromPoint 在已知章节文档里反查 */
async function startSelection(session: ReaderSession, x?: number, y?: number): Promise<void> {
  const { controller } = session;
  const loc = peekLocation(controller);
  const oneChar = dictSettings.get().oneCharDict;
  const locale = session.book.metadata.language;

  if (x !== undefined && y !== undefined) {
    // 0..1 视为阅读区归一化坐标，否则是视口像素
    const px = x <= 1 && y <= 1 ? x * window.innerWidth : x;
    const py = x <= 1 && y <= 1 ? y * window.innerHeight : y;
    const hit = hitTestPoint(px, py);
    if (hit && loc) {
      const text = await getSectionText(controller, hit.section).catch(() => '');
      const r = wordRangeAt(text, hit.offset, { oneChar, locale });
      if (r) {
        controller.setSelection({ section: hit.section, start: r.start, end: r.end });
        return;
      }
    }
  }
  if (!loc) return;
  const text = await getSectionText(controller, loc.visible.section).catch(() => '');
  const r = firstSentenceFrom(text, loc.visible.start);
  if (r) controller.setSelection({ section: loc.visible.section, start: r.start, end: r.end });
}
