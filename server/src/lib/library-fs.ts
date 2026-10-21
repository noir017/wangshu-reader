// 服务端书库：路径解析（多根、防越界/符号链接逃逸、压缩包内路径）、目录列表、搜索。
import type { LibraryEntry } from '@shared/api';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LibraryRoot } from '../config';
import { httpError } from '../util/http';
import { naturalCompare } from '../util/text';
import { listArchive, type ArchiveEntry, type ArchiveListing } from './archive';
import { isInside, realInside, TMP_SUFFIX } from './safe-path';

/** 可以「进去浏览」的压缩包扩展名（与 shared/api.ts 的 LibraryEntry.archive 一致） */
export const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'cbz', 'cbr', 'cb7']);

export const isArchiveName = (name: string) => ARCHIVE_EXTS.has(name.slice(name.lastIndexOf('.') + 1).toLowerCase()) && name.includes('.');

export interface FsNode {
  kind: 'fs';
  root: LibraryRoot;
  /** 相对根的路径段 */
  rel: string[];
  /** 词法拼出的绝对路径（改名/删除链接本身时用它） */
  abs: string;
  /** 已验证在根内的真实路径（读内容用它） */
  real: string;
  vpath: string;
}
export interface ArchiveNode {
  kind: 'archive';
  /** 压缩包文件本身 */
  file: FsNode;
  /** 包内路径（规范化，空串 = 包根） */
  inner: string;
}
export interface VirtualRoot {
  kind: 'virtual';
}
export type Resolved = FsNode | ArchiveNode | VirtualRoot;

/** 把用户给的路径拆成段：拒绝 '..'、NUL；忽略空段与 '.' */
export function splitPath(input: string): string[] {
  if (input.includes('\0')) throw httpError(400, '路径含非法字符');
  const segs: string[] = [];
  for (const s of input.replace(/\\/g, '/').split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') throw httpError(400, '路径不能包含 ..');
    segs.push(s);
  }
  return segs;
}

export class Library {
  constructor(public readonly roots: LibraryRoot[]) {}

  get multi(): boolean {
    return this.roots.length > 1;
  }

  vpath(root: LibraryRoot, rel: string[]): string {
    return (this.multi ? [root.name, ...rel] : rel).join('/');
  }

  /** 只解析文件系统路径（不识别 '?'）。mustExist=false 用于要新建的目标 */
  async resolveFs(input: string, mustExist = true): Promise<FsNode | VirtualRoot> {
    const segs = splitPath(input);
    let root: LibraryRoot;
    let rel: string[];
    if (this.multi) {
      if (!segs.length) return { kind: 'virtual' };
      const r = this.roots.find((x) => x.name === segs[0]);
      if (!r) throw httpError(404, `不存在的书库根：${segs[0]}`);
      root = r;
      rel = segs.slice(1);
    } else {
      root = this.roots[0];
      rel = segs;
    }
    const abs = path.join(root.dir, ...rel);
    let real: string;
    try {
      real = await realInside(root.real, abs);
    } catch (e) {
      if ((e as { status?: number }).status === 404) throw httpError(404, '路径不存在');
      throw e;
    }
    if (mustExist) {
      try {
        await stat(real);
      } catch {
        throw httpError(404, '路径不存在');
      }
    }
    return { kind: 'fs', root, rel, abs, real, vpath: this.vpath(root, rel) };
  }

  /** 解析对外路径：文件系统路径，或 'a.cbz?inner/path' 形式的压缩包内路径（也接受压缩包文件本身=包根） */
  async resolve(input: string): Promise<Resolved> {
    // 文件名里本身可以带 '?'：逐个 '?' 试，左侧必须是真实存在的压缩包文件
    for (let q = input.indexOf('?'); q >= 0; q = input.indexOf('?', q + 1)) {
      try {
        const left = await this.resolveFs(input.slice(0, q));
        if (left.kind === 'fs' && isArchiveName(left.rel.at(-1) ?? '') && (await stat(left.real)).isFile()) {
          return { kind: 'archive', file: left, inner: splitPath(input.slice(q + 1)).join('/') };
        }
      } catch (e) {
        if ((e as { status?: number }).status !== 404) throw e;
      }
    }
    return this.resolveFs(input);
  }

  entryOf(root: LibraryRoot, rel: string[], st: { isDirectory(): boolean; size: number; mtimeMs: number }): LibraryEntry {
    const name = rel.at(-1) ?? root.name;
    const dir = st.isDirectory();
    const e: LibraryEntry = { name, path: this.vpath(root, rel), dir, size: dir ? 0 : st.size, mtime: Math.floor(st.mtimeMs) };
    if (!dir && isArchiveName(name)) e.archive = true;
    return e;
  }

  /** 单个文件系统节点 → LibraryEntry */
  async entryForNode(node: FsNode): Promise<LibraryEntry> {
    return this.entryOf(node.root, node.rel, await stat(node.real));
  }

  rootEntries(): LibraryEntry[] {
    return this.roots.map((r) => ({ name: r.name, path: r.name, dir: true, size: 0, mtime: 0 }));
  }

  async listDir(node: FsNode, hidden: boolean): Promise<LibraryEntry[]> {
    const names = await readdir(node.real);
    const out: LibraryEntry[] = [];
    await mapLimit(names, 24, async (name) => {
      if ((!hidden && name.startsWith('.')) || name.endsWith(TMP_SUFFIX)) return;
      const e = await this.statChild(node, name);
      if (e) out.push(e);
    });
    return sortEntries(out);
  }

  /** 子项 → entry；符号链接解引用，指向根外的、坏链接、特殊文件都当不存在 */
  async statChild(node: FsNode, name: string): Promise<LibraryEntry | null> {
    const abs = path.join(node.real, name);
    try {
      let st = await lstat(abs);
      if (st.isSymbolicLink()) {
        const target = await realpath(abs);
        if (!isInside(node.root.real, target)) return null;
        st = await stat(target);
      }
      if (!st.isDirectory() && !st.isFile()) return null;
      return this.entryOf(node.root, [...node.rel, name], st);
    } catch {
      return null;
    }
  }

  /** 递归按文件名关键字搜索（所有关键字都要命中，不区分大小写） */
  async search(start: Resolved, q: string, hidden: boolean, limit = 2000): Promise<{ entries: LibraryEntry[]; truncated: boolean }> {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) throw httpError(400, '缺少搜索关键字');
    const entries: LibraryEntry[] = [];
    let truncated = false;
    const starts: FsNode[] = [];
    if (start.kind === 'virtual') {
      for (const r of this.roots) starts.push({ kind: 'fs', root: r, rel: [], abs: r.dir, real: r.real, vpath: this.vpath(r, []) });
    } else if (start.kind === 'fs') starts.push(start);
    else throw httpError(400, '不支持在压缩包内搜索');
    const deadline = Date.now() + 20_000;
    for (const s of starts) {
      const visited = new Set<string>();
      const queue: FsNode[] = [s];
      while (queue.length && !truncated) {
        const dir = queue.shift()!;
        if (visited.has(dir.real)) continue;
        visited.add(dir.real);
        let names: string[];
        try {
          names = await readdir(dir.real);
        } catch {
          continue;
        }
        names.sort(naturalCompare);
        for (const name of names) {
          if ((!hidden && name.startsWith('.')) || name.endsWith(TMP_SUFFIX)) continue;
          const e = await this.statChild(dir, name);
          if (!e) continue;
          const lower = name.toLowerCase();
          if (words.every((w) => lower.includes(w))) {
            entries.push(e);
            if (entries.length >= limit) {
              truncated = true;
              break;
            }
          }
          if (e.dir) {
            const real = await realpath(path.join(dir.real, name)).catch(() => null);
            if (real) queue.push({ kind: 'fs', root: dir.root, rel: [...dir.rel, name], abs: path.join(dir.abs, name), real, vpath: e.path });
          }
        }
        if (Date.now() > deadline) {
          truncated = true;
          break;
        }
      }
    }
    return { entries, truncated };
  }

  // ── 压缩包内 ──
  async archiveListing(node: ArchiveNode): Promise<ArchiveListing> {
    return listArchive(node.file.real);
  }

  archivePath(node: ArchiveNode, inner: string): string {
    return `${node.file.vpath}?${inner}`;
  }

  async listArchiveDir(node: ArchiveNode, hidden: boolean): Promise<LibraryEntry[]> {
    const listing = await this.archiveListing(node);
    const inner = node.inner;
    if (inner) {
      const self = listing.entries.find((e) => e.path === inner);
      if (self && !self.dir) throw httpError(400, '不是目录');
      if (!self && !listing.entries.some((e) => e.path.startsWith(`${inner}/`))) throw httpError(404, '压缩包内路径不存在');
    }
    const prefix = inner ? `${inner}/` : '';
    const map = new Map<string, LibraryEntry>();
    for (const e of listing.entries) {
      if (e.symlink || !e.path.startsWith(prefix) || e.path === inner) continue;
      const rest = e.path.slice(prefix.length);
      const slash = rest.indexOf('/');
      const name = slash < 0 ? rest : rest.slice(0, slash);
      if (!hidden && (name.startsWith('.') || name === '__MACOSX')) continue;
      const isDir = slash >= 0 || e.dir;
      const full = prefix + name;
      const existing = map.get(name);
      if (slash >= 0) {
        if (!existing) map.set(name, { name, path: this.archivePath(node, full), dir: true, size: 0, mtime: e.mtime });
      } else map.set(name, { name, path: this.archivePath(node, full), dir: isDir, size: isDir ? 0 : e.size, mtime: e.mtime });
    }
    return sortEntries([...map.values()]);
  }

  findArchiveEntry(listing: ArchiveListing, inner: string): ArchiveEntry | undefined {
    return listing.entries.find((e) => e.path === inner);
  }
}

/** 目录在前，其余按自然顺序 */
export function sortEntries(list: LibraryEntry[]): LibraryEntry[] {
  return list.sort((a, b) => Number(b.dir) - Number(a.dir) || naturalCompare(a.name, b.name));
}

export async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}
