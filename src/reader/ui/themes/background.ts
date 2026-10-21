// 背景纹理：内置程序纹理清单（引擎 textures.ts 导出）+ 用户上传图片（存 kv，id `img:<kv 键>`）。
// 引擎自己也按同一约定解析背景（resolveBackground：`tex:<名>` 查清单，`img:<键>` 直接 getKV(<键>)），
// 所以用户图片的 id 里必须带完整的 kv 键，两边才能读到同一份数据。
import type { CSSProperties } from 'react';
import { TEXTURES, textureById } from '@/reader/engine/textures';
import { deleteKV, getKV, setKV } from '@/storage/db';

export interface TextureInfo {
  id: string;
  name: string;
  avgColor: string;
  css: string;
}

/** 全部内置纹理（引擎清单，33 张 apk 背景图的程序化版本） */
export function listTextures(): TextureInfo[] {
  return TEXTURES;
}

export function getTexture(id: string): TextureInfo | undefined {
  return textureById(id);
}

/** 按分号拆声明，括号和引号里的分号（data: URI 的 ;base64）不拆 */
function splitDeclarations(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of css) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** css 串 → React 样式（兼容「简写值」与「声明串」两种写法） */
export function cssToStyle(css: string): CSSProperties {
  if (!/^\s*[-a-z]+\s*:/i.test(css)) return { background: css };
  const style: Record<string, string> = {};
  for (const decl of splitDeclarations(css)) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const val = decl.slice(i + 1).trim();
    if (prop && val) style[prop] = val;
  }
  return style as CSSProperties;
}

// ───────────── 用户上传图片 ─────────────
const INDEX_KEY = 'reader.bg.index';
const KV_PREFIX = 'reader.bg.';

export interface UserImage {
  /** 短键（只在索引里用） */
  key: string;
  name: string;
}

/** 背景图 id：img:<完整 kv 键>，引擎按这个键直接取图 */
export const userImageId = (key: string): string => `img:${KV_PREFIX}${key}`;
const kvKeyOf = (id: string): string => id.replace(/^img:/, '');

export async function listUserImages(): Promise<UserImage[]> {
  return (await getKV<UserImage[]>(INDEX_KEY)) ?? [];
}

/** 保存用户图片，返回背景图 id */
export async function addUserImage(file: Blob, name: string): Promise<string> {
  const key = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const id = userImageId(key);
  await setKV(kvKeyOf(id), file);
  await setKV(INDEX_KEY, [...(await listUserImages()), { key, name }]);
  urlCache.delete(id);
  return id;
}

export async function removeUserImage(id: string): Promise<void> {
  const kv = kvKeyOf(id);
  await deleteKV(kv);
  await setKV(INDEX_KEY, (await listUserImages()).filter((x) => userImageId(x.key) !== id));
  const u = urlCache.get(id);
  if (u) URL.revokeObjectURL(u.url);
  urlCache.delete(id);
}

const urlCache = new Map<string, { url: string; small: boolean }>();

async function userImageUrl(id: string): Promise<{ url: string; small: boolean } | null> {
  const hit = urlCache.get(id);
  if (hit) return hit;
  const blob = await getKV<Blob>(kvKeyOf(id));
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  // 宽高都小于 100px 的小图平铺，否则拉伸铺满（THEME-006）
  const small = await new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth < 100 && img.naturalHeight < 100);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  const v = { url, small };
  urlCache.set(id, v);
  return v;
}

export interface BackgroundSource {
  useBackgroundImage: boolean;
  backgroundImage: string;
  backgroundColor: string;
}

/** 背景 → 样式。图片找不到时退回纯色 */
export async function resolveBackground(s: BackgroundSource): Promise<CSSProperties> {
  const base: CSSProperties = { backgroundColor: s.backgroundColor };
  if (!s.useBackgroundImage || !s.backgroundImage) return base;
  if (s.backgroundImage.startsWith('img:')) {
    const u = await userImageUrl(s.backgroundImage);
    if (!u) return base;
    return u.small
      ? { ...base, backgroundImage: `url("${u.url}")`, backgroundRepeat: 'repeat' }
      : { ...base, backgroundImage: `url("${u.url}")`, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat' };
  }
  const tex = getTexture(s.backgroundImage);
  if (!tex) return base;
  return { ...base, ...cssToStyle(tex.css) };
}

/** 同步版本（只处理内置纹理，用于主题网格预览等） */
export function textureStyleSync(id: string, fallbackColor: string): CSSProperties {
  const tex = getTexture(id);
  return tex ? { backgroundColor: tex.avgColor, ...cssToStyle(tex.css) } : { backgroundColor: fallbackColor };
}
