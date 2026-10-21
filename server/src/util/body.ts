// 请求体落盘、临时目录、文件流响应。
import type { Context } from 'hono';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ServerConfig } from '../config';
import { httpError } from './http';

/** 把请求体流式写到 dest；超过 maxBytes（0 = 不限）报 413 */
export async function saveBody(c: Context, dest: string, maxBytes: number): Promise<number> {
  const body = c.req.raw.body;
  if (!body) throw httpError(400, '请求体为空');
  const cl = Number(c.req.header('Content-Length'));
  if (maxBytes > 0 && Number.isFinite(cl) && cl > maxBytes) throw httpError(413, `文件过大（上限 ${Math.round(maxBytes / 1048576)} MB）`);
  let n = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      n += chunk.length;
      if (maxBytes > 0 && n > maxBytes) cb(httpError(413, `文件过大（上限 ${Math.round(maxBytes / 1048576)} MB）`));
      else cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(body as never), counter, createWriteStream(dest));
  if (n === 0) throw httpError(400, '请求体为空');
  return n;
}

export interface TempDir {
  dir: string;
  cleanup(): Promise<void>;
}

export async function makeTempDir(config: Pick<ServerConfig, 'tmpDir'>, prefix = 'mr-'): Promise<TempDir> {
  await mkdir(config.tmpDir, { recursive: true });
  const dir = await mkdtemp(path.join(config.tmpDir, prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** 启动时清掉上次崩溃遗留的临时目录（超过 maxAgeMs 的） */
export async function cleanStaleTmp(tmpDir: string, maxAgeMs = 24 * 3600_000): Promise<void> {
  try {
    for (const name of await readdir(tmpDir)) {
      const p = path.join(tmpDir, name);
      const st = await stat(p).catch(() => null);
      if (st && Date.now() - st.mtimeMs > maxAgeMs) await rm(p, { recursive: true, force: true });
    }
  } catch {
    /* 目录不存在等，忽略 */
  }
}

/** 以流返回一个本地文件；流关闭（读完/客户端断开）后执行 onClose（清理临时文件） */
export function fileStreamResponse(file: string, size: number, headers: Record<string, string>, onClose?: () => void): Response {
  const rs = createReadStream(file);
  if (onClose) rs.on('close', onClose);
  return new Response(Readable.toWeb(rs) as ReadableStream, { status: 200, headers: { 'Content-Length': String(size), ...headers } });
}
