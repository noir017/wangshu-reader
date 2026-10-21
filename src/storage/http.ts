// 访问服务端的底层封装：与 core/server 的 apiFetch 不同，这里不因非 2xx 抛错（WebDAV/OPDS 需要自己看 401/404/207）。
import { appSettings } from '@/core/app-settings';
import { ServerUnavailableError, serverBase } from '@/core/server';
import { PROXY_PATH } from '@shared/api';

export interface ServerFetchInit extends RequestInit {
  headers?: Record<string, string>;
}

/** 请求服务端任意路径（/dav、/api/...），网络层失败抛 ServerUnavailableError，HTTP 错误状态原样返回 */
export async function serverFetch(path: string, init: ServerFetchInit = {}): Promise<Response> {
  const base = serverBase();
  if (!base) throw new ServerUnavailableError();
  const headers = new Headers(init.headers);
  const token = appSettings.get().serverToken;
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  try {
    return await fetch(base + path, { ...init, headers });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ServerUnavailableError(`无法连接服务端 ${base}：${(e as Error).message}`);
  }
}

export function basicAuthHeader(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `Basic ${btoa(bin)}`;
}

export interface ProxyInit extends ServerFetchInit {
  /** 目标站点的 Basic 认证（经 X-Proxy-Authorization 转发） */
  auth?: { user: string; password: string };
  userAgent?: string;
  cookie?: string;
}

/** 经 /api/proxy 请求外部 URL（解决 CORS、重定向无 CORS 头、混合内容） */
export function proxyFetch(url: string, init: ProxyInit = {}): Promise<Response> {
  const { auth, userAgent, cookie, headers, ...rest } = init;
  const h: Record<string, string> = { ...(headers ?? {}) };
  if (auth?.user) h['X-Proxy-Authorization'] = basicAuthHeader(auth.user, auth.password);
  if (userAgent) h['X-Proxy-User-Agent'] = userAgent;
  if (cookie) h['X-Proxy-Cookie'] = cookie;
  return serverFetch(`${PROXY_PATH}?url=${encodeURIComponent(url)}`, { ...rest, headers: h });
}

/** <img src> 用的代理直链（带 ?token=，因为 <img> 不能加请求头） */
export function proxyUrl(url: string): string {
  const base = serverBase();
  if (!base) return url;
  const token = appSettings.get().serverToken;
  return `${base}${PROXY_PATH}?url=${encodeURIComponent(url)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
}
