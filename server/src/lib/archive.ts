// 7-Zip 封装：列出条目、流式取单个条目、整包解到目录。zip/rar/7z/cbz/cbr/cb7/chm 等都走它。
import { lstat, mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { CommandError, find7z, run, runStream } from '../util/exec';
import { httpError } from '../util/http';
import { rarSupported, rarTmp, unrarExtract } from './rar';

export interface ArchiveEntry {
  /** 规范化后的条目路径：用 / 分隔、无前导 ./ 或 / */
  path: string;
  /** 7z 报告的原始路径，取条目时必须用它 */
  raw: string;
  size: number;
  dir: boolean;
  /** 毫秒时间戳，未知为 0 */
  mtime: number;
  symlink: boolean;
  encrypted: boolean;
  /** RAR 条目：内容用 node-unrar-js 读（7z 的 Debian 包解不了压缩过的 RAR） */
  unrar?: boolean;
}

export interface ArchiveListing {
  entries: ArchiveEntry[];
  /** 文件名按该代码页解码（无 UTF-8 标志的老 zip，如 GBK） */
  codepage?: number;
}

export function require7z(): string {
  const bin = find7z();
  if (!bin) throw httpError(501, '服务端没有安装 7z，无法处理压缩包');
  return bin;
}

/** 7z 不带 -mcp 时把无 UTF-8 标志的 zip 文件名当 CP437，中文会变成乱码；这里按需重试的代码页 */
const FALLBACK_CODEPAGES = (process.env.MR_ARCHIVE_CODEPAGES ?? '936')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n > 0);

export function normalizeEntryPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** 解析 `7z l -slt -ba` 的输出 */
export function parseSlt(text: string): { entries: ArchiveEntry[]; utf8Flag: boolean[] } {
  const entries: ArchiveEntry[] = [];
  const utf8Flag: boolean[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const props = new Map<string, string>();
    for (const line of block.split(/\r?\n/)) {
      const i = line.indexOf(' = ');
      if (i > 0) props.set(line.slice(0, i), line.slice(i + 3));
      else if (line.endsWith(' =')) props.set(line.slice(0, -2), '');
    }
    const raw = props.get('Path');
    if (raw === undefined) continue;
    const attr = props.get('Attributes') ?? '';
    const dir = props.get('Folder') === '+' || /^D/.test(attr.trim());
    const mt = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)/.exec(props.get('Modified') ?? '');
    const p = normalizeEntryPath(raw);
    if (!p) continue;
    entries.push({
      path: p,
      raw,
      size: dir ? 0 : Number(props.get('Size') || 0),
      dir,
      // 7z 按本机时区打印时间，用本地时区还原成时间戳
      mtime: mt ? new Date(+mt[1], +mt[2] - 1, +mt[3], +mt[4], +mt[5], +mt[6]).getTime() : 0,
      // Unix 属性串形如 " lrwxrwxrwx"
      symlink: /(^|\s)l[rwx-]{9}/.test(attr),
      encrypted: props.get('Encrypted') === '+',
    });
    utf8Flag.push(/UTF8/.test(props.get('Characteristics') ?? ''));
  }
  return { entries, utf8Flag };
}

const hasMojibake = (s: string) => /[^\x00-\x7f]/.test(s);

async function list7z(file: string, codepage?: number): Promise<{ entries: ArchiveEntry[]; utf8Flag: boolean[] }> {
  const args = ['l', '-slt', '-ba', '-sccUTF-8', '-bd', '-y'];
  if (codepage) args.push(`-mcp=${codepage}`);
  args.push('--', file);
  const { stdout } = await run(require7z(), args, { timeoutMs: 120_000, maxBuffer: 512 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C.UTF-8' } });
  return parseSlt(stdout.toString('utf8'));
}

const cache = new Map<string, ArchiveListing>();

/** 列出压缩包全部条目（带小缓存：按 路径+mtime+size 命中，文件被改了自然失效） */
export async function listArchive(file: string, opts: { cache?: boolean } = {}): Promise<ArchiveListing> {
  let key: string | undefined;
  try {
    if (opts.cache === false) throw new Error('no cache');
    const st = statSync(file);
    key = `${file}\0${st.mtimeMs}\0${st.size}`;
  } catch {
    /* 临时文件之类，不缓存 */
  }
  const hit = key ? cache.get(key) : undefined;
  if (hit) {
    cache.delete(key!);
    cache.set(key!, hit);
    return hit;
  }
  let res: ArchiveListing;
  try {
    const first = await list7z(file);
    res = { entries: first.entries };
    const magic = await headMagic(file);
    if (magic === 'Rar!' && rarSupported()) for (const e of res.entries) e.unrar = true;
    // 有非 ASCII 名字且没有 UTF-8 标志 → 多半是 GBK 等老编码的 zip
    const suspicious = first.entries.some((e, i) => hasMojibake(e.path) && !first.utf8Flag[i]);
    if (suspicious && magic.startsWith('PK')) {
      for (const cp of FALLBACK_CODEPAGES) {
        try {
          const alt = await list7z(file, cp);
          if (alt.entries.length === first.entries.length && alt.entries.every((e) => !e.path.includes('�'))) {
            res = { entries: alt.entries, codepage: cp };
            break;
          }
        } catch {
          /* 换下一个 */
        }
      }
    }
  } catch (e) {
    if (e instanceof CommandError) {
      if (/Wrong password|password/i.test(e.stderr)) throw httpError(422, '压缩包已加密，无法读取');
      if (/Cannot open|Is not archive|Unsupported|Headers Error|Open ERROR/i.test(e.stderr + e.message)) throw httpError(422, '不是可识别的压缩包，或文件已损坏');
    }
    throw e;
  }
  if (key) {
    cache.set(key, res);
    if (cache.size > 24) cache.delete(cache.keys().next().value!);
  }
  return res;
}

async function headMagic(file: string): Promise<string> {
  const fh = await open(file, 'r');
  try {
    const b = Buffer.alloc(4);
    const { bytesRead } = await fh.read(b, 0, 4, 0);
    return b.toString('latin1', 0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** 在 listing 里找一个条目（规范化路径，大小写敏感） */
export function findEntry(listing: ArchiveListing, p: string): ArchiveEntry | undefined {
  const want = normalizeEntryPath(p);
  return listing.entries.find((e) => e.path === want);
}

/** RAR 条目：解到临时目录再以流返回，流关闭后清理 */
async function rarEntryFile(file: string, entry: ArchiveEntry): Promise<{ abs: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(rarTmp.dir, 'rar-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    await unrarExtract(file, dir, (n) => normalizeEntryPath(n) === entry.path);
    const [got] = await walkRegularFiles(dir, 10);
    if (!got) throw httpError(404, '压缩包里没有这个条目');
    return { abs: got.abs, cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

/**
 * 取单个条目的内容（流）。7z 用 -spd 关掉通配符，条目名里有 * [ ] 也能精确匹配；
 * 7z 方式下失败（如条目损坏）表现为流出错，RAR 方式在返回前就解完了，错误可以直接抛。
 */
export async function extractEntryStream(file: string, entry: ArchiveEntry, codepage?: number): Promise<Readable> {
  if (entry.unrar) {
    const { abs, cleanup } = await rarEntryFile(file, entry);
    const rs = createReadStream(abs);
    rs.on('close', () => void cleanup());
    return rs;
  }
  const args = ['x', '-so', '-spd', '-y', '-bd', '-sccUTF-8'];
  if (codepage) args.push(`-mcp=${codepage}`);
  args.push('--', file, entry.raw);
  return runStream(require7z(), args, { timeoutMs: 600_000 }).stream;
}

/** 取单个条目到内存（封面、container.xml 这类小文件；超过 maxBytes 报错） */
export async function extractEntryBuffer(file: string, entry: ArchiveEntry, codepage?: number, maxBytes = 64 * 1024 * 1024): Promise<Buffer> {
  if (entry.size > maxBytes) throw httpError(413, '条目过大');
  if (entry.unrar) {
    const { abs, cleanup } = await rarEntryFile(file, entry);
    try {
      const chunks: Buffer[] = [];
      for await (const ch of createReadStream(abs)) chunks.push(ch as Buffer);
      return Buffer.concat(chunks);
    } finally {
      await cleanup();
    }
  }
  const args = ['x', '-so', '-spd', '-y', '-bd', '-sccUTF-8'];
  if (codepage) args.push(`-mcp=${codepage}`);
  args.push('--', file, entry.raw);
  const { stdout } = await run(require7z(), args, { timeoutMs: 120_000, maxBuffer: maxBytes });
  return stdout;
}

/** 整包解到 outDir */
export async function extractAll(file: string, outDir: string, codepage?: number): Promise<void> {
  if (rarSupported() && (await headMagic(file)) === 'Rar!') return unrarExtract(file, outDir);
  const args = ['x', '-y', '-bd', '-sccUTF-8', `-o${outDir}`];
  if (codepage) args.push(`-mcp=${codepage}`);
  args.push('--', file);
  try {
    await run(require7z(), args, { timeoutMs: 600_000, maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    if (e instanceof CommandError && /Wrong password|Can not open encrypted|password/i.test(e.stderr)) throw httpError(422, '压缩包已加密，无法解压');
    throw e;
  }
}

export interface ExtractedFile {
  /** 相对 outDir，/ 分隔 */
  rel: string;
  abs: string;
  size: number;
  mtime: number;
}

/** 列出解出来的普通文件；符号链接一律忽略（压缩包里可以夹带指向宿主任意文件的链接） */
export async function walkRegularFiles(dir: string, limit = 200_000): Promise<ExtractedFile[]> {
  const out: ExtractedFile[] = [];
  const walk = async (cur: string, rel: string): Promise<void> => {
    for (const d of await readdir(cur, { withFileTypes: true })) {
      if (out.length >= limit) throw httpError(413, '压缩包内文件数过多');
      const abs = path.join(cur, d.name);
      const r = rel ? `${rel}/${d.name}` : d.name;
      const st = await lstat(abs);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) await walk(abs, r);
      else if (st.isFile()) out.push({ rel: r, abs, size: st.size, mtime: st.mtimeMs });
    }
  };
  await walk(dir, '');
  return out;
}

/** 解包前检查总大小，防压缩炸弹 */
export function assertExtractable(listing: ArchiveListing, maxBytes: number): void {
  let total = 0;
  for (const e of listing.entries) total += e.size;
  if (maxBytes > 0 && total > maxBytes) throw httpError(413, `压缩包解开后过大（${Math.round(total / 1048576)} MB，上限 ${Math.round(maxBytes / 1048576)} MB）`);
}
