// 鉴权与「是否本机请求」判断。
import type { Context } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import type { ServerConfig } from '../config';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** 提取请求里携带的令牌：Bearer、Basic（密码即令牌，用户名随意，给 WebDAV 客户端用）、?token= */
export function extractTokens(c: Context): string[] {
  const out: string[] = [];
  const auth = c.req.header('Authorization') ?? '';
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearer) out.push(bearer[1].trim());
  const basic = /^Basic\s+(.+)$/i.exec(auth);
  if (basic) {
    const decoded = Buffer.from(basic[1].trim(), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    out.push(i < 0 ? decoded : decoded.slice(i + 1));
  }
  const q = c.req.query('token');
  if (q) out.push(q);
  return out;
}

export function isAuthorized(config: ServerConfig, c: Context): boolean {
  if (!config.token) return true;
  return extractTokens(c).some((t) => safeEqual(t, config.token));
}

/** 直连的客户端地址。进程内调用（测试 app.request）拿不到时为 undefined */
export function remoteAddress(c: Context): string | undefined {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress;
}

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;

/**
 * 请求是否来自本机：直连地址是回环，且没有经过反向代理（带 X-Forwarded-For 等头就不算，
 * 因为反代在本机时所有外部请求看起来都是 127.0.0.1）。拿不到地址（进程内调用）视为本机。
 */
export function isLocalRequest(c: Context): boolean {
  if (c.req.header('X-Forwarded-For') || c.req.header('Forwarded') || c.req.header('X-Real-IP')) return false;
  const addr = remoteAddress(c);
  if (addr === undefined) return true;
  return LOOPBACK.test(addr) || addr === 'localhost';
}
