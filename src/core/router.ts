// hash 路由（单文件 html 用 file:// 打开也能工作）。路由表在 App.tsx 里注册。
// 页面分两级：顶级页是抽屉里那几个（首页、书架、文件、网上书库、书签、统计、设置、关于），互相切换不进历史；
// 其余（阅读页、某本书的书签、文件夹、书库目录…）是次级页，照常压栈。历史栈始终是「首页 → 至多一个别的顶级页 → 次级页…」：
// 返回键从次级页一层层退，从顶级页回首页，在首页再返回才离开（Android 上是退出 app）。
// 每条历史的栈深记在 history.state.mrDepth（首页那条是 0），刷新后仍在。
import { useSyncExternalStore } from 'react';

export interface Route {
  /** 第一段路径，如 '' / 'read' / 'settings' */
  name: string;
  /** 其余路径段 */
  params: string[];
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [path, qs = ''] = h.split('?');
  const segs = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: segs[0] ?? '', params: segs.slice(1), query: new URLSearchParams(qs) };
}

const TOP_ROUTES = new Set(['', 'shelf', 'files', 'net', 'notes', 'stats', 'settings', 'about']);

/** 不带参数的抽屉页才是顶级页：files?path=…、net/<目录>、notes/<书> 都算次级 */
function isTop(r: Route): boolean {
  return TOP_ROUTES.has(r.name) && !r.params.length && !r.query.toString();
}

let cachedHash = '';
let cachedRoute = parse('');

function snapshot(): Route {
  const hash = globalThis.location?.hash ?? '';
  if (hash !== cachedHash) {
    cachedHash = hash;
    cachedRoute = parse(hash);
  }
  return cachedRoute;
}

function subscribe(cb: () => void): () => void {
  globalThis.addEventListener('hashchange', cb);
  return () => globalThis.removeEventListener('hashchange', cb);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// ───────────── 历史栈 ─────────────

/** 当前条目的栈深 */
let depth = 0;
/** 从深处退回顶级层：history.go 落地后把那一条换成目标页 */
let pending: { depth: number; hash: string } | null = null;

function stateDepth(): number | undefined {
  const d = (globalThis.history?.state as { mrDepth?: unknown } | null)?.mrDepth;
  return typeof d === 'number' ? d : undefined;
}

function currentHash(): string {
  return globalThis.location.hash || '#/';
}

/** pushState/replaceState 不发 hashchange：手动补一个，useRoute 和各处监听 hashchange 的代码照常工作 */
function notify(): void {
  globalThis.dispatchEvent(typeof HashChangeEvent === 'function' ? new HashChangeEvent('hashchange') : new Event('hashchange'));
}

function push(hash: string): void {
  if (hash === currentHash()) return;
  depth += 1;
  history.pushState({ mrDepth: depth }, '', hash);
  notify();
}

function replace(hash: string): void {
  if (hash === currentHash()) return;
  history.replaceState({ mrDepth: depth }, '', hash);
  notify();
}

/** 前进/后退落地，或地址栏、代码直接改了 location.hash（新条目没有栈深：当作压栈） */
function onHistory(): void {
  const d = stateDepth();
  if (d === undefined) {
    depth += 1;
    history.replaceState({ mrDepth: depth }, '');
  } else depth = d;
  if (pending && pending.depth === depth) {
    const { hash } = pending;
    pending = null;
    replace(hash);
  }
}

function initHistory(): void {
  if (typeof window === 'undefined' || !window.history) return;
  const d = stateDepth();
  if (d !== undefined) depth = d;
  else if (parse(location.hash).name === '') history.replaceState({ mrDepth: 0 }, '');
  else {
    // 直接打开某一页（链接、外部书签）：在底下垫一条首页，返回键能回到首页而不是直接离开
    const url = location.href;
    history.replaceState({ mrDepth: 0 }, '', '#/');
    history.pushState({ mrDepth: 1 }, '', url);
    depth = 1;
  }
  window.addEventListener('popstate', onHistory);
  window.addEventListener('hashchange', onHistory);
}

initHistory();

function toHash(name: string, rest: (string | Record<string, string>)[]): string {
  const query = rest.find((x): x is Record<string, string> => typeof x === 'object');
  const segs = rest.filter((x): x is string => typeof x === 'string').map(encodeURIComponent);
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : '';
  return `#/${[name, ...segs].filter(Boolean).join('/')}${qs}`;
}

/** navigate('read', bookId) → #/read/<bookId>；query 可选。去顶级页时不留历史（见文件头） */
export function navigate(name: string, ...rest: (string | Record<string, string>)[]): void {
  const hash = toHash(name, rest);
  const target = parse(hash);
  if (!isTop(target)) return push(hash);
  const level = target.name === '' ? 0 : 1;
  if (depth < level) return push(hash);
  if (depth === level) return replace(hash);
  pending = { depth: level, hash };
  history.go(level - depth);
}

/** 原地换成另一页，不进历史（阅读页切到上/下一个文件、重新挂载阅读页） */
export function replaceRoute(name: string, ...rest: (string | Record<string, string>)[]): void {
  replace(toHash(name, rest));
}

export function back(): void {
  if (depth > 0) globalThis.history.back();
  else navigate('');
}
