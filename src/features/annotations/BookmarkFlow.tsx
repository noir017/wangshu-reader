// 书签（ANNO-007）：当前页已有书签则删除，否则新建（默认名 = 「(进度%) 页首文字...」，可先弹窗命名）。
// 页面右上角的 40×40 书签角标也在这里：点按切换书签，已有书签时画出旗标。
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark } from 'lucide-react';
import type { Locator, TextRange } from '@/core/book';
import type { AnnotationRecord } from '@/core/library';
import type { ReaderSession } from '@/core/reader-session';
import { useReaderSession } from '@/core/reader-session';
import { Button, openOverlay, popupMenu, Row, Sheet, Switch, TextInput, toast } from '@/ui';
import { formatDateTime } from '../common/format';
import { isCjkText } from '../common/format';
import { useControllerEvent } from '../common/hooks';
import { getSectionText } from '../common/section-text';
import { tc } from '../common/messages';
import { createBookmark, removeAnnotation, patchAnnotation } from './actions';
import { generateBookmarkName } from './bookmark-name';
import { pickColor } from './ColorEdit';
import { ta } from './messages';
import { annoSettings, bookmarkColorOf } from './settings';
import { currentAnnotations, useAnnotations } from './store';
import css from '../common/features.module.css';
import { currentLang } from '@/core/i18n';
import { peekLocation } from '../common/safe';

/** 书签角标是否算「在当前页」：书签位置落在可见区间内 */
export function bookmarksOnPage(list: AnnotationRecord[], visible: TextRange | undefined): AnnotationRecord[] {
  if (!visible) return [];
  return list.filter((a) => a.kind === 'bookmark' && !a.deletedAt && a.range.section === visible.section && a.range.start >= visible.start && a.range.start <= Math.max(visible.end, visible.start));
}

interface BookmarkDialogResult {
  name: string;
  color: string;
}

function BookmarkDialogBody({ initialName, initialColor, title, showNever, onDone }: { initialName: string; initialColor: string; title: string; showNever: boolean; onDone: (r: BookmarkDialogResult | null) => void }) {
  const s = annoSettings.use((x) => x);
  const [name, setName] = useState(initialName);
  const [useColor, setUseColor] = useState(initialColor !== '');
  const [color, setColor] = useState(initialColor || s.bookmarkColor);
  const [never, setNever] = useState(false);
  const done = () => {
    // 新建时把这次的选择记成默认（原 app 行为）；编辑已有书签不动全局设置
    if (showNever) {
      if (never) annoSettings.set({ bookmarkManually: false });
      annoSettings.set({ bookmarkNoColor: !useColor, ...(useColor ? { bookmarkColor: color } : {}) });
    }
    onDone({ name: name.trim() || initialName, color: useColor ? color : '' });
  };
  return (
    <Sheet
      open
      position="center"
      title={title}
      onClose={() => onDone(null)}
      actions={
        <>
          <Button onClick={() => onDone(null)}>{tc('cancel')}</Button>
          <Button primary onClick={done}>
            {tc('ok')}
          </Button>
        </>
      }
    >
      <div className={css.pad}>
        <TextInput value={name} onChange={setName} autoFocus onEnter={done} placeholder={ta('bookmarkName')} />
      </div>
      <Row
        title={ta('bookmarkColor')}
        onClick={() => setUseColor((v) => !v)}
        right={
          <>
            {useColor && (
              <button
                type="button"
                className={`${css.dot} ${css.swatchBtn}`}
                style={{ background: color, width: 26, height: 26 }}
                aria-label={ta('bookmarkColor')}
                onClick={async (e) => {
                  e.stopPropagation();
                  const c = await pickColor(ta('pickColor'), color);
                  if (c) setColor(c);
                }}
              />
            )}
            <Switch checked={useColor} onChange={setUseColor} />
          </>
        }
      />
      {showNever && <Row title={ta('askNever')} onClick={() => setNever((v) => !v)} right={<Switch checked={never} onChange={setNever} />} />}
    </Sheet>
  );
}

export function openBookmarkDialog(title: string, initialName: string, initialColor: string, showNever = true): Promise<BookmarkDialogResult | null> {
  return new Promise((resolve) => {
    openOverlay((close) => (
      <BookmarkDialogBody
        title={title}
        initialName={initialName}
        initialColor={initialColor}
        showNever={showNever}
        onDone={(r) => {
          close();
          resolve(r);
        }}
      />
    ));
  });
}

/** 编辑已有书签的名称与颜色 */
export async function editBookmark(a: AnnotationRecord): Promise<void> {
  const r = await openBookmarkDialog(ta('editBookmark'), a.title ?? '', a.color, false);
  if (r) {
    await patchAnnotation(a.id, { title: r.name, color: r.color });
    toast(ta('bookmarkSaved'));
  }
}

/**
 * 切换书签：位置（at 或当前页首）上已有书签 → 删除；否则新建。
 * silent=true 时不弹命名对话框（书签列表里长按「增加新书签」）；addOnly=true 时已有书签不删除，只提示。
 */
export async function toggleBookmark(session: ReaderSession, opts: { at?: Locator; silent?: boolean; addOnly?: boolean } = {}): Promise<void> {
  const { controller } = session;
  const loc = peekLocation(controller);
  const list = currentAnnotations();
  let at = opts.at;
  if (!at) {
    if (!loc) return;
    at = { section: loc.visible.section, offset: loc.visible.start };
    const onPage = bookmarksOnPage(list, loc.visible);
    if (onPage.length && opts.addOnly) {
      toast(ta('bookmarkExists'));
      return;
    }
    if (onPage.length) {
      for (const b of onPage) await removeAnnotation(b.id);
      toast(ta('bookmarkRemoved'));
      return;
    }
  } else {
    const same = list.find((a) => a.kind === 'bookmark' && !a.deletedAt && a.range.section === at!.section && a.range.start === at!.offset);
    if (same && opts.addOnly) {
      toast(ta('bookmarkExists'));
      return;
    }
    if (same) {
      await removeAnnotation(same.id);
      toast(ta('bookmarkRemoved'));
      return;
    }
  }
  const secText = await getSectionText(controller, at.section).catch(() => '');
  const s = annoSettings.get();
  const name = generateBookmarkName({
    sectionText: secText,
    offset: at.offset,
    progress: loc && loc.visible.section === at.section ? loc.progress : 0,
    chinese: currentLang() === 'zh' || isCjkText(secText.slice(at.offset, at.offset + 60)),
    fallback: formatDateTime(Date.now()),
  });
  let title = name;
  let color = bookmarkColorOf(s);
  if (s.bookmarkManually && !opts.silent) {
    const r = await openBookmarkDialog(ta('addBookmark'), name, color);
    if (!r) return;
    title = r.name;
    color = r.color;
  }
  await createBookmark(session, at, title, color);
  toast(ta('bookmarkAdded'));
}

/** 页面右上角书签角标 */
export function BookmarkCorner() {
  const session = useReaderSession();
  const { controller } = session;
  const [visible, setVisible] = useState<TextRange | undefined>(() => peekLocation(controller)?.visible);
  useControllerEvent('relocate', (loc) => setVisible(loc.visible));
  const items = useAnnotations((s) => s.items);
  const enabled = annoSettings.use((s) => s.bookmarkCorner);
  if (!enabled) return null;
  const marks = bookmarksOnPage(items, visible);
  const marked = marks.length > 0;
  const color = marks.find((m) => m.color)?.color ?? 'var(--mr-accent)';
  return createPortal(
    <button
      type="button"
      className={css.floating}
      data-testid="bookmark-corner"
      data-marked={marked ? 'true' : 'false'}
      aria-label={ta('addBookmark')}
      style={{
        top: 'env(safe-area-inset-top, 0px)',
        right: 0,
        width: 40,
        height: 40,
        zIndex: 20,
        border: 'none',
        background: 'transparent',
        padding: 0,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (!marked) return void toggleBookmark(session);
        // 已有书签时角标是画出来的旗子（可视书签）：点它弹「编辑 / 删除」（ANNO-007）
        const r = e.currentTarget.getBoundingClientRect();
        popupMenu(r.right - 180, r.bottom, [
          { label: tc('edit'), onSelect: () => void editBookmark(marks[0]) },
          {
            label: tc('delete'),
            onSelect: async () => {
              for (const b of marks) await removeAnnotation(b.id);
              toast(ta('bookmarkRemoved'));
            },
          },
        ]);
      }}
    >
      {marked && <Bookmark size={26} fill={color} color={color} style={{ marginTop: -2, filter: 'drop-shadow(0 1px 1px rgb(0 0 0 / 0.35))' }} />}
    </button>,
    document.body,
  );
}
