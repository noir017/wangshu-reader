// 没有 UTF-8 标志的老 zip（Windows 中文版压缩软件打的包，文件名是 GBK 等本地编码）：自己读中央目录、自己解内容。
// 7z 的 -mcp 只有 Debian 打了补丁的 7zip 包认，Ubuntu 的 7zip、官网 7zz 都会把这类名字解成「����」，
// 列出来对不上、按名字取条目也会撞名，所以这类包整个绕开 7z。只支持 stored / deflate，别的交回 7z。
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { pipeline, Readable, Transform } from 'node:stream';
import zlib from 'node:zlib';

/** 条目内容在 zip 里的位置（本地头偏移、压缩方法、压缩后大小、中央目录声明的解压后大小） */
export interface ZipLocal {
  offset: number;
  method: number;
  csize: number;
  usize: number;
}

export interface ZipDirEntry {
  nameBytes: Buffer;
  utf8: boolean;
  dir: boolean;
  symlink: boolean;
  encrypted: boolean;
  size: number;
  mtime: number;
  local: ZipLocal;
}

const LABELS: Record<number, string> = { 65001: 'utf-8', 936: 'gbk', 54936: 'gb18030', 950: 'big5', 932: 'shift_jis', 949: 'euc-kr', 866: 'ibm866', 874: 'windows-874' };
const labelOf = (cp: number) => LABELS[cp] ?? (cp >= 1250 && cp <= 1258 ? `windows-${cp}` : undefined);

const dosTime = (date: number, time: number) =>
  date ? new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2).getTime() : 0;

/** 读中央目录；zip64、分卷、结构不对都返回 null（交给 7z） */
export async function readZipDirectory(file: string): Promise<ZipDirEntry[] | null> {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    const eocd = tail.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
    if (eocd < 0 || eocd + 22 > tailLen) return null;
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOff = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOff === 0xffffffff || cdOff + cdSize > size) return null;
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOff);
    const out: ZipDirEntry[] = [];
    for (let i = 0, p = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) return null;
      const flags = cd.readUInt16LE(p + 8);
      const csize = cd.readUInt32LE(p + 20);
      const usize = cd.readUInt32LE(p + 24);
      const n = cd.readUInt16LE(p + 28);
      const ext = cd.readUInt32LE(p + 38);
      const offset = cd.readUInt32LE(p + 42);
      if (csize === 0xffffffff || usize === 0xffffffff || offset === 0xffffffff) return null;
      const nameBytes = cd.subarray(p + 46, p + 46 + n);
      out.push({
        nameBytes,
        utf8: !!(flags & 0x800),
        // 只认 '/' 和 DOS 目录属性：GBK、Shift_JIS 的第二个字节可能是 0x5C（'\'）
        dir: nameBytes[n - 1] === 0x2f || !!(ext & 0x10),
        symlink: ((ext >>> 16) & 0xf000) === 0xa000,
        encrypted: !!(flags & 1),
        size: usize,
        mtime: dosTime(cd.readUInt16LE(p + 14), cd.readUInt16LE(p + 12)),
        local: { offset, method: cd.readUInt16LE(p + 10), csize, usize },
      });
      p += 46 + n + cd.readUInt16LE(p + 30) + cd.readUInt16LE(p + 32);
    }
    return out;
  } finally {
    await fh.close();
  }
}

/**
 * 解码文件名：带 UTF-8 标志的照 UTF-8；其余先试 UTF-8（不少 Linux/macOS 工具写 UTF-8 却不打标志），
 * 再按代码页（MR_ARCHIVE_CODEPAGES 的顺序）试，第一个能把所有名字都解开的胜出
 */
export function decodeZipNames(entries: ZipDirEntry[], codepages: number[]): { names: string[]; codepage: number } | null {
  const utf8 = new TextDecoder('utf-8');
  for (const cp of [65001, ...codepages]) {
    const label = labelOf(cp);
    if (!label) continue;
    try {
      const dec = new TextDecoder(label, { fatal: true });
      return { names: entries.map((e) => (e.utf8 ? utf8 : dec).decode(e.nameBytes)), codepage: cp };
    } catch {
      /* 这个代码页解不了（或 Node 没带这个编码），换下一个 */
    }
  }
  return null;
}

/** 条目内容（流）：stored 原样，deflate 用 zlib 解 */
export async function zipEntryStream(file: string, local: ZipLocal): Promise<Readable> {
  const fh = await open(file, 'r');
  let start: number;
  try {
    const h = Buffer.alloc(30);
    await fh.read(h, 0, 30, local.offset);
    if (h.readUInt32LE(0) !== 0x04034b50) throw new Error('zip 本地头损坏');
    start = local.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
  } finally {
    await fh.close();
  }
  if (!local.csize) return Readable.from([]);
  const raw = createReadStream(file, { start, end: start + local.csize - 1 });
  if (local.method === 0) return raw;
  // 解包上限（assertExtractable）按声明的大小算，这里卡住实际输出，防止伪造大小的压缩炸弹
  let seen = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      cb(seen > local.usize ? new Error('zip 条目解压后超过声明的大小') : null, chunk);
    },
  });
  return pipeline(raw, zlib.createInflateRaw(), cap, () => undefined);
}
