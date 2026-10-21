// POST /api/convert、/api/archive/list、/api/archive/extract
import { Readable } from 'node:stream';
import path from 'node:path';
import { rm, stat } from 'node:fs/promises';
import type { ArchiveListResponse } from '@shared/api';
import type { RouteModule } from '../index';
import { extractEntryStream, findEntry, listArchive, normalizeEntryPath, require7z } from '../lib/archive';
import { archiveToCbz, chmToEpub, djvuToPdf, planConversion, sniffExt } from '../lib/convert';
import { findCommand, find7z } from '../util/exec';
import { contentDisposition, extOf, httpError, mimeOf, sanitizeFileName } from '../util/http';
import { fileStreamResponse, makeTempDir, saveBody } from '../util/body';

const OUT_MIME = { cbz: 'application/vnd.comicbook+zip', epub: 'application/epub+zip', pdf: 'application/pdf' } as const;

export const route: RouteModule = {
  register(app, ctx) {
    const { config } = ctx;
    const has7z = !!find7z();
    config.features.convert = has7z;
    config.features['convert.djvu'] = !!findCommand('ddjvu');

    // 前端传来的 name 只用来判断格式与生成下载名：取扩展名与主文件名，其余丢掉
    const srcName = (name: string | undefined): { stem: string; ext: string } => {
      const base = sanitizeFileName(path.posix.basename((name ?? '').replace(/\\/g, '/')));
      const ext = extOf(base);
      return { stem: ext ? base.slice(0, -(ext.length + 1)) : base, ext };
    };

    app.post('/api/convert', async (c) => {
      const to = (c.req.query('to') ?? '').toLowerCase();
      const { stem, ext: nameExt } = srcName(c.req.query('name'));
      if (!to) throw httpError(400, '缺少参数 to（cbz|epub|pdf）');
      const tmp = await makeTempDir(config, 'conv-');
      let handedOver = false;
      try {
        const inFile = path.join(tmp.dir, 'in.bin');
        await saveBody(c, inFile, config.maxConvertBytes);
        let ext = nameExt;
        let plan = planConversion(ext, to);
        if (!plan) {
          // 扩展名缺失/不对时按文件头再试一次
          const sniffed = await sniffExt(inFile);
          if (sniffed) {
            ext = sniffed;
            plan = planConversion(ext, to);
          }
        }
        if (!plan) throw httpError(400, `不支持把 ${nameExt || '未知格式'} 转成 ${to}`);
        if (plan.kind === 'djvu-to-pdf' && !findCommand('ddjvu')) throw httpError(501, '服务端没有安装 djvulibre（ddjvu），无法转换 DJVU');
        if (plan.kind !== 'djvu-to-pdf') require7z();

        const out = path.join(tmp.dir, `out.${plan.to}`);
        const title = stem || 'book';
        if (plan.kind === 'archive-to-cbz') await archiveToCbz(inFile, out, tmp.dir, config.maxExtractBytes);
        else if (plan.kind === 'chm-to-epub') await chmToEpub(inFile, out, tmp.dir, title, config.maxExtractBytes);
        else await djvuToPdf(inFile, out);

        const size = (await stat(out)).size;
        handedOver = true;
        return fileStreamResponse(
          out,
          size,
          { 'Content-Type': OUT_MIME[plan.to], 'Content-Disposition': contentDisposition('attachment', `${title}.${plan.to}`) },
          () => void tmp.cleanup(),
        );
      } finally {
        if (!handedOver) await tmp.cleanup();
      }
    });

    app.post('/api/archive/list', async (c) => {
      require7z();
      const tmp = await makeTempDir(config, 'arc-');
      try {
        const file = path.join(tmp.dir, `in.${srcName(c.req.query('name')).ext || 'bin'}`);
        await saveBody(c, file, config.maxConvertBytes);
        const listing = await listArchive(file, { cache: false });
        const body: ArchiveListResponse = {
          entries: listing.entries.filter((e) => !e.symlink).map((e) => ({ path: e.path, size: e.size, dir: e.dir })),
        };
        return c.json(body);
      } finally {
        await tmp.cleanup();
      }
    });

    app.post('/api/archive/extract', async (c) => {
      require7z();
      const entryName = c.req.query('entry');
      if (!entryName) throw httpError(400, '缺少参数 entry');
      const tmp = await makeTempDir(config, 'arc-');
      let handedOver = false;
      try {
        const file = path.join(tmp.dir, `in.${srcName(c.req.query('name')).ext || 'bin'}`);
        await saveBody(c, file, config.maxConvertBytes);
        const listing = await listArchive(file, { cache: false });
        const entry = findEntry(listing, normalizeEntryPath(entryName));
        if (!entry || entry.symlink) throw httpError(404, `压缩包里没有这个条目：${entryName}`);
        if (entry.dir) throw httpError(400, '该条目是目录');
        if (entry.encrypted) throw httpError(422, '该条目已加密');
        const proc = extractEntryStream(file, entry, listing.codepage);
        const name = path.posix.basename(entry.path);
        handedOver = true;
        proc.stream.on('close', () => void rm(tmp.dir, { recursive: true, force: true }));
        return new Response(Readable.toWeb(proc.stream) as ReadableStream, {
          status: 200,
          headers: {
            'Content-Type': mimeOf(name),
            'Content-Length': String(entry.size),
            'Content-Disposition': contentDisposition('attachment', name),
          },
        });
      } finally {
        if (!handedOver) await tmp.cleanup();
      }
    });
  },
};
