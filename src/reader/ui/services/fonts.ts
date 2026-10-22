// 字体：内置 serif/sans/mono、用户导入字体（IndexedDB 的 FontRecord → FontFace 注入）、服务端字体（/api/fonts）。
// fontName 取值约定（reader/settings.ts）：'serif' | 'sans-serif' | 'monospace' | 'font:<FontRecord.id>' | 'server:<file>' | 系统字体族名。
// 注入时 FontFace 的 family 就是 FontRecord.family / ServerFont.family，引擎按这个族名使用即可。
import type { FontRecord } from '@/core/library';
import { apiFetch, apiJson, checkServer } from '@/core/server';
import type { ServerFont } from '@shared/api';
import { deleteFont, listFonts, newId, putFont } from '@/storage/db';
import { toast } from '@/ui';
import { t } from '../messages';

export const GENERIC_FONTS = ['serif', 'sans-serif', 'monospace'] as const;

const loaded = new Set<string>();
/** 已经提示过加载失败的字体（每个只提示一次） */
const warned = new Set<string>();
let serverFontsCache: { at: number; list: ServerFont[] } | undefined;

/** 从文件名推族名：去扩展名与常见的 -Regular 后缀 */
export function familyFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[-_ ]?(regular|book|normal)$/i, '').trim() || 'Custom Font';
}

export async function addFontFile(file: File): Promise<FontRecord> {
  let family = familyFromFileName(file.name);
  const existing = await listFonts();
  // 同名族不同文件会互相覆盖，加序号区分
  if (existing.some((f) => f.family === family)) family = `${family} ${existing.filter((f) => f.family.startsWith(family)).length + 1}`;
  const rec: FontRecord = { id: newId(), family, fileName: file.name, blob: file, addedAt: Date.now() };
  await putFont(rec);
  await registerFontRecord(rec);
  return rec;
}

export async function removeFont(id: string): Promise<void> {
  await deleteFont(id);
  loaded.delete(`font:${id}`);
}

async function registerFace(key: string, family: string, source: Blob): Promise<boolean> {
  if (loaded.has(key)) return true;
  if (typeof FontFace === 'undefined' || !globalThis.document?.fonts) return false;
  try {
    const face = new FontFace(family, await source.arrayBuffer());
    await face.load();
    document.fonts.add(face);
    loaded.add(key);
    return true;
  } catch {
    return false;
  }
}

export function registerFontRecord(rec: FontRecord): Promise<boolean> {
  return registerFace(`font:${rec.id}`, rec.family, rec.blob);
}

export async function listServerFonts(force = false): Promise<ServerFont[]> {
  if (!(await checkServer())) return [];
  if (!force && serverFontsCache && Date.now() - serverFontsCache.at < 60_000) return serverFontsCache.list;
  try {
    const r = await apiJson<{ fonts: ServerFont[] }>('/api/fonts');
    serverFontsCache = { at: Date.now(), list: r.fonts ?? [] };
    return serverFontsCache.list;
  } catch {
    return [];
  }
}

/** 取字体文件走 apiFetch（带 Authorization），再 blob 化注入，避免直链 <link> 缺鉴权 */
async function registerServerFont(f: ServerFont): Promise<boolean> {
  if (loaded.has(`server:${f.file}`)) return true;
  try {
    const res = await apiFetch(`/api/fonts/file?file=${encodeURIComponent(f.file)}`);
    return await registerFace(`server:${f.file}`, f.family, await res.blob());
  } catch {
    return false;
  }
}

/**
 * 字体加载失败（解码不了：典型是服务端 /api/fonts 列出的 .ttc 字体集合，浏览器的 @font-face 多半不支持）：
 * 只提示一次，调用方改用默认字体。引擎侧的 font-family 本来就带 serif 兜底，所以正文自动降级，这里负责告诉用户
 */
export function warnFontFailed(key: string, family: string, fileName: string, quiet = false): string {
  if (!quiet && !warned.has(key)) {
    warned.add(key);
    toast(t('font_load_failed', { name: family, hint: /\.ttc$/i.test(fileName) ? t('font_ttc_hint') : '' }), 5000);
  }
  return 'serif';
}

/** 确保 fontName 对应的字体已注入；返回应使用的 CSS 字体族（找不到时回退 serif） */
export async function ensureFont(fontName: string, opts: { quiet?: boolean } = {}): Promise<string> {
  if (!fontName) return 'serif';
  if (fontName.startsWith('font:')) {
    const rec = (await listFonts()).find((f) => f.id === fontName.slice(5));
    if (!rec) return 'serif';
    if (!(await registerFontRecord(rec))) return warnFontFailed(fontName, rec.family, rec.fileName, opts.quiet);
    return `"${rec.family}", serif`;
  }
  if (fontName.startsWith('server:')) {
    const file = fontName.slice(7);
    const f = (await listServerFonts()).find((x) => x.file === file);
    if (!f) return 'serif';
    if (!(await registerServerFont(f))) return warnFontFailed(fontName, f.family, f.file, opts.quiet);
    return `"${f.family}", serif`;
  }
  return (GENERIC_FONTS as readonly string[]).includes(fontName) ? fontName : `"${fontName}", serif`;
}

/** 选择器里一行的显示名 */
export function fontDisplayName(fontName: string, records: FontRecord[], server: ServerFont[]): string {
  if (fontName.startsWith('font:')) return records.find((f) => f.id === fontName.slice(5))?.family ?? fontName;
  if (fontName.startsWith('server:')) return server.find((f) => f.file === fontName.slice(7))?.family ?? fontName.slice(7);
  return fontName;
}
