// 浏览器 → 服务端的统一入口。所有需要服务端的功能都经这里，不要自己拼 fetch。
// 接口清单与请求/响应类型见 shared/api.ts（服务端实现同一份）。
import { appSettings } from './app-settings';
import { hostServer } from './host';
import { defineMessages } from './i18n';

const tm = defineMessages({
  zh: {
    noServer: '未配置或无法连接服务端',
    unreachable: '无法连接服务端 {base}：{why}',
    apiError: '服务端 {path} 出错：{msg}',
    network: '网络请求失败（网络不通、地址不对或被浏览器拦截）',
    unauthorized: '401 未授权（访问令牌错误或未填写）',
    notFound: '404 接口不存在（服务端版本可能太旧）',
    internal: '服务端内部错误',
    s400: '请求有误',
    s401: '未授权（访问令牌错误或未填写）',
    s403: '拒绝访问',
    s404: '不存在',
    s405: '不支持此操作',
    s408: '请求超时',
    s409: '冲突',
    s413: '内容过大',
    s415: '不支持的内容类型',
    s422: '无法处理',
    s429: '请求太频繁',
    s500: '服务端内部错误',
    s501: '服务端不支持',
    s502: '网关错误',
    s503: '服务暂不可用',
    s504: '网关超时',
  },
  en: {
    noServer: 'Server not configured or unreachable',
    unreachable: 'Cannot reach the server {base}: {why}',
    apiError: 'Server error at {path}: {msg}',
    network: 'Network request failed (offline, wrong address or blocked by the browser)',
    unauthorized: '401 Unauthorized (access token wrong or missing)',
    notFound: '404 No such API (the server may be outdated)',
    internal: 'Internal server error',
    s400: 'Bad Request',
    s401: 'Unauthorized (access token wrong or missing)',
    s403: 'Forbidden',
    s404: 'Not Found',
    s405: 'Method Not Allowed',
    s408: 'Request Timeout',
    s409: 'Conflict',
    s413: 'Payload Too Large',
    s415: 'Unsupported Media Type',
    s422: 'Unprocessable Entity',
    s429: 'Too Many Requests',
    s500: 'Internal Server Error',
    s501: 'Not Implemented',
    s502: 'Bad Gateway',
    s503: 'Service Unavailable',
    s504: 'Gateway Timeout',
  },
});
const KNOWN_STATUS = new Set([400, 401, 403, 404, 405, 408, 409, 413, 415, 422, 429, 500, 501, 502, 503, 504]);

/** HTTP 状态码 → 「404 不存在」这样的当前语言说明（错误体不是 JSON 时用；不认识的码用原 statusText） */
export function describeStatus(status: number, statusText = ''): string {
  const text = KNOWN_STATUS.has(status) ? tm(`s${status}` as 's400') : statusText;
  return text ? `${status} ${text}` : String(status);
}

/** fetch 网络层失败（Failed to fetch / NetworkError… / Load failed）换成当前语言的说明；其他错误原样取 message */
export function describeNetworkError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return /failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(msg) ? tm('network') : msg;
}

/** 服务端错误体里的几个英文代码（unauthorized / not found / internal error）换成当前语言；其余（服务端已是中文）原样 */
export function describeServerMessage(msg: string): string {
  if (msg === 'unauthorized') return tm('unauthorized');
  if (msg === 'not found') return tm('notFound');
  if (msg === 'internal error') return tm('internal');
  return msg.replace(/\bfetch failed\b/g, tm('network'));
}

/** 非 2xx 响应的错误说明：优先取 JSON 错误体 { error }（服务端 / 代理的提示），否则用状态码说明 */
export async function responseErrorText(res: Response): Promise<string> {
  try {
    const body = (await res.clone().json()) as { error?: unknown };
    if (typeof body?.error === 'string' && body.error) return describeServerMessage(body.error);
  } catch {
    /* 非 JSON 错误体 */
  }
  return describeStatus(res.status, res.statusText);
}

export class ServerUnavailableError extends Error {
  constructor(msg = tm('noServer')) {
    super(msg);
    this.name = 'ServerUnavailableError';
  }
}

/** 连不上服务端（网络层失败）时的统一报错 */
export function unreachableError(base: string, e: unknown): ServerUnavailableError {
  return new ServerUnavailableError(tm('unreachable', { base, why: describeNetworkError(e) }));
}

export function serverBase(): string {
  return (hostServer()?.url ?? appSettings.get().serverUrl).replace(/\/+$/, '');
}

/** 服务端访问令牌（app 内置服务端在用时取它的） */
export function serverToken(): string {
  return hostServer()?.token ?? appSettings.get().serverToken;
}

export function hasServer(): boolean {
  return serverBase() !== '';
}

function authHeaders(): Record<string, string> {
  const token = serverToken();
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
    throw unreachableError(base, e);
  }
  if (!res.ok) throw new Error(tm('apiError', { path, msg: await responseErrorText(res) }));
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
