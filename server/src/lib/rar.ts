// RAR 解压。Debian 的 7zip 包出于许可原因去掉了 RAR 解压代码：能列目录，但压缩过的条目解不出来
//（"Unsupported Method"），而 cbr/rar 恰恰是最常见的用途，所以 RAR 内容的读取走 node-unrar-js（官方 unrar 的 WASM 版）。
// 该库内部是进程级单例（回调挂在全局上），同一时刻只能有一个任务，这里用一把锁串行化。
import { createRequire } from 'node:module';
import os from 'node:os';
import { httpError } from '../util/http';

/** 解压用的临时目录根，index.ts 启动时设为 config.tmpDir */
export const rarTmp = { dir: os.tmpdir() };

type Unrar = typeof import('node-unrar-js');

let mod: Promise<Unrar | null> | undefined;

function loadUnrar(): Promise<Unrar | null> {
  mod ??= import('node-unrar-js').then(
    (m) => ((m as { default?: Unrar }).default ?? m) as Unrar,
    () => null,
  );
  return mod;
}

let available: boolean | undefined;

/** 依赖是否已安装（同步，供 listArchive 决定走哪条路） */
export function rarSupported(): boolean {
  if (available === undefined) {
    try {
      createRequire(import.meta.url).resolve('node-unrar-js');
      available = true;
    } catch {
      available = false;
    }
  }
  return available;
}

let chain: Promise<unknown> = Promise.resolve();

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/** 压缩包里的路径 → 解到 outDir 下的安全相对路径：去掉盘符、前导 /、'.' 与 '..' 段、NUL */
export function safeRelPath(name: string): string {
  const segs = name
    .replace(/\0/g, '')
    .replace(/\\/g, '/')
    .replace(/^[a-zA-Z]:/, '')
    .split('/')
    .filter((s) => s !== '' && s !== '.' && s !== '..');
  return segs.join('/');
}

/**
 * 把 RAR 解到 outDir。pick 给出时只解满足条件的普通文件（参数是压缩包里记录的原始路径）。
 * 符号链接不会被创建：库只通过「打开文件写入」落盘。
 */
export async function unrarExtract(file: string, outDir: string, pick?: (name: string) => boolean): Promise<void> {
  const unrar = await loadUnrar();
  if (!unrar) throw httpError(501, '服务端缺少 RAR 解压组件（node-unrar-js），请重新安装依赖');
  await exclusive(async () => {
    try {
      const ex = await unrar.createExtractorFromFile({ filepath: file, targetPath: outDir, filenameTransform: safeRelPath });
      const { files } = ex.extract({ files: pick ? (h) => !h.flags.directory && pick(h.name) : undefined });
      // 生成器惰性：必须遍历才会真正解压落盘
      for (const _f of files) void _f;
    } catch (e) {
      const reason = (e as { reason?: string }).reason;
      if (reason === 'ERAR_MISSING_PASSWORD' || reason === 'ERAR_BAD_PASSWORD') throw httpError(422, '压缩包已加密，无法解压');
      if (reason) throw httpError(422, `RAR 解压失败：${(e as Error).message}`);
      throw e;
    }
  });
}
