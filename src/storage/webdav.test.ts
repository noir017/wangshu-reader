import { describe, expect, it } from 'vitest';
import { DavClient, parseMultiStatus, type DavTransport } from './webdav';

const MS = (items: string) => `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${items}</D:multistatus>`;
const item = (href: string, dir: boolean, size = 0, mod = 'Wed, 21 Oct 2026 10:00:00 GMT') =>
  `<D:response><D:href>${href}</D:href><D:propstat><D:prop><D:displayname>x</D:displayname><D:resourcetype>${dir ? '<D:collection/>' : ''}</D:resourcetype><D:getcontentlength>${size}</D:getcontentlength><D:getlastmodified>${mod}</D:getlastmodified></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;

describe('webdav', () => {
  it('解析 multistatus：目录/文件/大小/中文路径', () => {
    const list = parseMultiStatus(MS(item('/dav/%E4%B9%A6/', true) + item('/dav/%E4%B9%A6/a%20b.epub', false, 1234)));
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ path: '/dav/书', dir: true });
    expect(list[1]).toMatchObject({ path: '/dav/书/a b.epub', dir: false, size: 1234 });
    expect(list[1].mtime).toBe(Date.parse('2026-10-21T10:00:00Z'));
  });
  it('无前缀命名空间也能解析', () => {
    const xml = `<multistatus xmlns="DAV:"><response><href>/a/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
    expect(parseMultiStatus(xml)[0].dir).toBe(true);
  });

  const mock = () => {
    const calls: { method: string; path: string; headers?: Record<string, string> }[] = [];
    const files = new Map<string, string>();
    const dirs = new Set<string>(['/']);
    const tx: DavTransport = async (method, path, init) => {
      calls.push({ method, path, headers: init?.headers });
      if (method === 'MKCOL') {
        if (dirs.has(path)) return new Response(null, { status: 405 });
        dirs.add(path);
        return new Response(null, { status: 201 });
      }
      if (method === 'PUT') {
        files.set(path, String(init?.body));
        return new Response(null, { status: 201 });
      }
      if (method === 'GET') return files.has(path) ? new Response(files.get(path)) : new Response(null, { status: 404 });
      if (method === 'PROPFIND') {
        if (dirs.has(path)) {
          const kids = [...dirs].filter((d) => d !== path && d.startsWith(path === '/' ? '/' : path + '/') && d.split('/').length === path.split('/').length + (path === '/' ? 0 : 1));
          const fl = [...files.keys()].filter((f) => f.startsWith(path === '/' ? '/' : path + '/') && f.split('/').length === path.split('/').length + (path === '/' ? 0 : 1));
          return new Response(MS(item(path + '/', true) + kids.map((k) => item(k + '/', true)).join('') + fl.map((f) => item(f, false, files.get(f)!.length)).join('')), { status: 207 });
        }
        if (files.has(path)) return new Response(MS(item(path, false, files.get(path)!.length)), { status: 207 });
        return new Response(null, { status: 404 });
      }
      if (method === 'DELETE') return new Response(null, { status: files.delete(path) ? 204 : 404 });
      return new Response(null, { status: 500 });
    };
    return { tx, calls, files };
  };

  it('PUT 前逐级 MKCOL 并缓存，405 视为已存在', async () => {
    const { tx, calls } = mock();
    const dav = new DavClient(tx);
    await dav.put('/Apps/Books/.Moon+/Cache/a.epub.po', 'x*1#2');
    await dav.put('/Apps/Books/.Moon+/Cache/b.epub.po', 'y');
    const mk = calls.filter((c) => c.method === 'MKCOL').map((c) => c.path);
    expect(mk).toEqual(['/Apps', '/Apps/Books', '/Apps/Books/.Moon+', '/Apps/Books/.Moon+/Cache']);
    expect(await dav.getText('/Apps/Books/.Moon+/Cache/a.epub.po')).toBe('x*1#2');
    expect(await dav.getText('/nope')).toBeNull();
  });
  it('list 剔除自身，exists/delete', async () => {
    const { tx } = mock();
    const dav = new DavClient(tx);
    await dav.put('/d/a.txt', 'hello');
    const l = await dav.list('/d');
    expect(l.map((e) => e.name)).toEqual(['a.txt']);
    expect(await dav.exists('/d/a.txt')).toBe(true);
    expect(await dav.exists('/d/zzz')).toBe(false);
    await dav.delete('/d/a.txt');
    expect(await dav.exists('/d/a.txt')).toBe(false);
  });

  it('href 带挂载前缀（/dav/…）时 list 也能剔除目录自身，且不误伤同名子目录', async () => {
    const xml = MS(item('/dav/a/', true) + item('/dav/a/a/', true) + item('/dav/a/x.txt', false, 3));
    const tx: DavTransport = async () => new Response(xml, { status: 207 });
    const l = await new DavClient(tx).list('/a');
    expect(l.map((e) => e.name)).toEqual(['a', 'x.txt']);
    const root = MS(item('/dav/', true) + item('/dav/Apps/', true));
    const l2 = await new DavClient(async () => new Response(root, { status: 207 })).list('/');
    expect(l2.map((e) => e.name)).toEqual(['Apps']);
  });
});
