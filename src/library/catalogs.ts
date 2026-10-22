// 网络书库站点（NET-001/005/009）：内置列表 + 用户添加；存 kv。口令存在站点记录里（本机 IndexedDB），备份导出时会剔除。
import { useEffect, useState } from 'react';
import { dbEvents, getKV, newId, setKV } from '@/storage/db';
import { t } from './i18n';

export interface Catalog {
  id: string;
  title: string;
  summary?: string;
  /** 入口地址（HTML 站点则是网页地址） */
  main: string;
  /** 带 {searchTerms} 的搜索模板；空则从 feed 里发现 */
  search?: string;
  /** 网页书库：新标签页打开，不解析 */
  html?: boolean;
  userAgent?: string;
  username?: string;
  password?: string;
  builtin?: boolean;
  /** 内置站点的版本号，升级时覆盖本地（用户改过的不会被覆盖：改过就把 builtin 清掉） */
  version?: number;
  pinnedAt?: number;
  addedAt: number;
}

/**
 * 内置站点。原 app 的 gutenberg 地址 m.gutenberg.org 会 301（2026-10-21 实测），改为 www；
 * Feedbooks 当前有反爬（Cloudflare 403），保留入口但可能打不开；moondownload.com 的用户投稿目录仍可访问，
 * 原 app 默认把它移除（version=-1），Web 版保留——它是新手找到更多书库的入口。
 */
export const BUILTIN_CATALOGS: Omit<Catalog, 'addedAt'>[] = [
  {
    id: 'gutenberg',
    title: 'Project Gutenberg',
    summary: 'The first producer of free ebooks (since 1971).',
    main: 'https://www.gutenberg.org/ebooks.opds/',
    search: 'https://www.gutenberg.org/ebooks/search.opds/?query={searchTerms}',
    userAgent: 'Stanza Android MoonReader',
    builtin: true,
    version: 9,
  },
  {
    id: 'feedbooks',
    title: 'Feedbooks',
    summary: 'Feedbooks.com OPDS.',
    main: 'https://www.feedbooks.com/catalog.atom',
    builtin: true,
    version: 5,
  },
  {
    id: 'moonreader',
    title: 'Moon+ Catalogs',
    summary: 'Catalogs weekly updated from our users',
    main: 'http://www.moondownload.com/catalog.xml',
    builtin: true,
    version: 5,
  },
  {
    id: 'mobileread',
    title: 'More books in your language',
    summary: 'Browse OPDS WIKI for more sites.',
    main: 'https://wiki.mobileread.com/wiki/OPDS',
    html: true,
    builtin: true,
    version: 5,
  },
];

// 内置站点的显示文字跟界面语言走：记录里存的是原 app 的英文原文（升级合并、改名判断都按原文比），
// 只在显示时、且文字仍是内置原文（用户没改过）时换成当前语言；站点名是品牌（Project Gutenberg、Feedbooks）的不翻。
const BUILTIN_TEXT: Record<string, { title?: () => string; summary?: () => string }> = {
  gutenberg: { summary: () => t('catGutenbergSummary') },
  feedbooks: { summary: () => t('catFeedbooksSummary') },
  moonreader: { title: () => t('catMoonTitle'), summary: () => t('catMoonSummary') },
  mobileread: { title: () => t('catMobilereadTitle'), summary: () => t('catMobilereadSummary') },
};
const builtinOf = (id: string) => BUILTIN_CATALOGS.find((b) => b.id === id);

export function catalogTitle(c: Pick<Catalog, 'id' | 'title'>): string {
  return (c.title === builtinOf(c.id)?.title && BUILTIN_TEXT[c.id]?.title?.()) || c.title;
}

export function catalogSummary(c: Pick<Catalog, 'id' | 'summary'>): string | undefined {
  return (c.summary !== undefined && c.summary === builtinOf(c.id)?.summary && BUILTIN_TEXT[c.id]?.summary?.()) || c.summary;
}

const KEY = 'library.catalogs';
const DELETED_KEY = 'library.catalogs.deleted';

/** 读取站点列表；首次与内置版本升级时合并内置站点（用户删过的不再恢复） */
export async function listCatalogs(): Promise<Catalog[]> {
  const stored = (await getKV<Catalog[]>(KEY)) ?? [];
  const deleted = new Set((await getKV<string[]>(DELETED_KEY)) ?? []);
  const byId = new Map(stored.map((c) => [c.id, c]));
  let dirty = false;
  for (const b of BUILTIN_CATALOGS) {
    if (deleted.has(b.id)) continue;
    const cur = byId.get(b.id);
    if (!cur) {
      byId.set(b.id, { ...b, addedAt: 0 });
      dirty = true;
    } else if (cur.builtin && (cur.version ?? 0) < (b.version ?? 0)) {
      byId.set(b.id, { ...cur, ...b, pinnedAt: cur.pinnedAt, username: cur.username, password: cur.password, addedAt: cur.addedAt });
      dirty = true;
    }
  }
  // 已删除的内置站点：即使列表里还残留（旧版本的删除竞态），也不再显示
  const isDeadBuiltin = (c: Catalog) => deleted.has(c.id) && BUILTIN_CATALOGS.some((b) => b.id === c.id);
  if ([...byId.values()].some(isDeadBuiltin)) dirty = true;
  const list = [...byId.values()].filter((c) => !isDeadBuiltin(c));
  if (dirty) await setKV(KEY, list);
  return sortCatalogs(list);
}

/** 置顶的在前（最新置顶最前），其余按添加顺序 */
export function sortCatalogs(list: Catalog[]): Catalog[] {
  return [...list].sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) || a.addedAt - b.addedAt);
}

export async function saveCatalog(c: Omit<Catalog, 'id' | 'addedAt'> & { id?: string; addedAt?: number }): Promise<Catalog> {
  const list = (await getKV<Catalog[]>(KEY)) ?? (await listCatalogs());
  const id = c.id ?? `c-${newId().slice(0, 8)}`;
  const prev = list.find((x) => x.id === id);
  // 用户改过内置站点后不再随版本升级覆盖
  const next: Catalog = { ...(prev ?? {}), ...c, id, addedAt: c.addedAt ?? prev?.addedAt ?? Date.now() } as Catalog;
  if (prev?.builtin && (prev.main !== next.main || prev.title !== next.title)) next.builtin = false;
  await setKV(KEY, prev ? list.map((x) => (x.id === id ? next : x)) : [...list, next]);
  return next;
}

export async function deleteCatalog(id: string): Promise<void> {
  // 内置站点先记墓碑再删：删列表会触发 useCatalogs 重新 listCatalogs，墓碑晚一步写的话内置站点会被当成「新出现」合并回去
  if (BUILTIN_CATALOGS.some((b) => b.id === id)) await setKV(DELETED_KEY, [...new Set([...((await getKV<string[]>(DELETED_KEY)) ?? []), id])]);
  const list = (await getKV<Catalog[]>(KEY)) ?? [];
  await setKV(KEY, list.filter((x) => x.id !== id));
}

export async function togglePinCatalog(id: string): Promise<void> {
  const list = (await getKV<Catalog[]>(KEY)) ?? [];
  await setKV(KEY, list.map((c) => (c.id === id ? { ...c, pinnedAt: c.pinnedAt ? undefined : Date.now() } : c)));
}

export function useCatalogs(): Catalog[] {
  const [list, setList] = useState<Catalog[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void listCatalogs().then((l) => live && setList(l));
    load();
    const off = dbEvents.on('change', (e) => e.store === 'kv' && (e.key === KEY || !e.key) && load());
    return () => {
      live = false;
      off();
    };
  }, []);
  return list;
}

/** Calibre 内容服务器 IP → OPDS 地址（NET-005） */
export function calibreUrl(ip: string, port: string | number): string {
  return `http://${ip.trim()}:${port || 8080}/opds`;
}

/** 站点名：feed 标题 / 输入名 / 域名 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
