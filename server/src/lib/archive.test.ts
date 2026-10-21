// @vitest-environment node
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { writeZip } from '../test-fixtures';
import { tmp } from '../test-utils';
import { CommandError, find7z, findCommand, run } from '../util/exec';
import { assertExtractable, listArchive, normalizeEntryPath, parseSlt } from './archive';
import { safeRelPath } from './rar';

describe('7z -slt 输出解析', () => {
  const sample = `Path = a/b.txt
Folder = -
Size = 12
Modified = 2026-10-21 10:05:44
Attributes = A
Encrypted = -
Characteristics = NTFS UTF8

Path = a
Folder = +
Size = 0
Modified = 2026-10-21 10:05:44
Attributes = D

Path = link
Folder = -
Size = 3
Attributes =  lrwxrwxrwx
Encrypted = +

Path = .\\win\\path.txt
Size = 1
`;
  it('目录、符号链接、加密、UTF-8 标志、路径规范化', () => {
    const { entries, utf8Flag } = parseSlt(sample);
    expect(entries.map((e) => [e.path, e.dir, e.symlink, e.encrypted, e.size])).toEqual([
      ['a/b.txt', false, false, false, 12],
      ['a', true, false, false, 0],
      ['link', false, true, true, 3],
      ['win/path.txt', false, false, false, 1],
    ]);
    expect(entries[3].raw).toBe('.\\win\\path.txt'); // 取条目时要用 7z 报告的原始路径
    expect(utf8Flag).toEqual([true, false, false, false]);
    expect(entries[0].mtime).toBe(new Date(2026, 9, 21, 10, 5, 44).getTime());
  });

  it('normalizeEntryPath：反斜杠、前导 ./ 与 /、尾部 /', () => {
    expect(normalizeEntryPath('.\\a\\b/')).toBe('a/b');
    expect(normalizeEntryPath('/x/y')).toBe('x/y');
    expect(normalizeEntryPath('./././z')).toBe('z');
  });

  it('assertExtractable：解压后总大小超限报 413（防压缩炸弹）', () => {
    const l = { entries: [{ size: 600 }, { size: 600 }] } as never;
    expect(() => assertExtractable(l, 1000)).toThrow(/过大/);
    expect(() => assertExtractable(l, 0)).not.toThrow();
    expect(() => assertExtractable(l, 2000)).not.toThrow();
  });
});

describe('RAR 解压的路径净化', () => {
  it('safeRelPath：去掉盘符、前导斜杠、. 与 .. 段、NUL', () => {
    expect(safeRelPath('a/b/c.txt')).toBe('a/b/c.txt');
    expect(safeRelPath('..\\..\\etc\\passwd')).toBe('etc/passwd');
    expect(safeRelPath('/abs/../x')).toBe('abs/x');
    expect(safeRelPath('C:\\Windows\\a.txt')).toBe('Windows/a.txt');
    expect(safeRelPath('a/./b//c')).toBe('a/b/c');
    expect(safeRelPath('a\0b')).toBe('ab');
  });
});

describe('外部命令探测', () => {
  it('MR_BIN_<NAME> 指定路径优先；不存在/不可执行视为没有；PATH 查找', () => {
    const dir = tmp();
    const bin = path.join(dir, 'mytool');
    writeFileSync(bin, '#!/bin/sh\necho hi\n');
    expect(findCommand('mytool', { PATH: dir })).toBeUndefined(); // 没有执行权限
    chmodSync(bin, 0o755);
    expect(findCommand('mytool', { PATH: `/nonexistent:${dir}` })).toBe(bin);
    expect(findCommand('mytool', { PATH: '/nonexistent', MR_BIN_MYTOOL: bin })).toBe(bin);
    expect(findCommand('mytool', { PATH: dir, MR_BIN_MYTOOL: '/nonexistent/x' })).toBeUndefined();
  });

  it('run：退出码非零抛 CommandError，allowFail 时返回；超时杀进程', async () => {
    await expect(run('/bin/sh', ['-c', 'echo oops >&2; exit 3'])).rejects.toMatchObject({ code: 3, stderr: expect.stringContaining('oops') });
    expect((await run('/bin/sh', ['-c', 'echo out; exit 3'], { allowFail: true })).code).toBe(3);
    await expect(run('/bin/sh', ['-c', 'sleep 5'], { timeoutMs: 100 })).rejects.toBeInstanceOf(CommandError);
    expect((await run('/bin/cat', [], { input: 'abc' })).stdout.toString()).toBe('abc');
  });
});

describe.skipIf(!find7z())('zip 写入器 + 列表', () => {
  it('ZipWriter 写出的 zip：7z 与 fflate 都能读，STORE/DEFLATE、中文名、空文件', async () => {
    const f = path.join(tmp(), 't.zip');
    await writeZip(f, [
      { name: 'mimetype', data: 'application/epub+zip', compress: false },
      { name: '中文/文件.txt', data: '压缩'.repeat(500), compress: true },
      { name: 'empty.txt', data: '' },
      { name: 'bin.dat', data: Buffer.alloc(1000, 9) },
    ]);
    const z = unzipSync(new Uint8Array(readFileSync(f)));
    expect(strFromU8(z.mimetype)).toBe('application/epub+zip');
    expect(strFromU8(z['中文/文件.txt'])).toBe('压缩'.repeat(500));
    expect(z['empty.txt'].length).toBe(0);
    expect(Object.keys(z)[0]).toBe('mimetype');
    const listing = await listArchive(f);
    expect(listing.entries.map((e) => e.path)).toEqual(['mimetype', '中文/文件.txt', 'empty.txt', 'bin.dat']);
    expect(listing.entries.find((e) => e.path === 'bin.dat')?.size).toBe(1000);
    expect(listing.codepage).toBeUndefined(); // UTF-8 标志齐全，不需要换代码页
  });
});
