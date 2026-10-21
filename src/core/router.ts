// hash 路由（单文件 html 用 file:// 打开也能工作）。路由表在 App.tsx 里注册。
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

/** navigate('read', bookId) → #/read/<bookId>；query 可选 */
export function navigate(name: string, ...rest: (string | Record<string, string>)[]): void {
  const query = rest.find((x): x is Record<string, string> => typeof x === 'object');
  const segs = rest.filter((x): x is string => typeof x === 'string').map(encodeURIComponent);
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  globalThis.location.hash = `#/${[name, ...segs].filter(Boolean).join('/')}${qs}`;
}

export function back(): void {
  if (globalThis.history.length > 1) globalThis.history.back();
  else navigate('');
}
