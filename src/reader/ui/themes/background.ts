// 背景纹理：内置程序纹理清单（引擎导出，缺失时用本地回退）+ 用户上传图片（kv，id `img:<键>`）。
// 约定的清单项：{ id: 'tex:<名>', name, avgColor, css }；css 可以是 background 简写值，也可以是 `background: …; background-size: …` 声明串。
import type { CSSProperties } from 'react';
import { deleteKV, getKV, setKV } from '@/storage/db';

export interface TextureInfo {
  id: string;
  name: string;
  avgColor: string;
  css: string;
}

// apk assets/background 的 33 个文件（spec §5.3）。均色：PNG 为实测，JPEG 为目视估计，仅作回退。
const FALLBACK: [string, string][] = [
  ['day161', '#DCD8D1'],
  ['night161', '#3A3A3A'],
  ['readbg_00', '#F4F0E5'],
  ['readbg_01', '#99BABC'],
  ['readbg_02', '#DDC3A2'],
  ['readbg_03', '#8FAA7A'],
  ['readbg_04', '#DAC5C3'],
  ['readbg_05', '#232323'],
  ['readbg_06', '#DCD7D1'],
  ['readbg_11', '#E8E0CC'],
  ['readbg_12', '#E9DFC6'],
  ['readbg_13', '#EFEEEA'],
  ['readbg_14', '#E7DDC5'],
  ['readbg_15', '#E3E0D8'],
  ['readbg201', '#E6EACF'],
  ['readbg202', '#D9CBB0'],
  ['readbg203', '#E3DAC4'],
  ['readbg204', '#DCD2BB'],
  ['readbg205', '#CFD8C8'],
  ['readbg221', '#2E3238'],
  ['readbg222', '#33383F'],
  ['readbg223', '#3A3F48'],
  ['page0', '#F1E9D6'],
  ['page205', '#E0D6BE'],
  ['page222', '#2F343C'],
  ['page3', '#EAE2CF'],
  ['page301', '#065C87'],
  ['page302', '#1F4742'],
  ['page303', '#2C4559'],
  ['page305', '#EDEDED'],
  ['page306', '#FFE1E1'],
  ['pagefb', '#E9E4DA'],
];

function dark(c: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c);
  return !!m && parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16) < 300;
}

export const FALLBACK_TEXTURES: TextureInfo[] = FALLBACK.map(([id, avg]) => ({
  id: `tex:${id}`,
  name: id,
  avgColor: avg,
  // 暗角 + 均色：没有引擎纹理时的最小观感
  css: `radial-gradient(ellipse at center, transparent 55%, rgb(0 0 0 / ${dark(avg) ? 0.25 : 0.08}) 100%), ${avg}`,
}));

/** 引擎的 textures.ts 由别的工程师维护：用 import.meta.glob 软依赖，文件不存在时为空 */
const engineModules = import.meta.glob('../../engine/textures.ts', { eager: true }) as Record<string, Record<string, unknown>>;

function isTextureArray(v: unknown): v is TextureInfo[] {
  return Array.isArray(v) && v.length > 0 && typeof (v[0] as TextureInfo)?.id === 'string' && typeof (v[0] as TextureInfo)?.css === 'string';
}

let cachedList: TextureInfo[] | undefined;

/** 全部内置纹理：引擎清单优先，缺失的 id 用回退补齐（保证内置主题引用的 id 都能显示） */
export function listTextures(): TextureInfo[] {
  if (cachedList) return cachedList;
  let fromEngine: TextureInfo[] = [];
  for (const mod of Object.values(engineModules)) {
    for (const v of Object.values(mod)) {
      if (isTextureArray(v)) {
        fromEngine = v;
        break;
      }
      if (typeof v === 'function' && /texture/i.test(v.name) && v.length === 0) {
        try {
          const r = (v as () => unknown)();
          if (isTextureArray(r)) {
            fromEngine = r;
            break;
          }
        } catch {
          /* 不是清单函数 */
        }
      }
    }
  }
  const have = new Set(fromEngine.map((x) => x.id));
  cachedList = [...fromEngine, ...FALLBACK_TEXTURES.filter((x) => !have.has(x.id))];
  return cachedList;
}

export function getTexture(id: string): TextureInfo | undefined {
  return listTextures().find((x) => x.id === id);
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
const imgKey = (key: string) => `reader.bg.${key}`;

export interface UserImage {
  key: string;
  name: string;
}

export async function listUserImages(): Promise<UserImage[]> {
  return (await getKV<UserImage[]>(INDEX_KEY)) ?? [];
}

/** 保存用户图片，返回背景图 id（img:<键>） */
export async function addUserImage(file: Blob, name: string): Promise<string> {
  const key = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await setKV(imgKey(key), file);
  await setKV(INDEX_KEY, [...(await listUserImages()), { key, name }]);
  urlCache.delete(`img:${key}`);
  return `img:${key}`;
}

export async function removeUserImage(id: string): Promise<void> {
  const key = id.replace(/^img:/, '');
  await deleteKV(imgKey(key));
  await setKV(INDEX_KEY, (await listUserImages()).filter((x) => x.key !== key));
  const u = urlCache.get(id);
  if (u) URL.revokeObjectURL(u.url);
  urlCache.delete(id);
}

const urlCache = new Map<string, { url: string; small: boolean }>();

async function userImageUrl(id: string): Promise<{ url: string; small: boolean } | null> {
  const hit = urlCache.get(id);
  if (hit) return hit;
  const blob = await getKV<Blob>(imgKey(id.replace(/^img:/, '')));
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
