import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zlibSync } from 'fflate';
import type { AnnotationRecord, BookRecord } from '@/core/library';
import { appSettings } from '@/core/app-settings';
import { syncSettings } from '@/library/settings';
import {
  closeDbForTests,
  DB_NAME,
  deviceId,
  getBookFile,
  getPosition,
  listAnnotations,
  putAnnotation,
  putBook,
  putBookFile,
  resetDeviceId,
  savePosition,
} from './db';
import { decodeAnText, decodePo, decodeRecent, decompressAn, DELETED } from './moon-formats';
import { importPoText, loadSyncConfig, pullBook, pushBook, syncOnOpen, uploadPosition, clientFor, downloadPosition, remoteIsNewer } from './sync';

// ───────────── 内存里的 WebDAV 服务端（挂在 /dav 下，href 带挂载前缀，和真实服务端一致） ─────────────
function fakeDav() {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(['/']);
  const log: string[] = [];
  const href = (p: string, dir: boolean) => `/dav${p.split('/').map(encodeURIComponent).join('/')}${dir && p !== '/' ? '/' : ''}`;
  const entry = (p: string, dir: boolean) =>
    `<D:response><D:href>${href(p, dir)}</D:href><D:propstat><D:prop><D:resourcetype>${dir ? '<D:collection/>' : ''}</D:resourcetype><D:getcontentlength>${dir ? 0 : files.get(p)!.length}</D:getcontentlength><D:getlastmodified>Wed, 21 Oct 2026 10:00:00 GMT</D:getlastmodified></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
  const body = async (b: unknown): Promise<Uint8Array> => {
    if (typeof b === 'string') return strToU8(b);
    if (b instanceof Uint8Array) return b;
    if (b && typeof (b as Blob).arrayBuffer === 'function') return new Uint8Array(await (b as Blob).arrayBuffer());
    return new Uint8Array();
  };
  const handler = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const path = decodeURIComponent(url.pathname).replace(/^\/dav/, '').replace(/\/$/, '') || '/';
    const method = init.method ?? 'GET';
    log.push(`${method} ${path}`);
    if (method === 'MKCOL') {
      if (dirs.has(path)) return new Response(null, { status: 405 });
      dirs.add(path);
      return new Response(null, { status: 201 });
    }
    if (method === 'PUT') {
      files.set(path, await body(init.body));
      return new Response(null, { status: 201 });
    }
    if (method === 'GET') return files.has(path) ? new Response(files.get(path) as unknown as BodyInit) : new Response(null, { status: 404 });
    if (method === 'DELETE') return new Response(null, { status: files.delete(path) || dirs.delete(path) ? 204 : 404 });
    if (method === 'PROPFIND') {
      if (files.has(path)) return new Response(`<D:multistatus xmlns:D="DAV:">${entry(path, false)}</D:multistatus>`, { status: 207 });
      if (!dirs.has(path)) return new Response(null, { status: 404 });
      const prefix = path === '/' ? '/' : path + '/';
      const kids = init.headers && (init.headers as Record<string, string>).Depth === '1'
        ? [...dirs, ...files.keys()].filter((p) => p !== path && p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        : [];
      return new Response(`<D:multistatus xmlns:D="DAV:">${entry(path, true)}${kids.map((k) => entry(k, dirs.has(k))).join('')}</D:multistatus>`, { status: 207 });
    }
    return new Response(null, { status: 500 });
  };
  return { files, dirs, log, handler, text: (p: string) => new TextDecoder().decode(files.get(p)) };
}

const ROOT = '/Apps/Books/.Moon+/Cache';
const book = (p: Partial<BookRecord> = {}): BookRecord => ({
  id: 'bk1',
  fileName: '三体.epub',
  format: 'epub',
  size: 1000,
  title: '三体',
  authors: ['刘慈欣'],
  tags: [],
  addedAt: 1,
  onShelf: true,
  hasCover: false,
  ...p,
});
const hl = (id: string, start: number, updatedAt: number, extra: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  id,
  bookId: 'bk1',
  kind: 'highlight',
  range: { section: 2, start, end: start + 5 },
  text: `原文${id}`,
  color: '#ffeb3b',
  style: 'highlight',
  createdAt: updatedAt,
  updatedAt,
  ...extra,
});

let dav: ReturnType<typeof fakeDav>;

async function wipeDb() {
  await closeDbForTests();
  await new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = () => r();
  });
}

beforeEach(async () => {
  await wipeDb();
  localStorage.clear();
  sessionStorage.clear();
  dav = fakeDav();
  vi.stubGlobal('fetch', dav.handler);
  appSettings.reset();
  appSettings.set({ serverUrl: 'http://srv' });
  syncSettings.reset();
  syncSettings.set({ enabled: true, mode: 'builtin', bookPath: '/Apps/Books', showSyncMsg: false, syncReadingBook: true, syncRecentList: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('云同步：与原版互通的文件格式', () => {
  it('配置：未启用或没有服务端时为 null', async () => {
    expect(await loadSyncConfig()).not.toBeNull();
    syncSettings.set({ enabled: false });
    expect(await loadSyncConfig()).toBeNull();
    syncSettings.set({ enabled: true });
    appSettings.set({ serverUrl: '' });
    expect(await loadSyncConfig()).toBeNull();
  });

  it('pushBook 写出 .po / .an(zlib) / recent.list / 书文件，路径照 §4.4', async () => {
    await putBook(book());
    await putBookFile('bk1', new Blob(['EPUBDATA']));
    await savePosition({ bookId: 'bk1', locator: { section: 3, offset: 12345 }, progress: 0.4567, extra: { webY: 1200.4 } });
    await putAnnotation(hl('n1', 10, 100, { note: '好句' }));
    await putAnnotation(hl('n2', 50, 150, { deletedAt: 150 }));
    await pushBook('bk1');

    // .po：deviceId*位置串|webY，和原版逐字节同构
    const po = decodePo(dav.text(`${ROOT}/三体.epub.po`))!;
    expect(po.deviceId).toBe(deviceId());
    expect(po.position).toBe('3@0#12345:45.67%');
    expect(po.webY).toBe(1200);
    // 旁路文件带精确位置与时间，原版不会读它
    expect(JSON.parse(dav.text(`${ROOT}/三体.epub.po.json`))).toMatchObject({ section: 3, offset: 12345, bookId: 'bk1' });
    // .an：zlib 头 78 9c，内容是 §4.4 文本，墓碑写成 *DELETED*
    const raw = dav.files.get(`${ROOT}/三体.epub.an`)!;
    expect([raw[0], raw[1]]).toEqual([0x78, 0x9c]);
    const an = decodeAnText(decompressAn(raw))!;
    expect(an.fileSize).toBe(1000);
    expect(an.notes).toHaveLength(2);
    expect(an.notes.find((n) => n.bak === DELETED)!.position).toBe(50);
    expect(an.notes.find((n) => n.note === '好句')!.original).toBe('原文n1');
    // 书文件与最近阅读
    expect(dav.text('/Apps/Books/三体.epub')).toBe('EPUBDATA');
    const rec = decodeRecent(dav.text(`${ROOT}/recent.list`))!;
    expect(rec).toMatchObject({ title: '三体', size: 1000, deviceId: deviceId(), cloudPath: '/Apps/Books/三体.epub' });
  });

  it('另一台设备 pullBook：位置与标注（含删除墓碑）合并过来', async () => {
    await putBook(book());
    await savePosition({ bookId: 'bk1', locator: { section: 3, offset: 12345 }, progress: 0.4567 });
    await putAnnotation(hl('n1', 10, 100));
    await putAnnotation(hl('n2', 50, 150, { deletedAt: 150 }));
    await pushBook('bk1');

    await wipeDb();
    resetDeviceId();
    await putBook(book());
    const r = await pullBook('bk1');
    expect(r).toEqual({ position: true, annotations: true });
    expect((await getPosition('bk1'))!.locator).toEqual({ section: 3, offset: 12345 });
    const anns = await listAnnotations('bk1');
    expect(anns.map((a) => a.range.start)).toEqual([10]); // 被删的那条不会复活
  });

  it('读取原版 App 写的 .po / .an', async () => {
    await putBook(book());
    dav.files.set(`${ROOT}/三体.epub.po`, strToU8('1698000000000*3@0#12345:45.67%|1200'));
    // 原版 .an：第一行是书文件大小；16 个字段；字段内换行写成 <BR>
    const note = (pos: number, extra: string[] = []) =>
      ['#', '7', '三体.epub', '/sdcard/Books/三体.epub', '/sdcard/books/三体.epub', '2', '0', String(pos), '5', String(0x77ffeb3b | 0), '1698000000000', '', extra[0] ?? '', `原文<BR>第二行`, '0', '0', ''].join('\n');
    dav.files.set(`${ROOT}/三体.epub.an`, zlibSync(strToU8(['1000', 'indent:false', 'trim:false', note(100, ['手机上的笔记']), ''].join('\n'))));

    const asked: number[] = [];
    const r = await syncOnOpen('bk1', { confirmPosition: async ({ remote }) => (asked.push(remote.offset), true) });
    expect(r).toEqual({ position: true, annotations: true });
    expect(asked).toEqual([12345]);
    const pos = (await getPosition('bk1'))!;
    expect(pos.locator).toEqual({ section: 3, offset: 12345 });
    expect(pos.progress).toBeCloseTo(0.4567, 4);
    expect(pos.extra).toMatchObject({ webY: 1200 });
    const [a] = await listAnnotations('bk1');
    expect(a).toMatchObject({ note: '手机上的笔记', text: '原文\n第二行', range: { section: 2, start: 100, end: 105 } });
  });

  it('用户拒绝时不改本地位置；PDF 位置串（无 #）取冒号前的页码', async () => {
    await putBook(book({ id: 'pdf1', fileName: 'a.pdf', format: 'pdf' }));
    await savePosition({ bookId: 'pdf1', locator: { section: 1, offset: 0 }, progress: 0.1 });
    dav.files.set(`${ROOT}/a.pdf.po`, strToU8('1698000000000*12:45.6%'));
    expect(await syncOnOpen('pdf1', { confirmPosition: async () => false })).toEqual({ position: false, annotations: false });
    expect((await getPosition('pdf1'))!.locator.section).toBe(1);
    expect(await syncOnOpen('pdf1', { confirmPosition: async () => true })).toMatchObject({ position: true });
    expect((await getPosition('pdf1'))!.locator).toEqual({ section: 12, offset: 0 });
  });

  it('自己传的 .po 不会反过来覆盖；5 分钟内位置没变不重复上传；差异很小不打扰', async () => {
    await putBook(book());
    await savePosition({ bookId: 'bk1', locator: { section: 3, offset: 100 }, progress: 0.3 });
    const cfg = (await loadSyncConfig())!;
    const client = clientFor(cfg);
    const b = book();
    expect(await uploadPosition(client, cfg, b)).toBe(true);
    expect(await uploadPosition(client, cfg, b)).toBe(false);
    expect(await uploadPosition(client, cfg, b, true)).toBe(true);
    expect(await syncOnOpen('bk1', { confirmPosition: async () => true })).toEqual({ position: false, annotations: false });
    // 另一台设备同章只差 50 字符：不算差异
    dav.files.set(`${ROOT}/三体.epub.po`, strToU8('othr*3@0#150:30.00%'));
    expect(await syncOnOpen('bk1', { confirmPosition: async () => true })).toMatchObject({ position: false });
  });

  it('Web 端有时间戳：远端更旧时不提示，更新时才提示', async () => {
    await putBook(book());
    await savePosition({ bookId: 'bk1', locator: { section: 3, offset: 100 }, progress: 0.3, updatedAt: 5000 });
    const cfg = (await loadSyncConfig())!;
    const remote = (updatedAt: number) => ({ deviceId: 'other', section: 9, offset: 0, progress: 0.9, updatedAt, exact: true, raw: '' });
    const local = (await getPosition('bk1'))!;
    expect(remoteIsNewer(local, remote(4000))).toBe(false);
    expect(remoteIsNewer(local, remote(6000))).toBe(true);
    expect(remoteIsNewer(local, { ...remote(0), exact: false })).toBe(true); // 原版没有时间戳：沿用「最后上传者胜出」
    void cfg;
    void downloadPosition;
  });

  it('importPoText：导入单个 .po 文件，坏文件返回 false', async () => {
    await putBook(book());
    expect(await importPoText('bk1', '1698000000000*5@0#99:10.00%')).toBe(true);
    expect((await getPosition('bk1'))!.locator).toEqual({ section: 5, offset: 99 });
    expect(await importPoText('bk1', 'garbage')).toBe(false);
    expect(await importPoText('missing', '1*1#1:1%')).toBe(false);
  });

  it('云端书籍文件：同名同大小不重复上传', async () => {
    await putBook(book({ size: 8 }));
    await putBookFile('bk1', new Blob(['EPUBDATA']));
    await pushBook('bk1');
    dav.log.length = 0;
    await pushBook('bk1');
    expect(dav.log.filter((l) => l.startsWith('PUT') && l.endsWith('三体.epub'))).toEqual([]);
    expect(await (await getBookFile('bk1'))!.text()).toBe('EPUBDATA');
  });
});
