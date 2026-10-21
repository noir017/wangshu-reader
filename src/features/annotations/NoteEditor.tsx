// 标注（笔记）编辑器（ANNO-006，原 PrefEditNote）。
// 关闭（点遮罩 / Esc）时：文字改过就自动保存，没改就当取消（照原版 dismiss 行为）。
import { useEffect, useRef, useState } from 'react';
import type { TextRange } from '@/core/book';
import type { AnnotationRecord } from '@/core/library';
import type { ReaderSession } from '@/core/reader-session';
import { Button, confirmDialog, openOverlay, Sheet, toast } from '@/ui';
import { tc } from '../common/messages';
import css from '../common/features.module.css';
import { createHighlight, patchAnnotation, removeAnnotation } from './actions';
import { openHighlightDialog } from './HighlightDialog';
import { removeHlAllByText } from './highlight-all';
import { ta } from './messages';
import { annoSettings, HL_STYLES, styleColorOf } from './settings';

type Result = { kind: 'save'; text: string } | { kind: 'delete' } | { kind: 'color'; text: string } | null;

function Body({ initial, existing, onDone }: { initial: string; existing: boolean; onDone: (r: Result) => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);
  return (
    <Sheet
      open
      position="center"
      title={ta('noteTitle')}
      onClose={() => onDone(text !== initial ? { kind: 'save', text } : null)}
      actions={
        <>
          {existing ? <Button onClick={() => onDone({ kind: 'delete' })}>{tc('delete')}</Button> : <Button onClick={() => onDone(null)}>{tc('cancel')}</Button>}
          {existing && <Button onClick={() => onDone({ kind: 'color', text })}>{ta('color')}</Button>}
          <Button primary onClick={() => onDone({ kind: 'save', text })}>
            {ta('saveNote')}
          </Button>
        </>
      }
    >
      <div className={css.pad}>
        <textarea
          ref={ref}
          className={css.textarea}
          value={text}
          placeholder={ta('notePlaceholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onDone({ kind: 'save', text });
          }}
        />
      </div>
    </Sheet>
  );
}

function ask(initial: string, existing: boolean): Promise<Result> {
  return new Promise((resolve) => {
    openOverlay((close) => (
      <Body
        initial={initial}
        existing={existing}
        onDone={(r) => {
          close();
          resolve(r);
        }}
      />
    ));
  });
}

/** 新建标注：选区 + 笔记文字；空文字等于取消 */
export async function openNewNote(session: ReaderSession, range: TextRange, text: string): Promise<AnnotationRecord | undefined> {
  const r = await ask('', false);
  if (r?.kind !== 'save' || !r.text.trim()) return undefined;
  const s = annoSettings.get();
  const style = HL_STYLES[s.highlightMode] ?? 'highlight';
  const rec = await createHighlight(session, { range, style, color: styleColorOf(s, style), note: r.text, text });
  toast(ta('noteSaved'));
  return rec;
}

/** 编辑已有标注的笔记（可删除标注、改颜色） */
export async function openEditNote(session: ReaderSession, a: AnnotationRecord): Promise<void> {
  const r = await ask(a.note ?? '', true);
  if (!r) return;
  if (r.kind === 'delete') {
    if (await confirmDialog(ta('noteDeleted') + '?')) {
      await removeAnnotation(a.id);
      await removeHlAllByText(session.bookId, a.text);
      toast(ta('noteDeleted'));
    }
    return;
  }
  const note = r.text.trim();
  await patchAnnotation(a.id, { note: note || undefined });
  if (r.kind === 'color') {
    const res = await openHighlightDialog({ initialStyle: a.style, initialColor: a.color, editing: true });
    if (res && 'choice' in res) await patchAnnotation(a.id, { style: res.choice.style, color: res.choice.color });
    else if (res && 'deleted' in res) {
      await removeAnnotation(a.id);
      toast(ta('highlightDeleted'));
    }
    return;
  }
  toast(ta('noteSaved'));
}
