// 最小 WebDAV 服务：/dav/*。数据在 <dataDir>/dav。
// 方法：OPTIONS、PROPFIND(Depth 0/1)、PROPPATCH(只回执)、GET/HEAD(Range)、PUT、DELETE、MKCOL、MOVE、COPY、LOCK/UNLOCK(假锁，Finder/Windows 挂载要求)。
// 设计取舍：父目录不存在时 PUT/MKCOL/MOVE/COPY 返回 409（与 RFC 4918 及主流服务端一致），客户端要自己逐级 MKCOL。
import type { Context } from 'hono';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, realpathSync } from 'node:fs';
import { lstat, mkdir, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { RouteModule } from '../index';
import { copyTree, isInside, movePath, realInside, TMP_SUFFIX } from '../lib/safe-path';
import { etagOf, serveFile } from '../lib/serve-file';
import { httpError, mimeOf } from '../util/http';
import { escapeHtml, escapeXml, naturalCompare } from '../util/text';

const DAV_METHODS = ['OPTIONS', 'PROPFIND', 'PROPPATCH', 'GET', 'HEAD', 'PUT', 'DELETE', 'MKCOL', 'MOVE', 'COPY', 'LOCK', 'UNLOCK'];

const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>\n';

function xmlResponse(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/xml; charset=utf-8', ...extra } });
}

const empty = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers: { 'Content-Length': '0', ...headers } });

export const route: RouteModule = {
  register(app, ctx) {
    const { config } = ctx;
    config.features.dav = config.davEnabled;
    if (!config.davEnabled) {
      app.all('/dav/*', (c) => c.json({ error: 'WebDAV 已关闭（MR_DAV=0）' }, 404));
      return;
    }
    const davDir = path.join(config.dataDir, 'dav');
    mkdirSync(davDir, { recursive: true });
    const rootReal = realpathSync(davDir);

    /** 请求路径 → 数据目录里的绝对路径。返回 prefix 以便生成 href（支持反向代理加前缀） */
    const locate = (c: Context) => {
      const prefix = (c.req.header('X-Forwarded-Prefix') ?? '').replace(/\/+$/, '');
      const raw = new URL(c.req.url).pathname;
      return { prefix, ...mapPath(raw) };
    };

    const mapPath = (urlPath: string): { segs: string[]; abs: string; hrefBase: string } => {
      const rest = urlPath.replace(/^\/dav(?=\/|$)/, '');
      const segs: string[] = [];
      for (const part of rest.split('/')) {
        if (!part || part === '.') continue;
        let s: string;
        try {
          s = decodeURIComponent(part);
        } catch {
          throw httpError(400, '路径编码错误');
        }
        if (s === '..' || s.includes('\0') || s.includes('/') || s.includes('\\')) throw httpError(400, '非法路径');
        if (s.endsWith(TMP_SUFFIX)) throw httpError(404, '不存在');
        segs.push(s);
      }
      return { segs, abs: path.join(davDir, ...segs), hrefBase: '/dav' + (segs.length ? '/' + segs.map(encodeURIComponent).join('/') : '') };
    };

    const statSafe = async (abs: string) => {
      try {
        const real = await realInside(rootReal, abs);
        return { st: await stat(real), real };
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR' || (e as { status?: number }).status === 404) return null;
        throw e;
      }
    };

    const parentDir = async (abs: string): Promise<boolean> => {
      const p = await statSafe(path.dirname(abs));
      return !!p && p.st.isDirectory();
    };

    // ── OPTIONS ──
    const options = () =>
      new Response(null, {
        status: 200,
        headers: {
          DAV: '1, 2',
          Allow: DAV_METHODS.join(', '),
          'MS-Author-Via': 'DAV',
          'Content-Length': '0',
        },
      });

    // ── PROPFIND ──
    const entryXml = (href: string, name: string, st: { isDirectory(): boolean; size: number; mtimeMs: number; mtime: Date; birthtime: Date }): string => {
      const dir = st.isDirectory();
      const created = Number.isFinite(st.birthtime.getTime()) && st.birthtime.getTime() > 0 ? st.birthtime : st.mtime;
      return (
        `<D:response><D:href>${escapeXml(href)}</D:href><D:propstat><D:prop>` +
        `<D:displayname>${escapeXml(name)}</D:displayname>` +
        (dir
          ? '<D:resourcetype><D:collection/></D:resourcetype>'
          : `<D:resourcetype/><D:getcontentlength>${st.size}</D:getcontentlength><D:getcontenttype>${escapeXml(mimeOf(name))}</D:getcontenttype><D:getetag>${etagOf(st)}</D:getetag>`) +
        `<D:getlastmodified>${st.mtime.toUTCString()}</D:getlastmodified><D:creationdate>${created.toISOString()}</D:creationdate>` +
        '<D:supportedlock><D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock>' +
        '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
      );
    };

    const propfind = async (c: Context) => {
      const { prefix, segs, abs, hrefBase } = locate(c);
      const found = await statSafe(abs);
      if (!found) return xmlResponse(404, `${XML_HEAD}<D:error xmlns:D="DAV:"><D:resource-not-found/></D:error>`);
      const depth = c.req.header('Depth') ?? 'infinity'; // infinity 按 1 处理：不递归整棵树
      const dir = found.st.isDirectory();
      const base = prefix + hrefBase + (dir ? '/' : '');
      const parts = [entryXml(base, segs.at(-1) ?? '', found.st)];
      if (dir && depth !== '0') {
        const names = (await readdir(found.real)).filter((n) => !n.endsWith(TMP_SUFFIX)).sort(naturalCompare);
        for (const n of names) {
          const child = await statSafe(path.join(abs, n));
          if (!child) continue; // 悬空或逃逸的符号链接
          parts.push(entryXml(base + encodeURIComponent(n) + (child.st.isDirectory() ? '/' : ''), n, child.st));
        }
      }
      return xmlResponse(207, `${XML_HEAD}<D:multistatus xmlns:D="DAV:">${parts.join('')}</D:multistatus>`);
    };

    const proppatch = async (c: Context) => {
      const { prefix, hrefBase, abs } = locate(c);
      const found = await statSafe(abs);
      if (!found) return xmlResponse(404, `${XML_HEAD}<D:error xmlns:D="DAV:"><D:resource-not-found/></D:error>`);
      const body = await c.req.text();
      // 不持久化任何属性：把请求里出现的属性原样回执为成功，客户端（Windows/davfs2/rclone）就不会报错
      const nsDecl = [...(/<[^>]*propertyupdate[^>]*>/i.exec(body)?.[0].matchAll(/xmlns(?::[\w.-]+)?="[^"]*"/g) ?? [])].map((m) => m[0]).filter((d) => d !== 'xmlns:D="DAV:"');
      const props: string[] = [];
      for (const block of body.matchAll(/<(?:[\w.-]+:)?prop\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?prop>/gi)) {
        for (const el of block[1].matchAll(/<((?:[\w.-]+:)?[\w.-]+)([^>]*?)\/?>/g)) {
          if (el[0].startsWith('</')) continue;
          props.push(`<${el[1]}${el[2].replace(/\/$/, '')}/>`);
        }
      }
      const href = prefix + hrefBase + (found.st.isDirectory() ? '/' : '');
      return xmlResponse(
        207,
        `${XML_HEAD}<D:multistatus xmlns:D="DAV:" ${nsDecl.join(' ')}><D:response><D:href>${escapeXml(href)}</D:href><D:propstat><D:prop>${props.join('')}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`,
      );
    };

    // ── GET / HEAD ──
    const get = async (c: Context) => {
      const head = c.req.method === 'HEAD';
      const { segs, abs, prefix, hrefBase } = locate(c);
      const found = await statSafe(abs);
      if (!found) throw httpError(404, '不存在');
      const { st, real } = found;
      if (st.isDirectory()) {
        const names = (await readdir(real)).filter((n) => !n.endsWith(TMP_SUFFIX)).sort(naturalCompare);
        const base = prefix + hrefBase + '/';
        const items = names.map((n) => `<li><a href="${escapeHtml(base + encodeURIComponent(n))}">${escapeHtml(n)}</a></li>`).join('');
        const html = `<!doctype html><meta charset="utf-8"><title>/${escapeHtml(segs.join('/'))}</title><h1>/${escapeHtml(segs.join('/'))}</h1><ul>${items}</ul>`;
        return new Response(head ? null : html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      return serveFile(c, real, st, { name: segs.at(-1) ?? '', disposition: null });
    };

    // ── PUT ──
    const put = async (c: Context) => {
      const { segs, abs } = locate(c);
      if (!segs.length) throw httpError(405, '不能 PUT 到根目录');
      if (!(await parentDir(abs))) throw httpError(409, '父目录不存在');
      const existing = await statSafe(abs);
      if (existing?.st.isDirectory()) throw httpError(405, '目标是目录');
      const inm = c.req.header('If-None-Match');
      const im = c.req.header('If-Match');
      if (inm === '*' && existing) return empty(412);
      if (im && im !== '*' && (!existing || !im.split(',').some((t) => t.trim() === etagOf(existing.st)))) return empty(412);
      if (im === '*' && !existing) return empty(412);
      const dir = path.dirname(abs);
      const tmp = path.join(dir, `.upload-${randomBytes(6).toString('hex')}${TMP_SUFFIX}`);
      const max = config.maxUploadBytes;
      const cl = Number(c.req.header('Content-Length'));
      if (max > 0 && Number.isFinite(cl) && cl > max) throw httpError(413, '文件过大');
      try {
        const body = c.req.raw.body;
        if (!body) await writeFile(tmp, '');
        else {
          let n = 0;
          const limit = new Transform({
            transform(chunk: Buffer, _e, cb) {
              n += chunk.length;
              if (max > 0 && n > max) cb(httpError(413, '文件过大'));
              else cb(null, chunk);
            },
          });
          await pipeline(Readable.fromWeb(body as never), limit, createWriteStream(tmp));
        }
        // rename 前再确认目标仍是普通位置（上传期间目录可能被换成了符号链接）
        await realInside(rootReal, abs);
        await rename(tmp, abs);
      } catch (e) {
        await unlink(tmp).catch(() => undefined);
        throw e;
      }
      return empty(existing ? 204 : 201);
    };

    // ── DELETE / MKCOL ──
    const del = async (c: Context) => {
      const { segs, abs } = locate(c);
      if (!segs.length) throw httpError(403, '不能删除根目录');
      const found = await statSafe(abs);
      if (!found) {
        // 悬空符号链接也允许删
        const l = await lstat(abs).catch(() => null);
        if (!l) throw httpError(404, '不存在');
      }
      await rm(abs, { recursive: true, force: true });
      return empty(204);
    };

    const mkcol = async (c: Context) => {
      const { segs, abs } = locate(c);
      if (!segs.length) throw httpError(405, '根目录已存在');
      const cl = Number(c.req.header('Content-Length') ?? 0);
      if (cl > 0 || c.req.header('Transfer-Encoding')) throw httpError(415, 'MKCOL 不接受请求体');
      if (await statSafe(abs)) throw httpError(405, '已存在');
      if (!(await parentDir(abs))) throw httpError(409, '父目录不存在');
      await realInside(rootReal, path.dirname(abs));
      await mkdir(abs);
      return empty(201);
    };

    // ── COPY / MOVE ──
    const copyMove = async (c: Context, move: boolean) => {
      const { segs, abs, prefix } = locate(c);
      const destHeader = c.req.header('Destination');
      if (!destHeader) throw httpError(400, '缺少 Destination');
      let destPath: string;
      try {
        destPath = new URL(destHeader, c.req.url).pathname;
      } catch {
        throw httpError(400, 'Destination 无法解析');
      }
      if (prefix && destPath.startsWith(prefix)) destPath = destPath.slice(prefix.length);
      if (!/^\/dav(\/|$)/.test(destPath)) throw httpError(502, 'Destination 不在本服务器上');
      const dest = mapPath(destPath);
      if (!segs.length || !dest.segs.length) throw httpError(403, '不能操作根目录');
      const src = await statSafe(abs);
      if (!src) throw httpError(404, '源不存在');
      if (abs === dest.abs) throw httpError(403, '源和目标相同');
      if (isInside(abs, dest.abs)) throw httpError(403, '不能把目录复制/移动到它自己里面');
      if (!(await parentDir(dest.abs))) throw httpError(409, '目标父目录不存在');
      const overwrite = (c.req.header('Overwrite') ?? 'T').toUpperCase() !== 'F';
      const existed = await lstat(dest.abs).then(() => true, () => false);
      if (existed && !overwrite) return empty(412);
      await realInside(rootReal, path.dirname(dest.abs));
      if (existed) await rm(dest.abs, { recursive: true, force: true });
      if (move) await movePath(abs, dest.abs, rootReal);
      else if (src.st.isDirectory() && c.req.header('Depth') === '0') await mkdir(dest.abs);
      else await copyTree(src.real, dest.abs, rootReal);
      return empty(existed ? 204 : 201);
    };

    // ── LOCK / UNLOCK（不真正加锁，只让要求锁的客户端满意） ──
    const lock = async (c: Context) => {
      const { prefix, segs, abs, hrefBase } = locate(c);
      let created = false;
      if (!(await statSafe(abs))) {
        if (!segs.length || !(await parentDir(abs))) throw httpError(409, '父目录不存在');
        await realInside(rootReal, path.dirname(abs));
        await writeFile(abs, '');
        created = true;
      }
      const token = `opaquelocktoken:${randomUUID()}`;
      const timeout = /Second-\d+|Infinite/i.exec(c.req.header('Timeout') ?? '')?.[0] ?? 'Second-3600';
      const body =
        `${XML_HEAD}<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope>` +
        `<D:depth>infinity</D:depth><D:timeout>${timeout}</D:timeout><D:locktoken><D:href>${token}</D:href></D:locktoken>` +
        `<D:lockroot><D:href>${escapeXml(prefix + hrefBase)}</D:href></D:lockroot></D:activelock></D:lockdiscovery></D:prop>`;
      return xmlResponse(created ? 201 : 200, body, { 'Lock-Token': `<${token}>` });
    };

    // 路由：/dav 与 /dav/* 一起处理，按方法分发（自定义方法 Hono 用 app.on 支持）
    const handler = async (c: Context) => {
      switch (c.req.method) {
        case 'OPTIONS':
          return options();
        case 'PROPFIND':
          return propfind(c);
        case 'PROPPATCH':
          return proppatch(c);
        case 'GET':
        case 'HEAD':
          return get(c);
        case 'PUT':
          return put(c);
        case 'DELETE':
          return del(c);
        case 'MKCOL':
          return mkcol(c);
        case 'COPY':
          return copyMove(c, false);
        case 'MOVE':
          return copyMove(c, true);
        case 'LOCK':
          return lock(c);
        case 'UNLOCK':
          return empty(204);
        default:
          return new Response(null, { status: 405, headers: { Allow: DAV_METHODS.join(', ') } });
      }
    };
    app.on(DAV_METHODS, ['/dav', '/dav/*'], handler);
  },
};
