// 测试共用工具：临时目录、按环境变量造一个 app、真的监听一个随机端口（需要真实 socket 的测试用）。
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';
import { loadConfig, type ServerConfig } from './config';
import { createApp } from './index';

const made: string[] = [];

/** 新建临时目录，所在测试文件结束后自动删除 */
export function tmp(prefix = 'mr-test-'): string {
  const d = mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
}

afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

export interface TestApp {
  app: Hono;
  config: ServerConfig;
  /** 本次测试的根目录：data、library 等都在它下面 */
  root: string;
}

/** env 里没给 MR_DATA_DIR / MR_STATIC_DIR 时用临时目录 / 不托管静态文件 */
export function makeApp(env: Record<string, string> = {}): TestApp {
  const root = tmp();
  const config = loadConfig({
    MR_DATA_DIR: path.join(root, 'data'),
    MR_STATIC_DIR: path.join(root, 'no-static'),
    ...env,
  });
  return { app: createApp(config), config, root };
}

/** 监听随机端口。端口监听在回环地址，所以 isLocalRequest 为真 */
export async function listen(app: Hono): Promise<{ url: string; close(): Promise<void> }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info: AddressInfo) => {
      resolve({
        url: `http://127.0.0.1:${info.port}`,
        close: () =>
          new Promise<void>((r) => {
            (server as import('node:http').Server).closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

/** 在 dir 下写文件（自动建父目录），返回绝对路径 */
export function put(dir: string, rel: string, data: string | Uint8Array = ''): string {
  const p = path.join(dir, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, data);
  return p;
}

export const j = async <T = unknown>(res: Response): Promise<T> => (await res.json()) as T;
