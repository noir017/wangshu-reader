// 字体名解析：优先 fc-list，没有就读字体文件的 name 表，再不行用文件名。
import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { findCommand, run } from '../util/exec';

export const FONT_EXTS = new Set(['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2']);

export interface FontInfo {
  family: string;
  style?: string;
  weight?: string;
}

/** fontconfig 权重 → CSS font-weight */
export function fcWeightToCss(w: number): string {
  const table: [number, number][] = [
    [0, 100], [40, 200], [50, 300], [80, 400], [100, 500], [180, 600], [200, 700], [205, 800], [210, 900],
  ];
  let best = table[0];
  for (const t of table) if (Math.abs(t[0] - w) < Math.abs(best[0] - w)) best = t;
  return String(best[1]);
}

/** fc-list 一次取出所有字体：file → 第一个（index 0）面的信息 */
export async function fcList(): Promise<Map<string, FontInfo> | null> {
  const bin = findCommand('fc-list');
  if (!bin) return null;
  try {
    const { stdout } = await run(bin, ['-f', '%{file}\t%{family}\t%{style}\t%{weight}\t%{index}\n'], { timeoutMs: 30_000, maxBuffer: 64 * 1024 * 1024 });
    const map = new Map<string, FontInfo>();
    for (const line of stdout.toString('utf8').split('\n')) {
      const [file, family, style, weight, index] = line.split('\t');
      if (!file || !family) continue;
      // TTC 里除第一个面外，浏览器 @font-face 用不到，只收 index 0
      if (index !== undefined && index !== '0' && index !== '') continue;
      if (map.has(file)) continue;
      const w = Number(weight);
      map.set(file, {
        family: family.split(',')[0].trim(),
        style: style?.split(',')[0].trim() || undefined,
        weight: Number.isFinite(w) ? fcWeightToCss(w) : undefined,
      });
    }
    return map;
  } catch {
    return null;
  }
}

async function readAt(fh: Awaited<ReturnType<typeof open>>, pos: number, len: number): Promise<Buffer> {
  const b = Buffer.alloc(len);
  const { bytesRead } = await fh.read(b, 0, len, pos);
  return b.subarray(0, bytesRead);
}

interface TableDir {
  tag: string;
  offset: number;
  length: number;
  compLength?: number;
}

function decodeName(buf: Buffer, platform: number): string {
  if (platform === 3 || platform === 0) {
    // UTF-16BE → 交换字节后按 LE 解码
    const sw = Buffer.from(buf);
    sw.swap16();
    return sw.toString('utf16le');
  }
  return buf.toString('latin1');
}

/** 解析 name 表，返回 { family, style }；优先 Typographic Family(16)/Subfamily(17) */
export function parseNameTable(t: Buffer): { family?: string; style?: string } {
  if (t.length < 6) return {};
  const count = t.readUInt16BE(2);
  const strOff = t.readUInt16BE(4);
  const names = new Map<number, { text: string; score: number }>();
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12;
    if (o + 12 > t.length) break;
    const platform = t.readUInt16BE(o);
    const lang = t.readUInt16BE(o + 4);
    const id = t.readUInt16BE(o + 6);
    const len = t.readUInt16BE(o + 8);
    const off = t.readUInt16BE(o + 10);
    if (![1, 2, 16, 17].includes(id)) continue;
    const raw = t.subarray(strOff + off, strOff + off + len);
    if (raw.length !== len) continue;
    // 评分：Windows 英文最好，其次 Windows 其它语言，其次 Mac
    const score = platform === 3 && lang === 0x409 ? 3 : platform === 3 ? 2 : platform === 1 ? 1 : 0;
    const text = decodeName(raw, platform).replace(/\0/g, '').trim();
    if (!text) continue;
    const prev = names.get(id);
    if (!prev || score > prev.score) names.set(id, { text, score });
  }
  return { family: names.get(16)?.text ?? names.get(1)?.text, style: names.get(17)?.text ?? names.get(2)?.text };
}

/** 读 sfnt（ttf/otf/ttc 取首个面）或 woff1 的 name/OS2 表；woff2 无法廉价解析，返回 null */
export async function readFontNames(file: string): Promise<FontInfo | null> {
  const fh = await open(file, 'r');
  try {
    const head = await readAt(fh, 0, 12);
    if (head.length < 12) return null;
    const magic = head.toString('latin1', 0, 4);
    let base = 0;
    let numTables: number;
    let woff = false;
    if (magic === 'ttcf') {
      base = (await readAt(fh, 12, 4)).readUInt32BE(0);
      const h2 = await readAt(fh, base, 12);
      numTables = h2.readUInt16BE(4);
    } else if (magic === 'wOFF') {
      woff = true;
      numTables = (await readAt(fh, 12, 2)).readUInt16BE(0);
    } else if (magic === '\0\x01\0\0' || magic === 'OTTO' || magic === 'true') {
      numTables = head.readUInt16BE(4);
    } else return null;
    const dirStart = woff ? 44 : base + 12;
    const entry = woff ? 20 : 16;
    const dir = await readAt(fh, dirStart, numTables * entry);
    const tables = new Map<string, TableDir>();
    for (let i = 0; i < numTables && (i + 1) * entry <= dir.length; i++) {
      const o = i * entry;
      const tag = dir.toString('latin1', o, o + 4);
      if (woff) tables.set(tag, { tag, offset: dir.readUInt32BE(o + 4), compLength: dir.readUInt32BE(o + 8), length: dir.readUInt32BE(o + 12) });
      else tables.set(tag, { tag, offset: dir.readUInt32BE(o + 8), length: dir.readUInt32BE(o + 12) });
    }
    const load = async (tag: string, max: number): Promise<Buffer | null> => {
      const t = tables.get(tag);
      if (!t) return null;
      if (woff) {
        const raw = await readAt(fh, t.offset, Math.min(t.compLength!, max));
        return t.compLength! < t.length ? inflateSync(raw) : raw;
      }
      return readAt(fh, t.offset, Math.min(t.length, max));
    };
    const nameTbl = await load('name', 512 * 1024);
    if (!nameTbl) return null;
    const { family, style } = parseNameTable(nameTbl);
    if (!family) return null;
    const os2 = await load('OS/2', 8);
    const weight = os2 && os2.length >= 6 ? String(os2.readUInt16BE(4)) : undefined;
    return { family, style, weight };
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}

/** 最后的兜底：从文件名猜，如 NotoSansCJK-Regular.ttc → family "NotoSansCJK"，style "Regular" */
export function nameFromFile(file: string): FontInfo {
  const stem = path.basename(file, path.extname(file));
  const i = stem.lastIndexOf('-');
  if (i > 0) return { family: stem.slice(0, i).replace(/[_]+/g, ' '), style: stem.slice(i + 1) };
  return { family: stem.replace(/[_]+/g, ' ') };
}

export interface FontFile {
  /** 相对其根目录，/ 分隔 */
  rel: string;
  abs: string;
}

/** 递归找字体文件（限制深度，用 realpath 防符号链接环） */
export async function scanFontFiles(root: string, maxDepth = 8, maxFiles = 20_000): Promise<FontFile[]> {
  const out: FontFile[] = [];
  const seen = new Set<string>();
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (depth > maxDepth || out.length >= maxFiles) return;
    let real: string;
    try {
      real = await realpath(dir);
    } catch {
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);
    let names: import('node:fs').Dirent[];
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of names) {
      if (d.name.startsWith('.')) continue;
      const abs = path.join(dir, d.name);
      const r = rel ? `${rel}/${d.name}` : d.name;
      let isDir = d.isDirectory();
      let isFile = d.isFile();
      if (d.isSymbolicLink()) {
        const st = await stat(abs).catch(() => null);
        isDir = !!st?.isDirectory();
        isFile = !!st?.isFile();
      }
      if (isDir) await walk(abs, r, depth + 1);
      else if (isFile && FONT_EXTS.has(path.extname(d.name).slice(1).toLowerCase())) out.push({ rel: r, abs });
    }
  };
  await walk(root, '', 0);
  return out;
}
