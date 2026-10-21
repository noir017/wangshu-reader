// 点击已有标注：笔记气泡 + 改样式/颜色、编辑笔记、复制、分享、删除（ANNO-005，TOC-004 笔记气泡）。
import { useLayoutEffect, useRef, useState } from 'react';
import { Copy, Pencil, Share2, Trash2, Palette } from 'lucide-react';
import { create } from 'zustand';
import type { AnnotationRecord } from '@/core/library';
import type { ReaderSession } from '@/core/reader-session';
import { IconButton, toast } from '@/ui';
import { copyText, shareText } from '../common/clipboard';
import { useFocusAndEscape } from '../common/hooks';
import { placeNear, type Placement } from '../common/position';
import { tc } from '../common/messages';
import css from '../common/features.module.css';
import { patchAnnotation, removeAnnotation } from './actions';
import { openHighlightDialog, STYLE_LABEL } from './HighlightDialog';
import { removeHlAllByText } from './highlight-all';
import { ta } from './messages';
import { openEditNote } from './NoteEditor';
import { annoSettings, HL_STYLES, setStyleColor, styleColorOf } from './settings';
import { findAnnotation, useAnnotations } from './store';
import { StyleSample } from './StyleSample';

interface PopupState {
  session: ReaderSession | null;
  id: string | null;
  rect: DOMRect | null;
}

export const useAnnoPopup = create<PopupState>(() => ({ session: null, id: null, rect: null }));

export function openAnnotationPopup(session: ReaderSession, id: string, rect: DOMRect): void {
  if (findAnnotation(id)) useAnnoPopup.setState({ session, id, rect });
}

export function closeAnnotationPopup(): void {
  useAnnoPopup.setState({ session: null, id: null, rect: null });
}

export function AnnotationPopupHost() {
  const { session, id, rect } = useAnnoPopup();
  const a = useAnnotations((s) => s.items.find((x) => x.id === id));
  if (!session || !a || !rect) return null;
  return <Popup session={session} a={a} rect={rect} />;
}

function Popup({ session, a, rect }: { session: ReaderSession; a: AnnotationRecord; rect: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const presets = annoSettings.use((s) => s.presetColors);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPlace(placeNear(rect, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, { prefer: 'above' }));
  }, [rect, a.note]);

  useFocusAndEscape(ref, closeAnnotationPopup, !!place);

  const apply = async (patch: Partial<AnnotationRecord>) => {
    await patchAnnotation(a.id, patch);
  };

  const remove = async () => {
    closeAnnotationPopup();
    await removeAnnotation(a.id);
    await removeHlAllByText(session.bookId, a.text);
    toast(ta('highlightDeleted'));
  };

  return (
    <>
      <div className={css.floating} style={{ inset: 0, zIndex: 889 }} onPointerDown={closeAnnotationPopup} />
      <div
        ref={ref}
        className={css.bubble}
        data-testid="annotation-popup"
        tabIndex={-1}
        style={{ outline: 'none', width: 'min(92vw, 340px)', left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? 'visible' : 'hidden', zIndex: 901, padding: 8 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {a.note && (
          <div style={{ padding: '4px 6px 8px', whiteSpace: 'pre-wrap', borderBottom: '1px solid var(--mr-border)', marginBottom: 6 }} data-testid="annotation-note">
            {a.note}
          </div>
        )}
        <div className={css.chips} style={{ padding: '2px 0' }}>
          {HL_STYLES.map((st) => (
            <button
              key={st}
              type="button"
              className={css.chip}
              data-active={a.style === st ? 'true' : undefined}
              data-testid={`style-${st}`}
              onClick={() => {
                const color = styleColorOf(annoSettings.get(), st);
                void apply({ style: st, color });
              }}
            >
              <StyleSample style={st} color={a.style === st ? '#ffffffaa' : styleColorOf(annoSettings.get(), st)}>
                {STYLE_LABEL[st]()}
              </StyleSample>
            </button>
          ))}
        </div>
        <div className={css.chips} style={{ padding: '2px 0', gap: 10 }}>
          {presets.map((c, i) => (
            <button
              key={i}
              type="button"
              className={`${css.dot} ${css.swatchBtn}`}
              data-testid={`color-${i}`}
              data-active={a.color.toLowerCase() === c.toLowerCase() ? 'true' : undefined}
              style={{ background: c, width: 26, height: 26 }}
              aria-label={c}
              onClick={() => {
                if (a.style !== 'highlight' || annoSettings.get().highlightStyleAsSelec) setStyleColor(a.style, c);
                void apply({ color: c });
              }}
            />
          ))}
          <IconButton
            label={ta('changeStyle')}
            onClick={async () => {
              closeAnnotationPopup();
              const r = await openHighlightDialog({ initialStyle: a.style, initialColor: a.color, editing: true });
              if (r && 'choice' in r) await apply({ style: r.choice.style, color: r.choice.color });
              else if (r && 'deleted' in r) await remove();
            }}
            style={{ width: 28, height: 28 }}
          >
            <Palette size={16} />
          </IconButton>
        </div>
        <div className={css.row2} style={{ justifyContent: 'space-around', marginTop: 4 }}>
          <IconButton
            label={a.note ? tc('edit') : ta('annotation')}
            onClick={() => {
              closeAnnotationPopup();
              void openEditNote(session, a);
            }}
          >
            <Pencil size={18} />
          </IconButton>
          <IconButton
            label={tc('copy')}
            onClick={async () => {
              toast((await copyText(a.text)) ? tc('copied') : tc('copyFailed'));
              closeAnnotationPopup();
            }}
          >
            <Copy size={18} />
          </IconButton>
          <IconButton
            label={tc('share')}
            onClick={async () => {
              closeAnnotationPopup();
              await shareText(`${a.text}${a.note ? `\n(${a.note})` : ''}`, session.record.title);
            }}
          >
            <Share2 size={18} />
          </IconButton>
          <IconButton label={tc('delete')} onClick={() => void remove()}>
            <Trash2 size={18} />
          </IconButton>
        </div>
      </div>
    </>
  );
}
