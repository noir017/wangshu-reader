// WebDAV 客户端（SYNC-008）。只依赖一个 transport 函数，真实环境里它指向服务端 /dav 或 /api/proxy，测试里用 mock。
// 路径一律是相对 WebDAV 基址、以 / 开头的绝对路径，逐段 encodeURIComponent。
import { hasServer, responseErrorText } from '@/core/server';
import { DAV_PATH } from '@shared/api';
import { proxyFetch, serverFetch } from './http';
import { child, childText, childrenOf, parseXml, walk } from './xml';

export interface DavEntry {
  /** 相对基址的解码后路径（目录不带尾部 /） */
  path: string;
  name: string;
  dir: boolean;
  size: number;
  mtime: number;
}

export interface DavRequestInit {
  headers?: Record<string, string>;
  body?: BodyInit | null;
  signal?: AbortSignal;
}

export type DavTransport = (method: string, path: string, init?: DavRequestInit) => Promise<Response>;

export class DavError extends Error {
  constructor(
    public status: number,
    msg: string,
  ) {
    super(msg);
    this.name = 'DavError';
  }
}

export const encodePath = (p: string) =>
  p
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');

export function normPath(p: string): string {
  const out = '/' + p.split('/').filter(Boolean).join('/');
  return out;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?><a:propfind xmlns:a="DAV:"><a:prop><a:displayname/><a:resourcetype/><a:getcontentlength/><a:creationdate/><a:getlastmodified/></a:prop></a:propfind>`;

export class DavClient {
  private made = new Set<string>();
  constructor(private tx: DavTransport) {}

  private async ok(res: Response, what: string, allow: number[] = []): Promise<Response> {
    if (res.ok || allow.includes(res.status)) return res;
    throw new DavError(res.status, `WebDAV ${what} 失败：${await responseErrorText(res)}`);
  }

  /** PROPFIND Depth 0/1。目录返回 400 时带尾斜杠重试（fixDir400） */
  async propfind(path: string, depth: 0 | 1): Promise<DavEntry[] | null> {
    const run = (p: string) =>
      this.tx('PROPFIND', p, { headers: { Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' }, body: PROPFIND_BODY });
    let res = await run(path);
    if (res.status === 400 && !path.endsWith('/')) res = await run(path + '/');
    if (res.status === 404) return null;
    await this.ok(res, 'PROPFIND');
    return parseMultiStatus(await res.text(), path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      return (await this.propfind(path, 0)) !== null;
    } catch (e) {
      if (e instanceof DavError && (e.status === 404 || e.status === 410)) return false;
      throw e;
    }
  }

  async stat(path: string): Promise<DavEntry | null> {
    const list = await this.propfind(path, 0);
    return list?.[0] ?? null;
  }

  async list(path: string): Promise<DavEntry[]> {
    const dirPath = normPath(path);
    const list = await this.propfind(dirPath, 1);
    if (!list) return [];
    // 目录自身也在结果里；href 常带挂载前缀（/dav/…），所以按「以目录路径结尾的最短一项」剔除，而不是比较全等
    const selfCandidates = list.filter((e) => e.dir && (dirPath === '/' || normPath(e.path).endsWith(dirPath)));
    const self = selfCandidates.sort((a, b) => a.path.length - b.path.length)[0];
    return list.filter((e) => e !== self);
  }

  async get(path: string, init?: DavRequestInit): Promise<Blob | null> {
    const res = await this.tx('GET', path, init);
    if (res.status === 404) return null;
    await this.ok(res, 'GET');
    return res.blob();
  }

  async getText(path: string): Promise<string | null> {
    const res = await this.tx('GET', path);
    if (res.status === 404) return null;
    await this.ok(res, 'GET');
    return res.text();
  }

  async getBytes(path: string): Promise<Uint8Array | null> {
    const res = await this.tx('GET', path);
    if (res.status === 404) return null;
    await this.ok(res, 'GET');
    return new Uint8Array(await res.arrayBuffer());
  }

  /** 上传前对父路径逐级 MKCOL 并缓存，避免重复请求 */
  async put(path: string, body: BodyInit, contentType = 'application/octet-stream'): Promise<void> {
    await this.mkdirs(parentOf(path));
    const res = await this.tx('PUT', path, { headers: { 'Content-Type': contentType }, body });
    await this.ok(res, 'PUT');
  }

  async mkcol(path: string): Promise<void> {
    const res = await this.tx('MKCOL', path);
    // 405 = 已存在
    await this.ok(res, 'MKCOL', [405]);
  }

  async mkdirs(dir: string): Promise<void> {
    const segs = dir.split('/').filter(Boolean);
    let cur = '';
    for (const s of segs) {
      cur += '/' + s;
      if (this.made.has(cur)) continue;
      await this.mkcol(cur);
      this.made.add(cur);
    }
  }

  async delete(path: string): Promise<void> {
    let res = await this.tx('DELETE', path);
    if (!res.ok && res.status !== 404 && !path.endsWith('/')) res = await this.tx('DELETE', path + '/');
    await this.ok(res, 'DELETE', [404]);
  }

  async move(from: string, to: string, destAbsolute: (p: string) => string): Promise<void> {
    const res = await this.tx('MOVE', from, { headers: { Destination: destAbsolute(to), Overwrite: 'T' } });
    await this.ok(res, 'MOVE');
  }

  async copy(from: string, to: string, destAbsolute: (p: string) => string): Promise<void> {
    const res = await this.tx('COPY', from, { headers: { Destination: destAbsolute(to), Overwrite: 'T' } });
    await this.ok(res, 'COPY');
  }

  /** 连通性检查：对根发 PROPFIND Depth 0 */
  async verify(): Promise<void> {
    const res = await this.tx('PROPFIND', '/', { headers: { Depth: '0', 'Content-Type': 'application/xml' }, body: PROPFIND_BODY });
    if (res.status === 401 || res.status === 403) throw new DavError(res.status, '用户名或密码错误');
    if (res.status === 404) return; // 根不存在但服务可达（部分服务根路径返回 404）
    await this.ok(res, 'PROPFIND');
  }
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

/** 解析 207 Multi-Status */
export function parseMultiStatus(xml: string, requestPath = '/'): DavEntry[] {
  const root = parseXml(xml);
  if (!root) return [];
  const out: DavEntry[] = [];
  for (const n of walk(root)) {
    if (n.local !== 'response') continue;
    const href = childText(n, 'href');
    if (!href) continue;
    const props = childrenOf(n, 'propstat')
      .filter((ps) => /\s2\d\d\s/.test(' ' + childText(ps, 'status') + ' ') || !child(ps, 'status'))
      .map((ps) => child(ps, 'prop'))
      .find((p) => !!p);
    let path = href;
    try {
      path = new URL(href, 'http://x').pathname;
    } catch {
      /* 保持原样 */
    }
    try {
      path = decodeURIComponent(path);
    } catch {
      /* 非法编码保持原样 */
    }
    const isDir = !!props && !!child(props, 'resourcetype') && childrenOf(child(props, 'resourcetype')!, 'collection').length > 0;
    const trimmed = path.replace(/\/+$/, '') || '/';
    const name = trimmed.split('/').filter(Boolean).pop() ?? '';
    const mt = props ? childText(props, 'getlastmodified') : '';
    out.push({
      path: trimmed,
      name,
      dir: isDir || (href.endsWith('/') && !props),
      size: props ? Number(childText(props, 'getcontentlength')) || 0 : 0,
      mtime: mt ? Date.parse(mt) || 0 : 0,
    });
  }
  // 服务端返回的是绝对 URL 路径（含挂载前缀，如 /dav/xxx）；调用方用 requestPath 的相对关系再处理
  void requestPath;
  return out;
}

// ───────────── 真实环境的 transport ─────────────
export interface DavConfig {
  /** builtin = 服务端内置 /dav；custom = 用户自己的 WebDAV（经 /api/proxy） */
  mode: 'builtin' | 'custom';
  /** custom 模式的基址，如 https://dav.jianguoyun.com/dav */
  url: string;
  user: string;
  password: string;
}

/** custom 模式下目标资源的绝对 URL */
export function targetUrl(cfg: DavConfig, path: string): string {
  return cfg.url.replace(/\/+$/, '') + encodePath(path);
}

export function davAvailable(cfg: DavConfig): boolean {
  if (!hasServer()) return false;
  return cfg.mode === 'builtin' || /^https?:\/\//i.test(cfg.url);
}

export function createDavTransport(cfg: DavConfig): DavTransport {
  return (method, path, init = {}) => {
    const headers = { ...(init.headers ?? {}) };
    const rest = { method, body: init.body, signal: init.signal };
    if (cfg.mode === 'builtin') return serverFetch(DAV_PATH + encodePath(path), { ...rest, headers });
    return proxyFetch(targetUrl(cfg, path), { ...rest, headers, auth: cfg.user ? { user: cfg.user, password: cfg.password } : undefined });
  };
}

/** MOVE/COPY 的 Destination 需要绝对 URL */
export function destinationFor(cfg: DavConfig): (p: string) => string {
  if (cfg.mode === 'custom') return (p) => targetUrl(cfg, p);
  const base = (globalThis.location?.origin ?? '') + DAV_PATH;
  return (p) => base + encodePath(p);
}
