// @vitest-environment node
// 客户端中途断开不能让服务端崩溃（流上未处理的 error 事件会直接终止进程），也不能留下临时文件/子进程。
import { execFileSync } from 'node:child_process';
import { readdirSync, truncateSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { writeZip } from './test-fixtures';
import { listen, makeApp, put, tmp } from './test-utils';
import { find7z } from './util/exec';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 发出一个请求，收到第一块响应数据后立刻掐断连接 */
function getAndDrop(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.once('data', () => {
        res.destroy();
        req.destroy();
        resolve(res.statusCode ?? 0);
      });
    });
    req.on('error', () => undefined);
    setTimeout(() => reject(new Error('没收到响应数据')), 10_000);
  });
}

/** 发出声明了大 Content-Length 的请求、写一部分就断开 */
function postAndDrop(port: number, pathAndQuery: string, headers: string, bodyHead: Buffer, announce: number): Promise<void> {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`POST ${pathAndQuery} HTTP/1.1\r\nHost: x\r\n${headers}Content-Length: ${announce}\r\n\r\n`);
      sock.write(bodyHead);
      setTimeout(() => {
        sock.destroy();
        resolve();
      }, 150);
    });
    sock.on('error', () => undefined);
  });
}

const alive = async (url: string) => expect((await fetch(`${url}/api/health`)).status).toBe(200);

describe('客户端中途断开', () => {
  const lib = tmp('mr-lib-');
  const { app, config } = makeApp({ MR_LIBRARY_DIR: lib });
  let srv: Awaited<ReturnType<typeof listen>>;
  let port: number;
  const ready = listen(app).then((s) => {
    srv = s;
    port = Number(new URL(s.url).port);
  });
  afterAll(async () => srv?.close());

  it('下载大文件到一半断开', async () => {
    await ready;
    const big = put(lib, 'big.bin');
    truncateSync(big, 64 * 1024 * 1024);
    expect(await getAndDrop(`${srv.url}/api/library/file?path=big.bin`)).toBe(200);
    await sleep(200);
    await alive(srv.url);
  });

  it.skipIf(!find7z())('读压缩包里的大条目到一半断开：7z 子进程被结束，不留临时文件', async () => {
    await ready;
    await writeZip(path.join(lib, 'a.zip'), [{ name: 'big.bin', data: Buffer.alloc(40 * 1024 * 1024, 1), compress: false }]);
    expect(await getAndDrop(`${srv.url}/api/library/file?path=${encodeURIComponent('a.zip?big.bin')}`)).toBe(200);
    await sleep(500);
    await alive(srv.url);
    // 不用 pgrep -f：它会匹配到执行它的 sh 自己
    const procs = execFileSync('ps', ['-eo', 'args']).toString().split('\n').filter((l) => l.includes(' x -so ') && l.includes(path.join(lib, 'a.zip')));
    expect(procs).toEqual([]);
  });

  it('上传转换用的压缩包到一半断开：临时目录被清掉', async () => {
    await ready;
    await postAndDrop(port, '/api/convert?to=cbz&name=a.cbr', 'Content-Type: application/octet-stream\r\n', Buffer.alloc(30000, 1), 10_000_000);
    await sleep(300);
    await alive(srv.url);
    expect(readdirSync(config.tmpDir)).toEqual([]);
  });

  it('WebDAV PUT 到一半断开：不留 .mr-part，目标文件不存在', async () => {
    await ready;
    await postAndDrop(port, '/dav/half.bin', '', Buffer.alloc(30000, 1), 10_000_000).catch(() => undefined);
    // 上面发的是 POST，换成 PUT 再来一次
    await new Promise<void>((resolve) => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.write('PUT /dav/half.bin HTTP/1.1\r\nHost: x\r\nContent-Length: 10000000\r\n\r\n');
        sock.write(Buffer.alloc(30000, 1));
        setTimeout(() => {
          sock.destroy();
          resolve();
        }, 150);
      });
      sock.on('error', () => undefined);
    });
    await sleep(300);
    await alive(srv.url);
    expect(readdirSync(path.join(config.dataDir, 'dav'))).toEqual([]);
  });

  it('代理：客户端断开后上游连接被关掉；上游中途断开时客户端得到被截断的响应而不是服务端崩溃', async () => {
    await ready;
    let upstreamClosed = false;
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      const t = setInterval(() => res.write(Buffer.alloc(16 * 1024, 1)), 10);
      res.on('close', () => {
        clearInterval(t);
        upstreamClosed = true;
      });
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    const up = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/`;
    try {
      expect(await getAndDrop(`${srv.url}/api/proxy?url=${encodeURIComponent(up)}`)).toBe(200);
      for (let i = 0; i < 40 && !upstreamClosed; i++) await sleep(50);
      expect(upstreamClosed).toBe(true);
      await alive(srv.url);
    } finally {
      upstream.closeAllConnections();
      upstream.close();
    }
    // 上游自己中途掐断
    const rude = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': '1000000' });
      res.write(Buffer.alloc(1000, 1));
      setTimeout(() => res.socket?.destroy(), 50);
    });
    await new Promise<void>((r) => rude.listen(0, '127.0.0.1', r));
    try {
      const res = await fetch(`${srv.url}/api/proxy?url=${encodeURIComponent(`http://127.0.0.1:${(rude.address() as AddressInfo).port}/`)}`);
      await expect(res.arrayBuffer()).rejects.toThrow();
      await alive(srv.url);
    } finally {
      rude.closeAllConnections();
      rude.close();
    }
  });
});
