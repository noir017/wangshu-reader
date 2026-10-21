// /dav 的 CORS：预检（带 Access-Control-Request-Method 的 OPTIONS）直接应答，
// 其余请求（包括 WebDAV 客户端不带 Origin 的 OPTIONS 能力探测）放行，并在响应上补 CORS 头。
import type { MiddlewareHandler } from 'hono';

export function davCors(exposeHeaders: string[], methods: string[]): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin && c.req.method === 'OPTIONS' && c.req.header('Access-Control-Request-Method')) {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': methods.join(','),
          'Access-Control-Allow-Headers': c.req.header('Access-Control-Request-Headers') ?? 'Authorization,Content-Type,Depth,Destination,Overwrite,Range,If-Match,If-None-Match,Lock-Token,Timeout',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
    }
    await next();
    if (origin) {
      c.res.headers.set('Access-Control-Allow-Origin', origin);
      c.res.headers.set('Access-Control-Expose-Headers', exposeHeaders.join(','));
      c.res.headers.append('Vary', 'Origin');
    }
  };
}

const LOOPBACK_NAME = /^(localhost|127(\.\d+){3}|\[::1\])$/i;
const IP_LITERAL = /^(\d+(\.\d+){3}|\[[0-9a-f:.]+\])$/i;

const hostnameOf = (hostHeader: string): string => hostHeader.replace(/:\d+$/, '').toLowerCase();

/**
 * 没设 MR_TOKEN 时的跨站防护：任何网页都能让浏览器去请求 http://127.0.0.1:8090，而 CORS 对 API 是全开的，
 * 不拦的话你随手打开的一个恶意网页就能读书库、用代理打内网。这里拒绝「来源是别的站点」的请求：
 * 没有 Origin（curl、WebDAV 客户端、同源 GET）、Origin 为 null（file:// 打开的单文件版）、来源是本机/IP 字面量，
 * 或来源主机就是请求的 Host（服务端自己托管前端；反代时看 X-Forwarded-Host）才放行。
 * 局限：DNS 重绑定（恶意域名解析到本机，Origin 与 Host 相同）拦不住——要彻底防就设 MR_TOKEN。
 */
export function originGuard(): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('Origin');
    if (!origin || origin === 'null') return next();
    let host: string;
    try {
      host = new URL(origin).hostname.toLowerCase();
      if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
    } catch {
      return c.json({ error: 'Origin 无法解析' }, 403);
    }
    if (LOOPBACK_NAME.test(host) || IP_LITERAL.test(host)) return next();
    const hosts = [c.req.header('X-Forwarded-Host'), c.req.header('Host')].filter(Boolean).flatMap((h) => h!.split(',').map((x) => hostnameOf(x.trim())));
    if (hosts.includes(hostnameOf(host))) return next();
    return c.json({ error: `拒绝来自 ${origin} 的跨站请求：服务端没有设置 MR_TOKEN，只接受本机/同源页面（设置 MR_TOKEN 后可从任意站点访问）` }, 403);
  };
}
