// 目录面板（TOC-001…003）：左侧滑出，标签页 目录 / 书签 / 图片；点条目跳转并关闭。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Search, X } from 'lucide-react';
import { useReaderSession, type ReaderSession } from '@/core/reader-session';
import { IconButton } from '@/ui';
import { offsetOfPoint } from '@/core/text';
import { Drawer } from '../common/Drawer';
import { getSectionDoc } from '../common/section-docs';
import { VirtualList, type VirtualListHandle } from '../common/VirtualList';
import css from './toc.module.css';
import feat from '../common/features.module.css';
import { AnnotTab } from './AnnotTab';
import { ImagesTab } from './ImagesTab';
import { tt } from './messages';
import { tocSettings } from './settings';
import { ancestorKeys, cleanChapterTitle, currentTocIndex, effectiveToc, flattenToc, visibleRows, type FlatToc } from './toc-utils';
import type { AnnotFilter } from '../annotations/model';

export type TocTab = 'toc' | 'bookmarks' | 'images';

export interface TocOpenRequest {
  tab: TocTab;
  filter?: AnnotFilter;
}

const ROW_H = 44;

/** 同章多个目录条目时，用锚点元素的位置区分当前在哪一个 */
function anchorOffsets(flat: FlatToc[], section: number): Map<number, number> {
  const out = new Map<number, number>();
  const doc = getSectionDoc(section);
  if (!doc) return out;
  for (const r of flat) {
    if (r.entry.section !== section || !r.entry.anchor) continue;
    const el = doc.getElementById(r.entry.anchor) ?? doc.getElementsByName(r.entry.anchor)[0];
    if (el) out.set(r.index, offsetOfPoint(doc.body, el, 0));
  }
  return out;
}

export function TocPanel({ req, onClose }: { req: TocOpenRequest; onClose: () => void }) {
  const session = useReaderSession();
  const [tab, setTab] = useState<TocTab>(req.tab);
  const reversed = tocSettings.use((s) => s.chapterReversed);
  const [selectedCount, setSelectedCount] = useState(0);
  const [deleteSelected, setDeleteSelected] = useState<(() => void) | null>(null);
  const hasImages = useImageAvailability(session);

  useEffect(() => setTab(req.tab), [req]);

  return (
    <Drawer
      onClose={onClose}
      testId="toc-panel"
      header={
        <>
          <div className={css.tabs} role="tablist">
            <TabButton active={tab === 'toc'} onClick={() => setTab('toc')} id="toc">
              {tt('toc')}
            </TabButton>
            <TabButton active={tab === 'bookmarks'} onClick={() => setTab('bookmarks')} id="bookmarks">
              {tt('bookmarks')}
            </TabButton>
            {hasImages && (
              <TabButton active={tab === 'images'} onClick={() => setTab('images')} id="images">
                {tt('images')}
              </TabButton>
            )}
          </div>
          {selectedCount > 0 && deleteSelected && (
            <button type="button" className={css.deleteBtn} onClick={deleteSelected} data-testid="delete-selected">
              {tt('deleteSelected')} ({selectedCount})
            </button>
          )}
          <IconButton label={tt('reverse')} active={reversed} onClick={() => tocSettings.set({ chapterReversed: !reversed })}>
            <ArrowUpDown size={19} />
          </IconButton>
          <IconButton label="close" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </>
      }
    >
      {tab === 'toc' && <TocTree session={session} reversed={reversed} onClose={onClose} />}
      {tab === 'bookmarks' && (
        <AnnotTab
          session={session}
          reversed={reversed}
          initialFilter={req.filter}
          onClose={onClose}
          onSelection={(n, del) => {
            setSelectedCount(n);
            setDeleteSelected(() => del);
          }}
        />
      )}
      {tab === 'images' && <ImagesTab session={session} reversed={reversed} onClose={onClose} />}
    </Drawer>
  );
}

function TabButton(p: { active: boolean; onClick: () => void; children: React.ReactNode; id: string }) {
  return (
    <button type="button" role="tab" aria-selected={p.active} data-testid={`tab-${p.id}`} className={css.tab} data-active={p.active ? 'true' : undefined} onClick={p.onClick}>
      {p.children}
    </button>
  );
}

/** 图片标签页仅在书里有图时出现（异步扫描一次，结果缓存） */
function useImageAvailability(session: ReaderSession): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let alive = true;
    void import('./images').then(async ({ bookHasImages }) => {
      const r = await bookHasImages(session.book);
      if (alive) setHas(r);
    });
    return () => {
      alive = false;
    };
  }, [session.book]);
  return has;
}

function TocTree({ session, reversed, onClose }: { session: ReaderSession; reversed: boolean; onClose: () => void }) {
  const { controller, book } = session;
  const toc = useMemo(() => effectiveToc(book), [book]);
  const flat = useMemo(() => flattenToc(toc), [toc]);
  const total = flat.length;
  const loc = controller.getLocation();
  const cur = useMemo(
    () => (loc ? currentTocIndex(flat, { section: loc.locator.section, offset: loc.locator.offset }, anchorOffsets(flat, loc.locator.section), loc.sectionTitle) : -1),
    [flat, loc],
  );
  const parentKeys = useMemo(() => flat.filter((r) => r.hasChildren).map((r) => r.key), [flat]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    // 默认只展开通向当前章的那条路径
    const open = new Set(cur >= 0 ? ancestorKeys(flat, cur) : []);
    return new Set(parentKeys.filter((k) => !open.has(k)));
  });
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const list = useRef<VirtualListHandle>(null);

  const rows = useMemo(() => {
    let r: FlatToc[];
    const q = query.trim().toLowerCase();
    if (q) r = flat.filter((x) => x.entry.title.toLowerCase().includes(q));
    else r = visibleRows(flat, collapsed);
    return reversed ? [...r].reverse() : r;
  }, [flat, collapsed, query, reversed]);

  // 打开时把当前章滚到中间
  const didScroll = useRef(false);
  useEffect(() => {
    if (didScroll.current || cur < 0) return;
    const i = rows.findIndex((r) => r.index === cur);
    if (i >= 0) {
      didScroll.current = true;
      requestAnimationFrame(() => list.current?.scrollToIndex(i, 'center'));
    }
  }, [rows, cur]);

  const go = useCallback(
    (r: FlatToc) => {
      onClose();
      void controller.goTo({ section: r.entry.section, anchor: r.entry.anchor });
    },
    [controller, onClose],
  );

  const toggle = (key: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const allCollapsed = parentKeys.length > 0 && parentKeys.every((k) => collapsed.has(k));
  const sectionLabel = cur >= 0 ? cleanChapterTitle(flat[cur].entry.title, total) : '';

  if (!flat.length) return <div className={feat.empty}>{tt('emptyToc')}</div>;

  return (
    <>
      <div className={css.curLine}>
        <div className={css.curText} title={sectionLabel}>
          {cur >= 0 ? tt('current', { title: sectionLabel, n: cur + 1, total }) : ''}
        </div>
        <IconButton label={tt('search')} active={searching} onClick={() => (setSearching((v) => !v), setQuery(''))} style={{ width: 34, height: 34 }}>
          <Search size={17} />
        </IconButton>
        {parentKeys.length > 0 && (
          <IconButton label={allCollapsed ? tt('expandAll') : tt('collapseAll')} onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(parentKeys))} style={{ width: 34, height: 34 }}>
            {allCollapsed ? <ChevronsUpDown size={17} /> : <ChevronsDownUp size={17} />}
          </IconButton>
        )}
      </div>
      {searching && (
        <div className={css.searchBox}>
          <input autoFocus className={css.searchInput} placeholder={tt('searchHint')} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="toc-search" />
        </div>
      )}
      {rows.length === 0 ? (
        <div className={feat.empty}>{tt('noMatch')}</div>
      ) : (
        <VirtualList
          items={rows}
          rowHeight={ROW_H}
          handle={list}
          testId="toc-list"
          renderRow={(r) => {
            const title = cleanChapterTitle(r.entry.title, total);
            return (
              <div
                className={css.row}
                data-current={r.index === cur ? 'true' : undefined}
                data-testid="toc-row"
                style={{ paddingLeft: query ? 14 : 14 + r.depth * 15 }}
                onClick={() => go(r)}
                role="button"
              >
                {r.hasChildren && !query ? (
                  <button
                    type="button"
                    className={css.arrow}
                    aria-label="toggle"
                    data-testid="toc-toggle"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(r.key);
                    }}
                  >
                    {collapsed.has(r.key) ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  </button>
                ) : (
                  <span className={css.arrowSpace} />
                )}
                <span className={css.title} data-parent={r.hasChildren ? 'true' : undefined} title={title}>
                  {title}
                </span>
                {r.index === cur && <span className={css.mark}>√</span>}
              </div>
            );
          }}
        />
      )}
    </>
  );
}
