// 外部命令：探测是否存在、运行（带超时/输出上限）、以流的形式运行。
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants as fsc, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

const cache = new Map<string, string | null>();

/** 在 PATH 里找可执行文件（同步、带缓存；环境变量 MR_BIN_<NAME> 可直接指定路径） */
export function findCommand(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = `${env.PATH ?? ''}\0${name}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit ?? undefined;
  let found: string | null = null;
  const override = env[`MR_BIN_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  const dirs = override ? [] : (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const candidates = override ? [override] : dirs.map((d) => path.join(d, name));
  for (const c of candidates) {
    try {
      if (!statSync(c).isFile()) continue;
      accessSync(c, fsc.X_OK);
      found = c;
      break;
    } catch {
      /* 继续找 */
    }
  }
  cache.set(key, found);
  return found ?? undefined;
}

/** 7-Zip 可执行文件：优先 7z，其次 7zz、7za */
export function find7z(): string | undefined {
  return findCommand('7z') ?? findCommand('7zz') ?? findCommand('7za');
}

export interface RunOptions {
  timeoutMs?: number;
  cwd?: string;
  input?: Buffer | string;
  /** stdout 最多收集多少字节，超过则终止进程并报错 */
  maxBuffer?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  /** 非零退出码不抛错，由调用方看 code */
  allowFail?: boolean;
}

export interface RunResult {
  stdout: Buffer;
  stderr: string;
  code: number;
}

export class CommandError extends Error {
  constructor(
    message: string,
    public code: number | null,
    public stderr: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const { timeoutMs = 60_000, maxBuffer = 256 * 1024 * 1024 } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: opts.signal,
    });
    const out: Buffer[] = [];
    let outLen = 0;
    let err = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new CommandError(`${path.basename(cmd)} 超时（${timeoutMs}ms）`, null, err)));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      outLen += d.length;
      if (outLen > maxBuffer) {
        child.kill('SIGKILL');
        finish(() => reject(new CommandError(`${path.basename(cmd)} 输出超过上限`, null, err)));
        return;
      }
      out.push(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      if (err.length < 64 * 1024) err += d.toString('utf8');
    });
    child.on('error', (e) => finish(() => reject(new CommandError(`${path.basename(cmd)} 无法运行：${e.message}`, null, err))));
    child.on('close', (code) =>
      finish(() => {
        const r = { stdout: Buffer.concat(out), stderr: err, code: code ?? -1 };
        if (code !== 0 && !opts.allowFail) {
          reject(new CommandError(`${path.basename(cmd)} 退出码 ${code}：${err.trim().split('\n').slice(-3).join(' | ')}`, code, err));
        } else resolve(r);
      }),
    );
    child.stdin.on('error', () => undefined);
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export interface StreamingProcess {
  stream: Readable;
  child: ChildProcess;
  /** 进程结束后 resolve（非零退出码时 reject） */
  done: Promise<void>;
}

/** 以流的形式取 stdout（大文件解包用）。stream 被销毁时进程一并终止；非零退出码会让 stream 出错 */
export function runStream(cmd: string, args: string[], opts: { timeoutMs?: number; cwd?: string } = {}): StreamingProcess {
  const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d: Buffer) => {
    if (err.length < 64 * 1024) err += d.toString('utf8');
  });
  const stream = child.stdout;
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        child.kill('SIGKILL');
        stream.destroy(new Error(`${path.basename(cmd)} 超时`));
      }, opts.timeoutMs)
    : undefined;
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', (e) => {
      clearTimeout(timer);
      const ce = new CommandError(`${path.basename(cmd)} 无法运行：${e.message}`, null, err);
      stream.destroy(ce);
      reject(ce);
    });
    child.on('close', (code, sig) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const ce = new CommandError(`${path.basename(cmd)} 退出码 ${code ?? sig}：${err.trim().split('\n').slice(-3).join(' | ')}`, code, err);
      // stdout 已正常读完时 destroy 无害；没读完则让消费者看到错误
      if (!stream.readableEnded) stream.destroy(ce);
      reject(ce);
    });
  });
  done.catch(() => undefined);
  stream.on('close', () => {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  return { stream, child, done };
}
