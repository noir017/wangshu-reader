// 网上书库（NET-001..009）：站点列表 → OPDS 浏览（分页/搜索/详情/下载）
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ChevronLeft, ChevronRight, Cloud, ExternalLink, Folder, Home, Library, MoreVertical, Plus, Server } from 'lucide-react';
import { IconButton, confirmDialog, popupMenu, promptDialog, toast } from '@/ui';
import { hasServer } from '@/core/server';
import { navigate, type Route } from '@/core/router';
import { TopBar } from '../TopBar';
import { Empty, Spinner } from '../ui-kit';
import { NetImage } from './NetImage';
import { openNetBook } from './NetBook';
import { downloadFromLink, openDownloadQueue } from './Downloads';
import { askLogin, openAddCatalog, openEditCatalog } from './CatalogDialogs';
import { deleteCatalog, saveCatalog, togglePinCatalog, useCatalogs, type Catalog } from '../catalogs';
import { AuthRequiredError, NotOpdsError, discoverSearch, fetchFeed, searchFeed, type CatalogAuth } from '../opds-client';
import { guessPrevUrl, pageInfo, type OpdsEntry, type OpdsFeed } from '../opds';
import { useDownloads } from '../downloads';
import { netSettings } from '../settings';
import { t } from '../i18n';
import s from '../library.module.css';
import n from './net.module.css';

export function NetPage({ route }: { route: Route }) {
  const id = route.params[0];
  return id ? <Browse key={id} catalogId={id} /> : <CatalogList />;
}

// ───────────── 站点列表 ─────────────
function Avatar({ c, size = 44 }: { c: Catalog; size?: number }) {
  return (
    <div className={n.avatar} style={{ width: size, height: size, fontSize: size * 0.45 }}>
      {c.html ? <Server size={size * 0.5} /> : c.title[0]?.toUpperCase() || <Cloud />}
    </div>
  );
}

function CatalogList() {
  const catalogs = useCatalogs();
  const useGrid = netSettings.use((x) => x.useGrid);
  const [q, setQ] = useState('');
  const active = useDownloads((st) => st.items.filter((x) => x.status === 'running' || x.status === 'queued').length);
  const list = q ? catalogs.filter((c) => `${c.title} ${c.summary ?? ''}`.toLowerCase().includes(q.toLowerCase())) : catalogs;

  const open = (c: Catalog) => (c.html ? window.open(c.main, '_blank', 'noopener') : navigate('net', c.id));
  const menu = (c: Catalog, x: number, y: number) =>
    popupMenu(x, y, [
      { label: t('netOpen'), onSelect: () => open(c) },
      { label: t('netEdit'), onSelect: () => openEditCatalog(c) },
      {
        label: t('delete'),
        onSelect: () =>
          void confirmDialog(`${t('netDeleteConfirm')} ${c.title}`).then((ok) => {
            if (ok) void deleteCatalog(c.id);
          }),
      },
      { label: c.pinnedAt ? t('netUnpin') : t('netPin'), onSelect: () => void togglePinCatalog(c.id) },
    ]);

  return (
    <>
      <TopBar
        title={t('netTitle')}
        search={{ scope: 'net', value: q, onChange: setQ }}
        actions={
          <>
            <IconButton label={t('netAdd')} onClick={openAddCatalog}>
              <Plus size={22} />
            </IconButton>
            <IconButton label={t('netQueue')} onClick={openDownloadQueue}>
              <span style={{ position: 'relative', display: 'flex' }}>
                <ArrowDownToLine size={21} />
                {active > 0 && <span className={n.badge}>{active}</span>}
              </span>
            </IconButton>
            <IconButton
              label={t('more')}
              onClick={(e) =>
                popupMenu(e.clientX - 200, e.clientY, [
                  { label: t('netAdd'), onSelect: openAddCatalog },
                  { label: t('netFromLink'), onSelect: () => void downloadFromLink() },
                  { label: t('netGrid'), onSelect: () => netSettings.set({ useGrid: !useGrid }) },
                ])
              }
            >
              <MoreVertical size={21} />
            </IconButton>
          </>
        }
      />
      <div className={s.content}>
        {!hasServer() && <div className={n.warn}>{t('netNeedServer')}</div>}
        {list.length === 0 ? (
          <Empty icon={<Library size={44} />} text={t('netNoList')} />
        ) : useGrid ? (
          <div className={n.catGrid}>
            {list.map((c) => (
              <div key={c.id} className={n.catCell} onClick={() => open(c)} onContextMenu={(e) => { e.preventDefault(); menu(c, e.clientX, e.clientY); }}>
                <Avatar c={c} size={60} />
                <div className={n.catName}>{c.title}</div>
                <button className={n.catMore} aria-label="menu" onClick={(e) => { e.stopPropagation(); menu(c, e.clientX, e.clientY); }}>
                  <MoreVertical size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          list.map((c) => (
            <div key={c.id} className={s.groupRow} style={{ minHeight: 68 }} onClick={() => open(c)} onContextMenu={(e) => { e.preventDefault(); menu(c, e.clientX, e.clientY); }}>
              <Avatar c={c} />
              <div className={s.grow}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.pinnedAt ? '📌 ' : ''}
                  {c.title}
                </div>
                {c.summary && <div className={s.dim} style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.summary}</div>}
              </div>
              {c.html && <ExternalLink size={16} style={{ opacity: 0.5 }} />}
              <button className={s.moreBtn} aria-label="menu" onClick={(e) => { e.stopPropagation(); menu(c, e.clientX, e.clientY); }}>
                <MoreVertical size={18} />
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ───────────── 浏览 ─────────────
interface Frame {
  url: string;
  feed: OpdsFeed;
  scroll: number;
  /** 翻页时走过的上一页地址，用于「上一页」 */
  trail: string[];
}

/** 由下一页地址推算第 n 页的地址（NET-002 页码输入） */
export function urlForPage(feed: OpdsFeed, page: number): string | undefined {
  const per = feed.itemsPerPage;
  if (!feed.nextUrl || !per) return undefined;
  try {
    const u = new URL(feed.nextUrl);
    for (const k of ['start_index', 'startIndex', 'start-index']) {
      if (u.searchParams.has(k)) {
        u.searchParams.set(k, String((page - 1) * per + 1));
        return u.href;
      }
    }
    for (const k of ['page', 'startPage', 'p']) {
      if (u.searchParams.has(k)) {
        u.searchParams.set(k, String(page));
        return u.href;
      }
    }
  } catch {
    /* 非法 URL */
  }
  return undefined;
}

function Browse({ catalogId }: { catalogId: string }) {
  const catalogs = useCatalogs();
  const catalog = catalogs.find((c) => c.id === catalogId);
  const [stack, setStack] = useState<Frame[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ msg: string; web?: string } | null>(null);
  const [q, setQ] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const searchTpl = useRef<string | undefined>(undefined);
  const catRef = useRef(catalog);
  catRef.current = catalog;
  const cur = stack[stack.length - 1];
  const active = useDownloads((st) => st.items.filter((x) => x.status === 'running' || x.status === 'queued').length);

  const auth = (): CatalogAuth => ({ userAgent: catRef.current?.userAgent, username: catRef.current?.username, password: catRef.current?.password });

  const fetchWithLogin = async (url: string): Promise<OpdsFeed | null> => {
    let a = auth();
    for (let i = 0; i < 3; i++) {
      try {
        return await fetchFeed(url, a);
      } catch (e) {
        if (e instanceof AuthRequiredError) {
          const c = await askLogin(a.username);
          if (!c) return null;
          a = { ...a, username: c.user, password: c.password };
          if (c.remember && catRef.current) await saveCatalog({ ...catRef.current, username: c.user, password: c.password });
          continue;
        }
        throw e;
      }
    }
    return null;
  };

  const load = async (url: string, mode: 'push' | 'replace' | 'reset', trail?: string[]) => {
    setLoading(true);
    setError(null);
    const scroll = contentRef.current?.scrollTop ?? 0;
    try {
      const feed = await fetchWithLogin(url);
      if (!feed) return;
      if (feed.searchTemplate && !searchTpl.current) searchTpl.current = feed.searchTemplate;
      const frame: Frame = { url, feed, scroll: 0, trail: trail ?? [] };
      setStack((st) => (mode === 'reset' ? [frame] : mode === 'replace' ? [...st.slice(0, -1), frame] : [...st.map((f, i) => (i === st.length - 1 ? { ...f, scroll } : f)), frame]));
      requestAnimationFrame(() => contentRef.current?.scrollTo({ top: 0 }));
    } catch (e) {
      if (e instanceof NotOpdsError) setError({ msg: t('netNoList'), web: e.finalUrl });
      else setError({ msg: `${t('netNoList')}\n${(e as Error).message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (catalog && stack.length === 0 && !loading && !error) {
      if (!hasServer()) return;
      void load(catalog.main, 'reset');
    }
  }, [catalog?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = () => {
    if (stack.length <= 1) return navigate('net');
    const prev = stack[stack.length - 2];
    setStack(stack.slice(0, -1));
    setError(null);
    requestAnimationFrame(() => contentRef.current?.scrollTo({ top: prev.scroll }));
  };

  const goSearch = async (key: string) => {
    if (!key.trim() || !catalog) return;
    setLoading(true);
    try {
      let tpl = catalog.search ?? searchTpl.current;
      if (!tpl && cur) tpl = await discoverSearch(cur.feed, auth());
      if (!tpl) {
        toast(t('netNoSearch'));
        return;
      }
      searchTpl.current = tpl;
      const feed = await searchFeed(tpl, key.trim(), auth());
      setStack((st) => [...st.map((f, i) => (i === st.length - 1 ? { ...f, scroll: contentRef.current?.scrollTop ?? 0 } : f)), { url: feed.selfUrl ?? tpl!, feed, scroll: 0, trail: [] }]);
      setError(null);
    } catch (e) {
      toast(`${t('netNoList')} ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const info = cur ? pageInfo(cur.feed) : null;
  const prevUrl = cur ? (cur.trail.length ? cur.trail[cur.trail.length - 1] : guessPrevUrl(cur.feed)) : undefined;

  const onEntry = (e: OpdsEntry) => {
    if (e.kind === 'book') return openNetBook(e, cur!.feed.baseUrl, catalog);
    if (!e.href) return;
    if (e.kind === 'web') return void window.open(e.href, '_blank', 'noopener');
    void load(e.href, 'push');
  };

  const entries = useMemo(() => cur?.feed.entries ?? [], [cur]);

  if (catalogs.length > 0 && !catalog) {
    return (
      <>
        <TopBar title={t('netTitle')} nav="back" onNav={() => navigate('net')} />
        <div className={s.content}>
          <Empty text={t('netNoList')} />
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        title={cur?.feed.title || catalog?.title || t('netTitle')}
        subtitle={catalog?.title}
        nav="back"
        onNav={back}
        search={{ scope: 'net', value: q, onChange: setQ, onSubmit: (k) => void goSearch(k), placeholder: `${t('search')} ${catalog?.title ?? ''}` }}
        actions={
          <>
            <IconButton label={t('netQueue')} onClick={openDownloadQueue}>
              <span style={{ position: 'relative', display: 'flex' }}>
                <ArrowDownToLine size={21} />
                {active > 0 && <span className={n.badge}>{active}</span>}
              </span>
            </IconButton>
          </>
        }
      />
      <div className={n.nav}>
        <IconButton label={t('netHome')} onClick={() => catalog && void load(catalog.main, 'reset')}>
          <Home size={19} />
        </IconButton>
        <IconButton label={t('netPrev')} disabled={!prevUrl || loading} onClick={() => prevUrl && cur && void load(prevUrl, 'replace', cur.trail.slice(0, -1))}>
          <ChevronLeft size={21} />
        </IconButton>
        <button
          className={n.page}
          disabled={!info || !cur?.feed.nextUrl}
          onClick={async () => {
            if (!info || !cur) return;
            const v = await promptDialog(`${t('netGoPage')} (1-${info.pages})`, String(info.page));
            const p = Math.max(1, Math.min(info.pages, parseInt(v ?? '', 10) || 0));
            const url = p ? urlForPage(cur.feed, p) : undefined;
            if (url) void load(url, 'replace', []);
          }}
        >
          {info ? `${info.page} / ${info.pages}` : cur?.feed.nextUrl ? '…' : '1'}
        </button>
        <IconButton label={t('netNext')} disabled={!cur?.feed.nextUrl || loading} onClick={() => cur?.feed.nextUrl && void load(cur.feed.nextUrl, 'replace', [...cur.trail, cur.url])}>
          <ChevronRight size={21} />
        </IconButton>
        <span style={{ flex: 1 }} />
        <IconButton label={t('netOpenBrowser')} onClick={() => catalog && window.open(cur?.url ?? catalog.main, '_blank', 'noopener')}>
          <ExternalLink size={18} />
        </IconButton>
      </div>
      <div className={s.content} ref={contentRef}>
        {!hasServer() ? (
          <Empty icon={<Cloud size={44} />} text={t('netNeedServer')} />
        ) : loading && !cur ? (
          <Empty icon={<Spinner size={28} />} text={t('loading')} />
        ) : error ? (
          <Empty icon={<Cloud size={44} />} text={<span style={{ whiteSpace: 'pre-line' }}>{error.msg}</span>}>
            {error.web && (
              <button className={s.moreBtn} onClick={() => window.open(error.web, '_blank', 'noopener')}>
                {t('netOpenBrowser')}
              </button>
            )}
          </Empty>
        ) : entries.length === 0 && cur ? (
          <Empty text={t('netNoList')} />
        ) : (
          <div style={{ opacity: loading ? 0.5 : 1 }}>
            {entries.map((e, i) => (
              <div key={e.id + i} className={s.item} style={{ alignItems: 'center' }} onClick={() => onEntry(e)}>
                <div className={n.thumb}>
                  {e.thumb || e.cover ? (
                    <NetImage src={e.thumb ?? e.cover} />
                  ) : e.kind === 'dir' ? (
                    <Folder size={26} color="#e0a100" />
                  ) : e.kind === 'web' ? (
                    <ExternalLink size={22} color="var(--mr-muted)" />
                  ) : (
                    <Library size={24} color="var(--mr-muted)" />
                  )}
                </div>
                <div className={s.itemBody}>
                  <div className={s.itemTitle} style={{ WebkitLineClamp: 2 }}>{e.title}</div>
                  {e.authors.length > 0 && <div className={s.itemAuthor}>{e.authors.join(', ')}</div>}
                  {e.summaryHtml && <div className={s.itemDesc}>{htmlToText(e.summaryHtml)}</div>}
                  {e.kind === 'book' && <div className={s.itemMeta}>{[...new Set(e.downloads.map((d) => d.ext))].join(' · ')}</div>}
                </div>
                {e.kind === 'dir' && <ChevronRight size={18} style={{ opacity: 0.4 }} />}
              </div>
            ))}
          </div>
        )}
        {loading && cur && (
          <div style={{ position: 'absolute', top: 12, right: 14 }}>
            <Spinner />
          </div>
        )}
      </div>
    </>
  );
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}
