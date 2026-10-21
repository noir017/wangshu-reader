// @vitest-environment node
import type { ArchiveListResponse } from '@shared/api';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { png, writeZip } from '../test-fixtures';
import { j, makeApp, put, tmp } from '../test-utils';
import { find7z } from '../util/exec';

const has7z = !!find7z();
const SAMPLES = path.join(process.cwd(), 'samples');

const call = (app: Hono, url: string, body: Uint8Array | string) => app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });

const bytes = async (res: Response) => new Uint8Array(await res.arrayBuffer());

async function comicZip(): Promise<Uint8Array> {
  const f = path.join(tmp(), 'c.zip');
  await writeZip(f, [
    { name: 'ch1/page10.png', data: png(30, 40, [1, 2, 3]) },
    { name: 'ch1/page2.png', data: png(30, 40, [4, 5, 6]) },
    { name: 'ch1/page1.png', data: png(30, 40, [7, 8, 9]) },
    { name: 'ComicInfo.xml', data: '<ComicInfo><Title>t</Title></ComicInfo>' },
    { name: '__MACOSX/ch1/._page1.png', data: 'junk' },
    { name: 'ch1/.hidden.png', data: 'junk' },
    { name: 'readme.txt', data: 'not an image' },
  ]);
  return readFileSync(f);
}

describe.skipIf(!has7z)('/api/archive', () => {
  it('list：返回全部条目（含目录标记与大小）', async () => {
    const { app } = makeApp();
    const res = await call(app, '/api/archive/list?name=c.zip', await comicZip());
    expect(res.status).toBe(200);
    const { entries } = await j<ArchiveListResponse>(res);
    expect(entries.find((e) => e.path === 'ch1/page1.png')).toMatchObject({ dir: false });
    expect(entries.find((e) => e.path === 'readme.txt')?.size).toBe(12);
  });

  it('extract：取出单个条目；不存在 404、缺参数 400、空请求体 400、不是压缩包 422', async () => {
    const { app } = makeApp();
    const zip = await comicZip();
    const ok = await call(app, '/api/archive/extract?name=c.zip&entry=readme.txt', zip);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('not an image');
    expect(ok.headers.get('Content-Disposition')).toContain('readme.txt');
    expect((await call(app, '/api/archive/extract?name=c.zip&entry=nope.txt', zip)).status).toBe(404);
    expect((await call(app, '/api/archive/extract?name=c.zip', zip)).status).toBe(400);
    expect((await app.request('/api/archive/extract?name=c.zip&entry=a', { method: 'POST' })).status).toBe(400);
    expect((await call(app, '/api/archive/list?name=x.zip', 'this is not an archive at all')).status).toBe(422);
  });

  it('条目路径里的 .. 找不到条目（不会读到临时目录之外）', async () => {
    const { app } = makeApp();
    const res = await call(app, `/api/archive/extract?name=c.zip&entry=${encodeURIComponent('../../etc/passwd')}`, await comicZip());
    expect(res.status).toBe(404);
  });

  it('请求体超过 MR_MAX_CONVERT_MB 返回 413，临时文件不残留', async () => {
    const { app, config } = makeApp({ MR_MAX_CONVERT_MB: '0.001' });
    const res = await call(app, '/api/archive/list?name=a.zip', new Uint8Array(5000));
    expect(res.status).toBe(413);
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(config.tmpDir)).toEqual([]);
  });
});

describe.skipIf(!has7z)('/api/convert → cbz', () => {
  it('zip → cbz：只留图片与 ComicInfo.xml、按自然序、丢掉隐藏与 __MACOSX', async () => {
    const { app, config } = makeApp();
    const res = await call(app, '/api/convert?to=cbz&name=%E6%BC%AB%E7%94%BB.cbr', await comicZip());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/vnd.comicbook+zip');
    expect(res.headers.get('Content-Disposition')).toContain("filename*=UTF-8''%E6%BC%AB%E7%94%BB.cbz");
    const files = unzipSync(await bytes(res));
    expect(Object.keys(files)).toContain('ComicInfo.xml');
    expect(Object.keys(files).filter((n) => n.endsWith('.png'))).toEqual(['ch1/page1.png', 'ch1/page2.png', 'ch1/page10.png']);
    expect(Object.keys(files)).not.toContain('readme.txt');
    expect(Object.keys(files).some((n) => n.includes('MACOSX') || n.includes('.hidden'))).toBe(false);
    // 响应流读完后临时目录被清掉
    await new Promise((r) => setTimeout(r, 100));
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(config.tmpDir)).toEqual([]);
  });

  it('7z（cb7）→ cbz；name 没有扩展名时按文件头判断', async () => {
    const work = tmp();
    put(work, 'pg/p1.png', png(10, 10, [1, 1, 1]));
    put(work, 'pg/p2.png', png(10, 10, [2, 2, 2]));
    execFileSync(find7z()!, ['a', '-bd', '-y', path.join(work, 'c.7z'), path.join(work, 'pg')], { stdio: 'ignore' });
    const { app } = makeApp();
    const sevenZ = readFileSync(path.join(work, 'c.7z'));
    for (const name of ['c.cb7', 'noext', 'wrong.txt']) {
      const res = await call(app, `/api/convert?to=cbz&name=${name}`, sevenZ);
      expect(res.status, name).toBe(200);
      expect(Object.keys(unzipSync(await bytes(res))).filter((n) => n.endsWith('.png')).length).toBe(2);
    }
  });

  it('错误：缺 to / 不支持的转换 400；没有图片 422；DJVU 没有 ddjvu 时 501', async () => {
    const { app } = makeApp();
    const zip = await comicZip();
    expect((await call(app, '/api/convert?name=a.cbr', zip)).status).toBe(400);
    expect((await call(app, '/api/convert?to=cbz&name=a.txt', 'plain text')).status).toBe(400);
    expect((await call(app, '/api/convert?to=epub&name=a.cbz', zip)).status).toBe(400);
    const noImg = path.join(tmp(), 'n.zip');
    await writeZip(noImg, [{ name: 'a.txt', data: 'x' }]);
    expect((await call(app, '/api/convert?to=cbz&name=n.zip', readFileSync(noImg))).status).toBe(422);
    const prev = process.env.MR_BIN_DDJVU;
    process.env.MR_BIN_DDJVU = '/nonexistent/ddjvu';
    try {
      const res = await call(makeApp().app, '/api/convert?to=pdf&name=a.djvu', 'AT&TFORM....');
      expect(res.status).toBe(501);
    } finally {
      if (prev === undefined) delete process.env.MR_BIN_DDJVU;
      else process.env.MR_BIN_DDJVU = prev;
    }
  });
});

describe('/api/convert djvu → pdf', () => {
  it('有 ddjvu 时转换并在 health 里报 convert.djvu（这里用替身脚本验证调用方式）', async () => {
    const bin = path.join(tmp(), 'ddjvu');
    // 真 ddjvu 的用法：ddjvu -format=pdf in.djvu out.pdf
    writeFileSync(bin, '#!/bin/sh\n[ "$1" = "-format=pdf" ] || exit 3\ncp "$2" /dev/null || exit 4\nprintf "%%PDF-1.4 fake" > "$3"\n');
    chmodSync(bin, 0o755);
    const prev = process.env.MR_BIN_DDJVU;
    process.env.MR_BIN_DDJVU = bin;
    try {
      const { app } = makeApp();
      expect((await j<{ features: Record<string, boolean> }>(await app.request('/api/health'))).features['convert.djvu']).toBe(true);
      const res = await call(app, '/api/convert?to=pdf&name=%E4%B9%A6.djvu', 'AT&TFORM-fake-djvu');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect((await res.text()).startsWith('%PDF-')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MR_BIN_DDJVU;
      else process.env.MR_BIN_DDJVU = prev;
    }
  });
});

const rarDir = path.join(SAMPLES, 'rar');
describe.skipIf(!existsSync(path.join(rarDir, 'FolderTest.rar')) || !has7z)('RAR（样本在 samples/rar，不进 git）', () => {
  const sample = (n: string) => readFileSync(path.join(rarDir, n));

  it('列目录 + 取压缩过的条目（Debian 的 7zip 解不了，走 node-unrar-js）', async () => {
    const { app } = makeApp();
    const list = await j<ArchiveListResponse>(await call(app, '/api/archive/list?name=a.rar', sample('FolderTest.rar')));
    expect(list.entries.map((e) => e.path)).toContain('Folder1/Folder Space/long.txt');
    const big = await call(app, `/api/archive/extract?name=a.rar&entry=${encodeURIComponent('Folder1/Folder Space/long.txt')}`, sample('FolderTest.rar'));
    expect(big.status).toBe(200);
    expect((await bytes(big)).length).toBe(1049076);
    const cn = await call(app, `/api/archive/extract?name=a.rar&entry=${encodeURIComponent('Folder1/Folder 中文/2中文.txt')}`, sample('FolderTest.rar'));
    expect((await cn.text()).replace(/^﻿/, '')).toBe('中文中文');
  });

  it('书库里浏览 rar、读条目；没有图片的 rar → cbz 报 422', async () => {
    const lib = tmp();
    writeFileSync(path.join(lib, 'FolderTest.rar'), sample('FolderTest.rar'));
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    const list = await j<{ entries: { name: string }[] }>(await app.request(`/api/library/list?path=${encodeURIComponent('FolderTest.rar?Folder1')}`));
    expect(list.entries.map((e) => e.name)).toEqual(['Folder Space', 'Folder 中文']);
    const f = await app.request(`/api/library/file?path=${encodeURIComponent('FolderTest.rar?Folder1/Folder Space/long.txt')}`);
    expect((await bytes(f)).length).toBe(1049076);
    expect((await call(app, '/api/convert?to=cbz&name=a.cbr', sample('FolderTest.rar'))).status).toBe(422);
  });

  it('并发读同一个 rar 的不同条目互不干扰（unrar 库是单例，必须串行）', async () => {
    const { app } = makeApp();
    const rar = sample('FolderTest.rar');
    const get = async (entry: string) => bytes(await call(app, `/api/archive/extract?name=a.rar&entry=${encodeURIComponent(entry)}`, rar));
    const [a, b, c] = await Promise.all([get('Folder1/Folder Space/long.txt'), get('Folder1/Folder 中文/2中文.txt'), get('Folder1/Folder Space/long.txt')]);
    expect(a.length).toBe(1049076);
    expect(c.length).toBe(1049076);
    expect(b.length).toBeLessThan(100);
  });

  it('加密的 rar 取条目 → 422', async () => {
    if (!existsSync(path.join(rarDir, 'FileEncByName.rar'))) return;
    const { app } = makeApp();
    const res = await call(app, '/api/archive/extract?name=a.rar&entry=3Sec.txt', sample('FileEncByName.rar'));
    expect(res.status).toBe(422);
  });
});
