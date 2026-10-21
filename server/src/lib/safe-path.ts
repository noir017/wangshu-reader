// 路径安全：越界与符号链接逃逸检查、重名处理、目录树拷贝。书库与 DAV 共用。
import { constants as fsc } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { httpError } from '../util/http';

export const TMP_SUFFIX = '.mr-part';

/** p 是否在 root 之内（含 root 本身）。两者都应是绝对、已规范化的路径 */
export function isInside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * 把 abs 的「真实位置」解析出来并确认仍在 rootReal 内：abs 存在就取它的 realpath；
 * 不存在（要新建）就取最近的已存在祖先的 realpath 再接上剩余部分。
 * 返回解析后的真实路径。越界抛 403。
 */
export async function realInside(rootReal: string, abs: string): Promise<string> {
  let cur = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(cur);
      const full = path.join(real, ...tail);
      if (!isInside(rootReal, full)) throw httpError(403, '路径越界');
      return full;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        const parent = path.dirname(cur);
        if (parent === cur) throw httpError(404, '路径不存在');
        tail.unshift(path.basename(cur));
        cur = parent;
        continue;
      }
      throw e;
    }
  }
}

/** 重名时在扩展名前加 (1)、(2)…，返回不存在的文件名 */
export async function uniqueName(dir: string, name: string): Promise<string> {
  const exists = async (n: string) => lstat(path.join(dir, n)).then(() => true, () => false);
  if (!(await exists(name))) return name;
  const ext = path.extname(name);
  const stem = ext && ext !== name ? name.slice(0, -ext.length) : name;
  for (let i = 1; i < 10_000; i++) {
    const n = `${stem} (${i})${ext === name ? '' : ext}`;
    if (!(await exists(n))) return n;
  }
  throw httpError(409, '无法生成不重名的文件名');
}

/**
 * 拷贝目录树。符号链接：指向 rootReal 之内才按目标内容拷贝（解引用），否则跳过；
 * 用 visited 防环。目标已存在时报错（不覆盖）。
 */
export async function copyTree(src: string, dest: string, rootReal: string, visited = new Set<string>()): Promise<void> {
  let st = await lstat(src);
  let real = src;
  if (st.isSymbolicLink()) {
    real = await realpath(src);
    if (!isInside(rootReal, real)) return;
    st = await stat(real);
  }
  if (st.isDirectory()) {
    if (visited.has(real)) return;
    visited.add(real);
    await mkdir(dest);
    for (const name of await readdir(real)) {
      if (name.endsWith(TMP_SUFFIX)) continue;
      await copyTree(path.join(real, name), path.join(dest, name), rootReal, visited);
    }
    visited.delete(real);
  } else if (st.isFile()) {
    await copyFile(real, dest, fsc.COPYFILE_EXCL);
  }
}

/** 移动：先 rename，跨设备（EXDEV）退化为 拷贝 + 删除 */
export async function movePath(src: string, dest: string, rootReal: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    await copyTree(src, dest, rootReal);
    await rm(src, { recursive: true, force: true });
  }
}
