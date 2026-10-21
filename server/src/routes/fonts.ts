// GET /api/fonts → 服务端字体列表；GET /api/fonts/file?file= → 字体文件。
// file 是「根编号/相对路径」（u0 = MR_FONTS_DIR 第 1 个，s0 = 第 1 个系统字体目录…），不接受任意路径。
import type { ServerFont } from '@shared/api';
import { stat } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RouteModule } from '../index';
import { fcList, FONT_EXTS, nameFromFile, readFontNames, scanFontFiles, type FontInfo } from '../lib/fonts';
import { realInside } from '../lib/safe-path';
import { serveFile } from '../lib/serve-file';
import { mapLimit } from '../lib/library-fs';
import { httpError } from '../util/http';
import { naturalCompare } from '../util/text';

const SYSTEM_FONT_DIRS = ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local/share/fonts'), '/Library/Fonts', '/System/Library/Fonts'];

interface FontRoot {
  key: string;
  dir: string;
  real: string;
}

export const route: RouteModule = {
  register(app, ctx) {
    const { config } = ctx;
    const roots: FontRoot[] = [];
    config.fontsDirs.forEach((d, i) => roots.push({ key: `u${i}`, dir: d, real: safeReal(d) }));
    if (config.systemFonts) SYSTEM_FONT_DIRS.filter((d) => existsSync(d)).forEach((d, i) => roots.push({ key: `s${i}`, dir: d, real: safeReal(d) }));
    config.features.fonts = roots.length > 0;

    let cache: { at: number; fonts: ServerFont[] } | undefined;

    const build = async (): Promise<ServerFont[]> => {
      const fc = await fcList();
      const fonts: ServerFont[] = [];
      for (const root of roots) {
        const files = await scanFontFiles(root.dir);
        await mapLimit(files, 8, async (f) => {
          let info: FontInfo | undefined = fc?.get(f.abs) ?? fc?.get(realSafe(f.abs));
          if (!info && fc) {
            // fc-list 只列它认识的字体目录：用户目录里的字体它不一定认识，回退到自己解析
            info = undefined;
          }
          info ??= (await readFontNames(f.abs)) ?? nameFromFile(f.abs);
          fonts.push({ family: info.family, file: `${root.key}/${f.rel}`, ...(info.style ? { style: info.style } : {}), ...(info.weight ? { weight: info.weight } : {}) });
        });
      }
      return fonts.sort((a, b) => naturalCompare(a.family, b.family) || naturalCompare(a.file, b.file));
    };

    app.get('/api/fonts', async (c) => {
      if (!roots.length) return c.json({ fonts: [] satisfies ServerFont[] });
      if (!cache || c.req.query('refresh') === '1' || Date.now() - cache.at > 60_000) cache = { at: Date.now(), fonts: await build() };
      return c.json({ fonts: cache.fonts });
    });

    app.get('/api/fonts/file', async (c) => {
      const id = c.req.query('file') ?? '';
      const slash = id.indexOf('/');
      const root = roots.find((r) => r.key === id.slice(0, slash));
      if (!root || slash < 0) throw httpError(404, '没有这个字体');
      const rel = id.slice(slash + 1);
      if (rel.split('/').some((s) => s === '..' || s === '') || rel.includes('\0')) throw httpError(400, '非法路径');
      const ext = path.extname(rel).slice(1).toLowerCase();
      if (!FONT_EXTS.has(ext)) throw httpError(404, '没有这个字体');
      const abs = path.join(root.dir, ...rel.split('/'));
      let real: string;
      try {
        real = await realInside(root.real, abs);
      } catch (e) {
        if ((e as { status?: number }).status === 404) throw httpError(404, '没有这个字体');
        throw e;
      }
      const st = await stat(real).catch(() => null);
      if (!st?.isFile()) throw httpError(404, '没有这个字体');
      return serveFile(c, real, st, { name: path.basename(rel), disposition: null, cacheControl: 'public, max-age=86400' });
    });
  },
};

function safeReal(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
const realSafe = safeReal;
