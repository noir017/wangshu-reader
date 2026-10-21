// 搜索对话框 + 导航面板（SRCH-001/002/003/005）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, CornerUpLeft, History, List, Loader2, Search, Settings2, X } from 'lucide-react';
import { appSettings } from '@/core/app-settings';
import { useReaderSession, type ReaderSession } from '@/core/reader-session';
import { Button, IconButton, openOverlay, Row, Sheet, Switch } from '@/ui';
import { VirtualList } from '../common/VirtualList';
import { useLinkBack } from '../common/linkback';
import { tc } from '../common/messages';
import { percentStr } from '../common/format';
import css from './search.module.css';
import { MAX_RESULTS } from './engine';
import { clearSearchHistory, getSearchHistory } from './history';
import { ts } from './messages';
import { backToBeforeSearch, cancelSearch, closeNavPanel, closeSearchDialog, gotoResult, startSearch, stepResult, useSearch } from './run';
import { searchSettings } from './settings';

function OptionsDialog({ close }: { close: () => void }) {
  const s = searchSettings.use((x) => x);
  return (
    <Sheet open position="center" title={ts('options')} onClose={close} actions={<Button primary onClick={close}>{tc('ok')}</Button>}>
      <Row title={ts('caseSensitive')} onClick={() => searchSettings.set({ caseSensitive: !s.caseSensitive })} right={<Switch checked={s.caseSensitive} onChange={(v) => searchSettings.set({ caseSensitive: v })} />} />
      <Row title={ts('wholeWord')} onClick={() => searchSettings.set({ wholeWord: !s.wholeWord })} right={<Switch checked={s.wholeWord} onChange={(v) => searchSettings.set({ wholeWord: v })} />} />
      <Row title={ts('backward')} onClick={() => searchSettings.set({ backwardOnly: !s.backwardOnly, forwardOnly: false })} right={<Switch checked={s.backwardOnly} onChange={(v) => searchSettings.set({ backwardOnly: v, forwardOnly: false })} />} />
      <Row title={ts('forward')} onClick={() => searchSettings.set({ forwardOnly: !s.forwardOnly, backwardOnly: false })} right={<Switch checked={s.forwardOnly} onChange={(v) => searchSettings.set({ forwardOnly: v, backwardOnly: false })} />} />
      <Row title={ts('regex')} onClick={() => searchSettings.set({ regex: !s.regex })} right={<Switch checked={s.regex} onChange={(v) => searchSettings.set({ regex: v })} />} />
    </Sheet>
  );
}

function HistoryDialog({ close, onPick }: { close: () => void; onPick: (k: string) => void }) {
  const [list, setList] = useState<string[] | null>(null);
  useEffect(() => {
    void getSearchHistory().then(setList);
  }, []);
  return (
    <Sheet
      open
      position="center"
      title={ts('history')}
      onClose={close}
      headerRight={
        <Button
          disabled={!list?.length}
          onClick={async () => {
            await clearSearchHistory();
            setList([]);
          }}
        >
          {ts('clearHistory')}
        </Button>
      }
    >
      {list && list.length === 0 && <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--mr-muted)' }}>{ts('noHistory')}</div>}
      {list?.map((k) => (
        <div
          key={k}
          className={css.histRow}
          role="button"
          onClick={() => {
            close();
            onPick(k);
          }}
        >
          <History size={16} style={{ color: 'var(--mr-muted)' }} />
          <span>{k}</span>
        </div>
      ))}
    </Sheet>
  );
}

export function SearchDialog({ session }: { session: ReaderSession }) {
  const open = useSearch((s) => s.open);
  const query = useSearch((s) => s.query);
  const results = useSearch((s) => s.results);
  const running = useSearch((s) => s.running);
  const [done, total] = useSearch((s) => s.progress);
  const error = useSearch((s) => s.error);
  const capped = useSearch((s) => s.capped);
  const current = useSearch((s) => s.current);
  const searched = useSearch((s) => s.searched);
  const zh = appSettings.use((s) => s.language) === 'zh';
  const [text, setText] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时把输入框同步成当前/上次关键词（外部带关键词打开时，由 SearchHost 先写入 store 并直接开搜）
  useEffect(() => {
    if (!open) return;
    setText(query || searchSettings.get().lastKey);
    inputRef.current?.focus();
  }, [open, query]);

  const run = useCallback((k: string) => void startSearch(session, k), [session]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeSearchDialog();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  const pick = (i: number) => {
    closeSearchDialog();
    void gotoResult(session, i);
  };

  return createPortal(
    <div className={css.screen} data-testid="search-dialog" role="dialog" aria-modal="true">
      <div className={css.top}>
        <div className={css.title}>{ts('search')}</div>
        <IconButton label={ts('options')} onClick={() => openOverlay((close) => <OptionsDialog close={close} />)}>
          <Settings2 size={20} />
        </IconButton>
        <IconButton
          label={ts('history')}
          onClick={() =>
            openOverlay((close) => (
              <HistoryDialog
                close={close}
                onPick={(k) => {
                  setText(k);
                  run(k);
                }}
              />
            ))
          }
        >
          <History size={20} />
        </IconButton>
        <IconButton label={tc('close')} onClick={closeSearchDialog}>
          <X size={22} />
        </IconButton>
      </div>
      <div className={css.inputRow}>
        <input
          ref={inputRef}
          className={css.input}
          data-testid="search-input"
          value={text}
          placeholder={ts('placeholder')}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) run(text);
          }}
        />
        {running ? (
          <button type="button" className={css.go} onClick={cancelSearch} title={ts('cancel')} data-testid="search-cancel">
            <Loader2 size={18} className={css.spin} />
          </button>
        ) : (
          <button type="button" className={css.go} onClick={() => run(text)} disabled={!text.trim()} data-testid="search-go">
            <Search size={18} />
            {ts('search')}
          </button>
        )}
      </div>
      {error ? <div className={css.err}>{error}</div> : <div className={css.hint}>{ts('hint')}</div>}
      {running && (
        <div className={css.bar}>
          <i style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }} />
        </div>
      )}
      {(searched || results.length > 0) && (
        <div className={css.head} data-testid="search-count">
          <span className={css.grow}>{capped ? ts('resultsMax', { n: MAX_RESULTS }) : ts('results', { n: results.length })}</span>
          {running && <span>{ts('searching', { done, total })}</span>}
        </div>
      )}
      {!running && searched && results.length === 0 && !error && <div style={{ padding: 28, textAlign: 'center', color: 'var(--mr-muted)' }}>{ts('noResult', { key: query })}</div>}
      <VirtualList
        items={results}
        rowHeight={70}
        testId="search-results"
        renderRow={(r, i) => (
          <div className={css.res} data-current={i === current ? 'true' : undefined} data-testid="search-result" onClick={() => pick(i)} role="button">
            <div className={css.snip}>
              {r.pre}
              <b style={zh ? undefined : { color: 'inherit' }}>{r.hit}</b>
              {r.post}
              <span className={css.pct}>({percentStr(r.progress)})</span>
            </div>
          </div>
        )}
      />
    </div>,
    document.body,
  );
}

/** 阅读界面下方的搜索导航面板 */
export function SearchNavPanel() {
  const session = useReaderSession();
  const panel = useSearch((s) => s.panel);
  const n = useSearch((s) => s.results.length);
  const current = useSearch((s) => s.current);
  const hasBack = useLinkBack((s) => s.stack.length > 0);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'F3') {
        e.preventDefault();
        stepResult(session, e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, session]);

  if (!panel) return null;
  return createPortal(
    <div className={css.nav} data-testid="search-nav" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" aria-label={ts('list')} title={ts('list')} data-testid="nav-list" onClick={() => useSearch.setState({ open: true })}>
        <List size={19} />
      </button>
      <button type="button" aria-label={ts('prev')} title={ts('prev')} data-testid="nav-prev" onClick={() => stepResult(session, -1)}>
        <ChevronUp size={22} />
      </button>
      <span className={css.count} data-testid="nav-count">
        {ts('nav', { i: current + 1, n })}
      </span>
      <button type="button" aria-label={ts('next')} title={ts('next')} data-testid="nav-next" onClick={() => stepResult(session, 1)}>
        <ChevronDown size={22} />
      </button>
      <button type="button" aria-label={ts('back')} title={ts('back')} disabled={!hasBack} data-testid="nav-back" onClick={() => void backToBeforeSearch(session)}>
        <CornerUpLeft size={19} />
      </button>
      <button type="button" aria-label={ts('close')} title={ts('close')} data-testid="nav-close" onClick={() => closeNavPanel(session)}>
        <X size={20} />
      </button>
    </div>,
    document.body,
  );
}

