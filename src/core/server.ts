// 浏览器 → 服务端的统一入口。所有需要服务端的功能都经这里，不要自己拼 fetch。
// 接口清单与请求/响应类型见 shared/api.ts（服务端实现同一份）。
import { appSettings } from './app-settings';

export class ServerUnavailableError extends Error {
  constructor(msg = '未配置或无法连接服务端') {
    super(msg);
    this.name = 'ServerUnavailableError';
  }
}

export function serverBase(): string {
  return appSettings.get().serverUrl.replace(/\/+$/, '');
}

export function hasServer(): boolean {
  return serverBase() !== '';
}

function authHeaders(): Record<string, string> {
  const token = appSettings.get().serverToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 调服务端接口。path 以 /api/ 开头。非 2xx 抛错（错误体为 { error } 时带上消息）。 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = serverBase();
  if (!base) throw new ServerUnavailableError();
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(authHeaders())) if (!headers.has(k)) headers.set(k, v);
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers });
  } catch (e) {
    throw new ServerUnavailableError(`无法连接服务端 ${base}：${(e as Error).message}`);
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.clone().json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new Error(`服务端 ${path} 出错：${msg}`);
  }
  return res;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  return (await res.json()) as T;
}

export async function apiPostJson<T>(path: string, body: unknown, init: RequestInit = {}): Promise<T> {
  return apiJson<T>(path, {
    ...init,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
    body: JSON.stringify(body),
  });
}

/** 服务端健康检查（结果缓存 30 秒），UI 用它决定是否置灰依赖服务端的功能 */
let healthCache: { base: string; at: number; ok: boolean } | undefined;
export async function checkServer(force = false): Promise<boolean> {
  const base = serverBase();
  if (!base) return false;
  if (!force && healthCache && healthCache.base === base && Date.now() - healthCache.at < 30_000) return healthCache.ok;
  let ok = false;
  try {
    const res = await fetch(`${base}/api/health`, { headers: authHeaders() });
    ok = res.ok;
  } catch {
    ok = false;
  }
  healthCache = { base, at: Date.now(), ok };
  return ok;
}
