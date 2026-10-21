// ANY /api/proxy?url=<目标> —— 跨域代理（OPDS、书籍下载、外部 WebDAV）。
// 用 node:http(s) 自己转发而不是 fetch：要保留任意方法（PROPFIND/MKCOL/MOVE/COPY）、不被自动解压、
// 流式收发大文件，并且能在 DNS 解析这一步拦截内网/链路本地地址（防 SSRF 与 DNS 重绑定）。
import type { Context } from 'hono';
import dns from 'node:dns';
import http, { type IncomingMessage, type OutgoingHttpHeaders } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Readable } from 'node:stream';
import type { ProxyConfig, ServerConfig } from '../config';
import type { RouteModule } from '../index';
import { isLocalRequest } from '../util/auth';

/** 转发给目标的请求头（小写）。Authorization/Cookie/User-Agent 经 X-Proxy-* 单独映射 */
const FORWARD_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'depth',
  'destination',
  'overwrite',
  'range',
  'if-range',
  'if-match',
  'if-none-match',
  'if-modified-since',
  'if-unmodified-since',
  'if',
  'lock-token',
  'timeout',
];

/** 回给浏览器的响应头 */
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-disposition',
  'content-range',
  'content-encoding',
  'content-language',
  'accept-ranges',
  'etag',
  'last-modified',
  'allow',
  'dav',
];

export class ProxyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ───────────────────────── 地址策略 ─────────────────────────

function ipv4ToInt(ip: string): number | null {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

const inCidr = (n: number, base: string, bits: number): boolean => {
  const b = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (n & mask) >>> 0 === (b & mask) >>> 0;
};

function blockV4(n: number, policy: Pick<ProxyConfig, 'blockPrivate'>): string | null {
  if (inCidr(n, '169.254.0.0', 16) || n === ipv4ToInt('100.100.100.200')) return '链路本地/云元数据地址';
  if (inCidr(n, '0.0.0.0', 8) || n >= 0xe0000000) return '无效或组播地址';
  if (policy.blockPrivate && (inCidr(n, '127.0.0.0', 8) || inCidr(n, '10.0.0.0', 8) || inCidr(n, '172.16.0.0', 12) || inCidr(n, '192.168.0.0', 16) || inCidr(n, '100.64.0.0', 10))) return '内网地址';
  return null;
}

/** IPv6 文本 → 16 字节（含 ::、尾部点分 IPv4、zone id）；不是合法 IPv6 返回 null */
export function ipv6Bytes(ip: string): number[] | null {
  let s = ip.split('%')[0].toLowerCase();
  if (!net.isIPv6(s)) return null;
  const tail4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail4) {
    const v4 = ipv4ToInt(tail4[2]);
    if (v4 === null) return null;
    s = `${tail4[1]}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const [head, rest] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = rest === undefined ? [] : rest ? rest.split(':') : [];
  if (rest === undefined && h.length !== 8) return null;
  const groups = [...h, ...Array<string>(rest === undefined ? 0 : 8 - h.length - t.length).fill('0'), ...t].map((g) => parseInt(g, 16));
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g))) return null;
  return groups.flatMap((g) => [g >> 8, g & 0xff]);
}

/**
 * 返回禁止访问的原因，允许则返回 null。
 * URL 解析器会把 [::ffff:169.254.169.254] 规范成十六进制的 [::ffff:a9fe:a9fe]，所以 IPv6 必须按字节解析，
 * 并把 IPv4 映射/兼容、NAT64、6to4 里内嵌的 IPv4 拿出来按 IPv4 规则判断。
 */
export function blockReason(ip: string, policy: Pick<ProxyConfig, 'blockPrivate'>): string | null {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIPv4(addr)) return blockV4(ipv4ToInt(addr)!, policy);
  const b = ipv6Bytes(addr);
  if (!b) return '无法识别的地址';
  const zeros = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  const v4At = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (zeros(0, 16)) return '无效地址';
  if (zeros(0, 15) && b[15] === 1) return policy.blockPrivate ? '内网地址' : null;
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return blockV4(v4At(12), policy); // ::ffff:a.b.c.d
  if (zeros(0, 12)) return blockV4(v4At(12), policy); // ::a.b.c.d（已废弃的 IPv4 兼容地址）
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12)) return blockV4(v4At(12), policy); // NAT64
  if (b[0] === 0x20 && b[1] === 0x02) return blockV4(v4At(2), policy); // 6to4
  if (b[0] === 0xff) return '无效或组播地址';
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return '链路本地/云元数据地址';
  if (b[0] === 0xfd && b[1] === 0x00 && b[2] === 0x0e && b[3] === 0xc2 && zeros(4, 15) && b[15] === 0x54) return '链路本地/云元数据地址'; // AWS fd00:ec2::254
  if (policy.blockPrivate && ((b[0] & 0xfe) === 0xfc || (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0))) return '内网地址';
  return null;
}

export function hostAllowed(host: string, allow: string[]): boolean {
  if (!allow.length) return true;
  const h = host.toLowerCase();
  return allow.some((a) => (a.startsWith('*.') ? h.endsWith(a.slice(1)) : h === a || h.endsWith(`.${a.replace(/^\./, '')}`)));
}

function guardedLookup(policy: ProxyConfig): net.LookupFunction {
  return (hostname, options, cb) => {
    (dns.lookup as (...a: unknown[]) => void)(hostname, options, (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family: number) => {
      if (err) return (cb as (...a: unknown[]) => void)(err);
      const list = Array.isArray(address) ? address : [{ address, family }];
      for (const a of list) {
        const why = blockReason(a.address, policy);
        if (why) return (cb as (...a: unknown[]) => void)(new ProxyError(403, `禁止代理到 ${hostname}（${a.address}）：${why}`));
      }
      (cb as (...a: unknown[]) => void)(null, address, family);
    });
  };
}

// ───────────────────────── 是否开放 ─────────────────────────

/** 当前请求能不能用代理（health 也用它报告 features.proxy） */
export function proxyAllowed(config: ServerConfig, c: Context): boolean {
  if (config.proxy.mode === 'off') return false;
  if (config.proxy.mode === 'on') return true;
  return !!config.token || isLocalRequest(c);
}

// ───────────────────────── 转发 ─────────────────────────

interface Hop {
  res: IncomingMessage;
  url: URL;
}

function requestOnce(
  url: URL,
  method: string,
  headers: OutgoingHttpHeaders,
  body: Buffer | Readable | null,
  cfg: ProxyConfig,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) {
      const why = blockReason(url.hostname.replace(/^\[|\]$/g, ''), cfg);
      if (why) return reject(new ProxyError(403, `禁止代理到 ${url.hostname}：${why}`));
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method,
        headers,
        timeout: timeoutMs,
        lookup: guardedLookup(cfg),
        ...(url.protocol === 'https:' ? { rejectUnauthorized: !cfg.insecureTls } : {}),
      },
      resolve,
    );
    req.on('timeout', () => req.destroy(new ProxyError(504, `目标站点响应超时（${Math.round(timeoutMs / 1000)}s）`)));
    req.on('error', reject);
    const onAbort = () => req.destroy(new ProxyError(499, '客户端已断开'));
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('close', () => signal?.removeEventListener('abort', onAbort));
    if (body === null) req.end();
    else if (Buffer.isBuffer(body)) req.end(body);
    else {
      body.on('error', (e) => req.destroy(e));
      body.pipe(req);
    }
  });
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

export async function followRequest(
  start: URL,
  method: string,
  headers: OutgoingHttpHeaders,
  body: Buffer | Readable | null,
  cfg: ProxyConfig,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Hop> {
  let url = start;
  let m = method;
  let h = { ...headers };
  let b = body;
  for (let hop = 0; ; hop++) {
    if (!/^https?:$/.test(url.protocol)) throw new ProxyError(400, '只支持 http/https 目标');
    if (!hostAllowed(url.hostname, cfg.allowHosts)) throw new ProxyError(403, `目标主机不在允许列表内：${url.hostname}`);
    const res = await requestOnce(url, m, h, b, cfg, timeoutMs, signal);
    const loc = res.headers.location;
    if (!REDIRECT.has(res.statusCode ?? 0) || !loc) return { res, url };
    res.resume(); // 丢弃重定向响应体
    if (hop >= cfg.maxRedirects) throw new ProxyError(502, `重定向超过 ${cfg.maxRedirects} 次`);
    let next: URL;
    try {
      next = new URL(loc, url);
    } catch {
      throw new ProxyError(502, `目标返回了无法解析的重定向地址：${loc}`);
    }
    const status = res.statusCode!;
    // 与浏览器一致：303 一律改 GET；301/302 只把 POST 改 GET；307/308 保持方法与请求体
    if (status === 303 && m !== 'HEAD') {
      m = 'GET';
      b = null;
    } else if ((status === 301 || status === 302) && m === 'POST') {
      m = 'GET';
      b = null;
    } else if ((status === 307 || status === 308) && b && !Buffer.isBuffer(b)) {
      throw new ProxyError(502, '目标要求重定向，但请求体是流式上传，无法重放');
    }
    if (b === null) {
      h = { ...h };
      delete h['content-type'];
      delete h['content-length'];
      delete h['transfer-encoding'];
    }
    // 跨主机重定向不带凭据
    if (next.host !== url.host) {
      h = { ...h };
      delete h.authorization;
      delete h.cookie;
    }
    h.host = next.host;
    url = next;
  }
}

function resolveDestination(value: string, requestUrl: URL): string {
  // 前端若把 Destination 写成「本代理 URL」，还原成真正的目标 URL
  try {
    const d = new URL(value, requestUrl);
    if (d.pathname === '/api/proxy' && d.searchParams.get('url')) return d.searchParams.get('url')!;
  } catch {
    /* 原样转发 */
  }
  return value;
}

export const route: RouteModule = {
  register(app, ctx) {
    const { config } = ctx;
    config.features.proxy = config.proxy.mode !== 'off';

    const fail = (c: Context, status: number, message: string) => c.json({ error: message }, status as 400, { 'X-Proxy-Error': '1' });

    app.all('/api/proxy', async (c) => {
      if (!proxyAllowed(config, c)) {
        return fail(c, 403, '代理未开放：服务端未设置 MR_TOKEN，仅允许本机访问（或设置 MR_PROXY=on 强制开放）');
      }
      const target = c.req.query('url');
      if (!target) return fail(c, 400, '缺少参数 url');
      let url: URL;
      try {
        url = new URL(target);
      } catch {
        return fail(c, 400, `url 无法解析：${target}`);
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail(c, 400, '只支持 http/https 目标');

      const method = (c.req.header('X-Proxy-Method') ?? c.req.method).toUpperCase();
      if (!/^[A-Z]+$/.test(method) || ['CONNECT', 'TRACE'].includes(method)) return fail(c, 400, `不支持的方法 ${method}`);

      const headers: OutgoingHttpHeaders = { host: url.host };
      for (const name of FORWARD_REQUEST_HEADERS) {
        const v = c.req.header(name);
        if (v) headers[name] = name === 'destination' ? resolveDestination(v, new URL(c.req.url)) : v;
      }
      const auth = c.req.header('X-Proxy-Authorization');
      if (auth) headers.authorization = auth;
      else if (url.username) headers.authorization = `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`;
      const cookie = c.req.header('X-Proxy-Cookie');
      if (cookie) headers.cookie = cookie;
      headers['user-agent'] = c.req.header('X-Proxy-User-Agent') || config.proxy.userAgent;
      // 要原样字节：不让目标压缩，Content-Length / Range 才对得上
      headers['accept-encoding'] = 'identity';
      if (!headers.accept) headers.accept = '*/*';

      // 请求体：已知且不大的缓冲下来（才能在 307/308 时重放），其余（分块、大文件、长度未知）流式转发
      let body: Buffer | Readable | null = null;
      const cl = c.req.header('Content-Length');
      if (method !== 'GET' && method !== 'HEAD' && c.req.raw.body && cl !== '0') {
        // 真实 HTTP/1.1 请求要么有 Content-Length 要么是分块；两者都没有只会出现在进程内构造的 Request（测试），直接缓冲
        const chunked = !!c.req.header('Transfer-Encoding');
        if (!chunked && (cl === undefined || Number(cl) <= 8 * 1024 * 1024)) {
          body = Buffer.from(await c.req.arrayBuffer());
          headers['content-length'] = String(body.length);
        } else {
          body = Readable.fromWeb(c.req.raw.body as never);
          if (cl !== undefined) headers['content-length'] = cl;
        }
      } else if (!['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(method)) {
        headers['content-length'] = '0';
      }

      const tHeader = Number(c.req.header('X-Proxy-Timeout'));
      const timeoutMs = Number.isFinite(tHeader) && tHeader > 0 ? Math.min(tHeader * 1000, 300_000) : config.proxy.timeoutMs;

      let hop: Hop;
      try {
        hop = await followRequest(url, method, headers, body, config.proxy, timeoutMs, c.req.raw.signal);
      } catch (e) {
        if (e instanceof ProxyError) return fail(c, e.status === 499 ? 502 : e.status, e.message);
        const err = e as NodeJS.ErrnoException & { cause?: unknown };
        const inner = err.cause instanceof ProxyError ? err.cause : err instanceof ProxyError ? err : null;
        if (inner) return fail(c, inner.status, inner.message);
        const code = err.code ?? '';
        const msg = code === 'ENOTFOUND' ? `找不到主机 ${url.hostname}` : code === 'ECONNREFUSED' ? `目标拒绝连接 ${url.host}` : `连接目标失败：${err.message || code}`;
        return fail(c, /TIMEDOUT|TIMEOUT/.test(code) ? 504 : 502, msg);
      }

      const { res, url: finalUrl } = hop;
      const out = new Headers();
      for (const name of FORWARD_RESPONSE_HEADERS) {
        const v = res.headers[name];
        if (v !== undefined) out.set(name, Array.isArray(v) ? v.join(', ') : v);
      }
      // 目标的 WWW-Authenticate 不能原样回：浏览器会弹出自带的登录框，前端自己处理 401
      const www = res.headers['www-authenticate'];
      if (www) out.set('X-Proxy-WWW-Authenticate', Array.isArray(www) ? www.join(', ') : www);
      for (const sc of res.headers['set-cookie'] ?? []) out.append('X-Proxy-Set-Cookie', sc);
      const shown = new URL(finalUrl.href);
      shown.username = '';
      shown.password = '';
      out.set('X-Proxy-Final-Url', shown.href);
      const status = res.statusCode ?? 502;
      if (method === 'HEAD' || status === 204 || status === 304 || status === 205) {
        res.resume();
        return new Response(null, { status, headers: out });
      }
      return new Response(Readable.toWeb(res) as ReadableStream, { status, headers: out });
    });
  },
};
