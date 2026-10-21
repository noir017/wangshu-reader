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
