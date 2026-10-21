// 字体解析：textSettings.fontName → font-family 值 + 需要注入章节 iframe 的 @font-face。
// font:<FontRecord.id> 来自用户导入（IndexedDB）；server:<file> 来自服务端字体目录（拉成 blob，避免 @font-face 带不了鉴权头）。
import { listFonts } from '@/storage/db';
import { apiFetch, hasServer } from '@/core/server';

export interface ResolvedFont {
  /** 用户/服务端字体的族名；系统字体为 undefined */
  family?: string;
  /** 需要注入的 @font-face */
  css: string;
}

const cache = new Map<string, Promise<ResolvedFont>>();

function faceCss(family: string, url: string): string {
  return `@font-face{font-family:"${family}";src:url("${url}");font-display:swap}`;
}

async function resolve(name: string): Promise<ResolvedFont> {
  try {
    if (name.startsWith('font:')) {
      const id = name.slice(5);
      const rec = (await listFonts()).find((f) => f.id === id);
      if (!rec) return { css: '' };
      const family = `mrf-${id}`;
      return { family, css: faceCss(family, URL.createObjectURL(rec.blob)) };
    }
    if (name.startsWith('server:') && hasServer()) {
      const file = name.slice(7);
      const res = await apiFetch(`/api/fonts/file?file=${encodeURIComponent(file)}`);
      const blob = await res.blob();
      const family = `mrs-${file.replace(/[^\w]/g, '_')}`;
      return { family, css: faceCss(family, URL.createObjectURL(blob)) };
    }
  } catch {
    /* 字体取不到：退回默认字体 */
  }
  return { css: '' };
}

export function resolveFont(name: string): Promise<ResolvedFont> {
  if (!name.startsWith('font:') && !name.startsWith('server:')) return Promise.resolve({ css: '' });
  let p = cache.get(name);
  if (!p) cache.set(name, (p = resolve(name)));
  return p;
}
