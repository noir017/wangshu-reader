// /api/library/* —— 服务端书库目录（文件页 LIB-028）。
import type { LibraryEntry, LibraryListResponse, LibraryOpRequest } from '@shared/api';
import busboy from 'busboy';
import type { Context } from 'hono';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { RouteModule } from '../index';
import { extractEntryStream, require7z } from '../lib/archive';
import { Library, type ArchiveNode, type FsNode, type Resolved } from '../lib/library-fs';
import { copyTree, isInside, movePath, realInside, TMP_SUFFIX, uniqueName } from '../lib/safe-path';
import { SAFE_HEADERS, serveFile } from '../lib/serve-file';
import { extractCover, makeThumbnail, type CoverImage } from '../lib/thumb';
import { contentDisposition, extOf, httpError, mimeOf, sanitizeFileName } from '../util/http';
import { find7z } from '../util/exec';

const MAX_UPLOAD_FILES = 1000;

export const route: RouteModule = {
  register(app, ctx) {
    const { config } = ctx;
    const roots = config.libraryRoots;
    config.features.library = roots.length > 0;
    config.features.upload = roots.length > 0 && !config.libraryReadonly;
    const lib = roots.length ? new Library(roots) : null;

    const need = (): Library => {
      if (!lib) throw httpError(503, '服务端未配置书库目录（MR_LIBRARY_DIR）');
      return lib;
    };
    const writable = (): Library => {
      const l = need();
      if (config.libraryReadonly) throw httpError(403, '书库是只读的（MR_LIBRARY_READONLY）');
      return l;
    };

    const asDir = async (l: Library, input: string | undefined, what = '目录'): Promise<FsNode> => {
      const node = await l.resolveFs(input ?? '');
      if (node.kind === 'virtual') throw httpError(400, `请指定${what}（多个书库根时不能在根列表里操作）`);
      if (!(await stat(node.real)).isDirectory()) throw httpError(400, `不是${what}`);
      return node;
    };
    const asFs = async (l: Library, p: string): Promise<FsNode> => {
      const r: Resolved = await l.resolve(p);
      if (r.kind === 'archive') throw httpError(400, '压缩包内的内容是只读的');
      if (r.kind === 'virtual') throw httpError(400, '不能操作书库根列表');
      return r;
    };
    const body = async (c: Context): Promise<LibraryOpRequest> => {
      try {
        const b = (await c.req.json()) as LibraryOpRequest;
        if (!b || typeof b !== 'object') throw new Error('x');
        return b;
      } catch {
        throw httpError(400, '请求体不是有效的 JSON');
      }
    };
    const pathsOf = (b: LibraryOpRequest): string[] => {
      const ps = b.paths ?? (b.path ? [b.path] : []);
      if (!Array.isArray(ps) || !ps.length || ps.some((p) => typeof p !== 'string')) throw httpError(400, '缺少 paths');
      return ps;
    };

    // ── 列表 ──
    app.get('/api/library/list', async (c) => {
      const l = need();
      const hidden = c.req.query('hidden') === '1';
      const input = c.req.query('path') ?? '';
      const r = await l.resolve(input);
      let entries: LibraryEntry[];
      let shown: string;
      if (r.kind === 'virtual') {
        entries = l.rootEntries();
        shown = '';
      } else if (r.kind === 'archive') {
        entries = await l.listArchiveDir(r, hidden);
        shown = l.archivePath(r, r.inner);
      } else {
        const st = await stat(r.real);
        if (st.isDirectory()) {
          entries = await l.listDir(r, hidden);
          shown = r.vpath;
        } else if ((await l.entryForNode(r)).archive) {
          // 压缩包文件本身当目录列出
          const node: ArchiveNode = { kind: 'archive', file: r, inner: '' };
          entries = await l.listArchiveDir(node, hidden);
          shown = l.archivePath(node, '');
        } else throw httpError(400, '不是目录');
      }
      const res: LibraryListResponse = { path: shown, entries };
      return c.json(res);
    });

    // ── 搜索 ──
    app.get('/api/library/search', async (c) => {
      const l = need();
      const start = await l.resolve(c.req.query('path') ?? '');
      const { entries, truncated } = await l.search(start, c.req.query('q') ?? '', c.req.query('hidden') === '1');
      const res: LibraryListResponse = { path: start.kind === 'fs' ? start.vpath : '', entries };
      return c.json(res, 200, truncated ? { 'X-Truncated': '1' } : {});
    });

    // ── 文件内容 ──
    app.get('/api/library/file', async (c) => {
      const l = need();
      const r = await l.resolve(c.req.query('path') ?? '');
      const download = c.req.query('download') === '1';
      if (r.kind === 'virtual') throw httpError(400, '缺少 path');
      if (r.kind === 'fs') {
        const st = await stat(r.real);
        if (st.isDirectory()) throw httpError(400, '是目录，不是文件');
        return serveFile(c, r.real, st, { name: r.rel.at(-1) ?? '', disposition: download ? 'attachment' : undefined });
      }
      // 压缩包内的条目：流式解出（不支持 Range，整条返回）
      require7z();
      const listing = await l.archiveListing(r);
      const entry = l.findArchiveEntry(listing, r.inner);
      if (!entry || entry.symlink) throw httpError(404, '压缩包内没有这个条目');
      if (entry.dir) throw httpError(400, '是目录，不是文件');
      if (entry.encrypted) throw httpError(422, '该条目已加密');
      const name = path.posix.basename(entry.path);
      const headers: Record<string, string> = {
        'Content-Type': mimeOf(name),
        'Content-Length': String(entry.size),
        'Content-Disposition': contentDisposition(download || ['html', 'htm', 'xhtml', 'svg', 'xml'].includes(extOf(name)) ? 'attachment' : 'inline', name),
        'Accept-Ranges': 'none',
        'Cache-Control': 'private, max-age=300',
        ...SAFE_HEADERS,
      };
      if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers });
      const proc = extractEntryStream(r.file.real, entry, listing.codepage);
      return new Response(Readable.toWeb(proc.stream) as ReadableStream, { status: 200, headers });
    });

    // ── 封面缩略图 ──
    const thumbDir = path.join(config.dataDir, 'cache', 'thumbs');
    const inflight = new Map<string, Promise<CoverImage | null>>();
    let active = 0;
    const waiters: (() => void)[] = [];
    const slot = async <T>(fn: () => Promise<T>): Promise<T> => {
      if (active >= 4) await new Promise<void>((resolve) => waiters.push(resolve));
      active++;
      try {
        return await fn();
      } finally {
        active--;
        waiters.shift()?.();
      }
    };

    const readThumbCache = async (file: string): Promise<CoverImage | null | undefined> => {
      try {
        const buf = await readFile(file);
        if (buf.length === 0) return null; // 负缓存：这本书没有封面
        const n = buf[0];
        return { mime: buf.subarray(1, 1 + n).toString('latin1'), data: buf.subarray(1 + n) };
      } catch {
        return undefined;
      }
    };
    const writeThumbCache = async (file: string, img: CoverImage | null): Promise<void> => {
      try {
        await mkdir(thumbDir, { recursive: true });
        const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
        const mime = Buffer.from(img?.mime ?? '', 'latin1');
        await writeFile(tmp, img ? Buffer.concat([Buffer.from([mime.length]), mime, img.data]) : Buffer.alloc(0));
        await rename(tmp, file);
      } catch {
        /* 缓存失败不影响响应 */
      }
    };

    app.get('/api/library/thumb', async (c) => {
      const l = need();
      const size = Math.min(1024, Math.max(32, Math.floor(Number(c.req.query('size')) || 256)));
      const r = await l.resolve(c.req.query('path') ?? '');
      if (r.kind === 'virtual') throw httpError(400, '缺少 path');
      let key: string;
      let produce: () => Promise<CoverImage | null>;
      if (r.kind === 'fs') {
        const st = await stat(r.real);
        if (!st.isFile()) throw httpError(404, '没有封面');
        key = `${r.real}\0${st.mtimeMs}\0${st.size}\0${size}`;
        produce = () => extractCover(r.real);
      } else {
        require7z();
        const listing = await l.archiveListing(r);
        const entry = l.findArchiveEntry(listing, r.inner);
        if (!entry || entry.dir || !/^(jpe?g|png|gif|webp|avif|bmp)$/.test(extOf(entry.path))) throw httpError(404, '没有封面');
        const ast = await stat(r.file.real);
        key = `${r.file.real}\0${ast.mtimeMs}\0${ast.size}\0${entry.path}\0${size}`;
        produce = async () => {
          const proc = extractEntryStream(r.file.real, entry, listing.codepage);
          const chunks: Buffer[] = [];
          let n = 0;
          for await (const ch of proc.stream) {
            n += (ch as Buffer).length;
            if (n > 32 * 1024 * 1024) {
              proc.stream.destroy();
              return null;
            }
            chunks.push(ch as Buffer);
          }
          return { data: Buffer.concat(chunks), mime: mimeOf(entry.path) };
        };
      }
      const hash = createHash('sha1').update(key).digest('hex');
      const etag = `"${hash.slice(0, 16)}"`;
      if (c.req.header('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
      const file = path.join(thumbDir, `${hash}.thumb`);
      let img = await readThumbCache(file);
      if (img === undefined) {
        let p = inflight.get(hash);
        if (!p) {
          p = slot(async () => {
            let cover: CoverImage | null = null;
            try {
              const raw = await produce();
              cover = raw ? await makeThumbnail(raw, size) : null;
            } catch (e) {
              console.warn(`[library] 取封面失败 ${l.vpath(roots[0], [])}:`, (e as Error).message);
            }
            await writeThumbCache(file, cover);
            return cover;
          }).finally(() => inflight.delete(hash));
          inflight.set(hash, p);
        }
        img = await p;
      }
      if (!img) throw httpError(404, '没有封面');
      return new Response(img.data, {
        status: 200,
        headers: { 'Content-Type': img.mime, 'Content-Length': String(img.data.length), 'Cache-Control': 'private, max-age=3600', ETag: etag, ...SAFE_HEADERS },
      });
    });

    // ── 上传 ──
    app.post('/api/library/upload', async (c) => {
      const l = writable();
      const target = await (async () => {
        const input = c.req.query('path') ?? '';
        const n = await l.resolveFs(input, false);
        if (n.kind === 'virtual') throw httpError(400, '请指定上传目录（多个书库根时第一段是根名）');
        return n;
      })();
      const ct = c.req.header('Content-Type') ?? '';
      if (!/^multipart\/form-data/i.test(ct) || !c.req.raw.body) throw httpError(400, '需要 multipart/form-data 上传');
      const overwrite = c.req.query('overwrite') === '1';
      const max = config.maxUploadBytes;
      const cl = Number(c.req.header('Content-Length'));
      if (max > 0 && Number.isFinite(cl) && cl > max + 1024 * 1024 * 64) throw httpError(413, '上传内容过大');
      // 目标目录不存在就建（传书页第一次用时 Upload/ 还没有）；realInside 已保证不越界
      await mkdir(target.real, { recursive: true });
      const dir = await realInside(target.root.real, target.abs);
      if (!(await stat(dir)).isDirectory()) throw httpError(400, '目标不是目录');

      const saved: LibraryEntry[] = [];
      const tmps: string[] = [];
      let failure: Error | null = null;
      let chain: Promise<void> = Promise.resolve(); // 落盘改名串行化，避免并发重名
      const pending: Promise<void>[] = [];
      const bb = busboy({ headers: { 'content-type': ct }, defParamCharset: 'utf8', limits: { files: MAX_UPLOAD_FILES, fileSize: max > 0 ? max : undefined } });

      bb.on('file', (_field, stream, info) => {
        const name = sanitizeFileName(path.posix.basename((info.filename ?? '').replace(/\\/g, '/')));
        if (!name || name.endsWith(TMP_SUFFIX)) {
          stream.resume();
          return;
        }
        const tmp = path.join(dir, `.upload-${randomBytes(6).toString('hex')}${TMP_SUFFIX}`);
        tmps.push(tmp);
        const work = (async () => {
          let truncated = false;
          stream.on('limit', () => (truncated = true));
          await pipeline(stream, createWriteStream(tmp));
          if (truncated) throw httpError(413, `文件 ${name} 超过上传大小上限`);
          chain = chain.then(async () => {
            const finalName = overwrite ? name : await uniqueName(dir, name);
            await realInside(target.root.real, path.join(dir, finalName));
            await rename(tmp, path.join(dir, finalName));
            const st = await stat(path.join(dir, finalName));
            saved.push(l.entryOf(target.root, [...target.rel, finalName], st));
          });
          await chain;
        })().catch((e) => {
          failure ??= e as Error;
        });
        pending.push(work);
      });
      bb.on('error', (e) => (failure ??= e as Error));
      const done = new Promise<void>((resolve) => bb.on('close', resolve));
      Readable.fromWeb(c.req.raw.body as never).pipe(bb);
      await done;
      await Promise.all(pending);
      await chain.catch(() => undefined);
      for (const t of tmps) await unlink(t).catch(() => undefined); // 成功的已经改名，剩下的是失败遗留
      if (failure) throw (failure as { status?: number }).status ? failure : httpError(400, `上传失败：${(failure as Error).message}`);
      if (!saved.length) throw httpError(400, '没有收到文件（表单字段名用 file）');
      return c.json({ saved });
    });

    // ── 新建目录 / 改名 / 拷贝 / 移动 / 删除 ──
    app.post('/api/library/mkdir', async (c) => {
      const l = writable();
      const b = await body(c);
      if (!b.path) throw httpError(400, '缺少 path');
      const node = await l.resolveFs(b.path, false);
      if (node.kind !== 'fs' || !node.rel.length) throw httpError(400, '缺少目录名');
      const name = node.rel.at(-1)!;
      if (name.endsWith(TMP_SUFFIX) || sanitizeFileName(name) !== name) throw httpError(400, '目录名不合法');
      const exists = await stat(node.real).then(() => true, () => false);
      if (exists) throw httpError(409, '已存在同名文件或目录');
      await mkdir(node.real, { recursive: true });
      return c.json({ entry: await l.entryForNode(node) });
    });

    app.post('/api/library/rename', async (c) => {
      const l = writable();
      const b = await body(c);
      if (!b.path || typeof b.newName !== 'string') throw httpError(400, '缺少 path 或 newName');
      const node = await asFs(l, b.path);
      if (!node.rel.length) throw httpError(403, '不能改名书库根目录');
      const newName = sanitizeFileName(b.newName);
      if (!newName || newName !== b.newName.trim() || newName.endsWith(TMP_SUFFIX)) throw httpError(400, '新名字不合法');
      const dest = path.join(path.dirname(node.abs), newName);
      if (dest !== node.abs && (await exists(dest))) throw httpError(409, '已存在同名文件或目录');
      await realInside(node.root.real, path.dirname(dest));
      await rename(node.abs, dest);
      const rel = [...node.rel.slice(0, -1), newName];
      return c.json({ entry: l.entryOf(node.root, rel, await stat(dest)) });
    });

    const copyOrMove = async (c: Context, move: boolean) => {
      const l = writable();
      const b = await body(c);
      const items = await Promise.all(pathsOf(b).map((p) => asFs(l, p)));
      const to = await asDir(l, b.to, '目标目录');
      // 先全部检查再动手，避免做到一半才报错
      const plan: { src: FsNode; destName: string; noop: boolean }[] = [];
      const taken = new Set<string>();
      for (const src of items) {
        if (!src.rel.length) throw httpError(403, '不能操作书库根目录');
        const name = src.rel.at(-1)!;
        const dest = path.join(to.real, name);
        if (isInside(src.real, to.real) && (await stat(src.real)).isDirectory()) throw httpError(400, `不能把目录 ${name} ${move ? '移动' : '拷贝'}到它自己里面`);
        const same = path.dirname(src.abs) === to.abs || path.dirname(src.real) === to.real;
        if (move && same) {
          plan.push({ src, destName: name, noop: true });
          continue;
        }
        let destName = name;
        if (await exists(dest)) {
          if (move) throw httpError(409, `目标目录里已有同名项：${name}`);
          destName = await uniqueName(to.real, name);
        }
        if (taken.has(destName)) destName = await uniqueName(to.real, destName);
        taken.add(destName);
        plan.push({ src, destName, noop: false });
      }
      const out: LibraryEntry[] = [];
      for (const p of plan) {
        const dest = path.join(to.real, p.destName);
        if (!p.noop) {
          if (move) await movePath(p.src.abs, dest, to.root.real);
          else await copyTree(p.src.real, dest, to.root.real);
        }
        const entryRoot = p.noop ? p.src.root : to.root;
        const entryRel = p.noop ? p.src.rel : [...to.rel, p.destName];
        out.push(l.entryOf(entryRoot, entryRel, await stat(p.noop ? p.src.real : dest)));
      }
      return c.json({ entries: out });
    };
    app.post('/api/library/copy', (c) => copyOrMove(c, false));
    app.post('/api/library/move', (c) => copyOrMove(c, true));

    app.post('/api/library/delete', async (c) => {
      const l = writable();
      const b = await body(c);
      const items = await Promise.all(pathsOf(b).map((p) => asFs(l, p)));
      for (const it of items) if (!it.rel.length) throw httpError(403, '不能删除书库根目录');
      for (const it of items) await rm(it.abs, { recursive: true, force: true });
      return c.json({ ok: true });
    });

    void find7z;
  },
};

async function exists(p: string): Promise<boolean> {
  const { lstat } = await import('node:fs/promises');
  return lstat(p).then(() => true, () => false);
}

void Transform;
