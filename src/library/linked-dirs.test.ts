import { describe, expect, it } from 'vitest';
import { isAutoImportCandidate, walkDir, type DirHandle, type FileEntry } from './linked-dirs';

const filter = { types: ['epub', 'txt'], minSizeKB: 20 };
const f = (name: string, size = 30_000, lastModified = 1000) => ({ name, size, lastModified });

describe('自动导入候选', () => {
  it('只要修改时间晚于上次扫描、类型与大小合格', () => {
    expect(isAutoImportCandidate(f('a.epub'), 500, filter)).toBe(true);
    expect(isAutoImportCandidate(f('a.epub', 30_000, 400), 500, filter)).toBe(false);
    expect(isAutoImportCandidate(f('a.epub', 30_000, 500), 500, filter)).toBe(false);
    expect(isAutoImportCandidate(f('a.epub', 100), 500, filter)).toBe(false); // 小于 20KB
    expect(isAutoImportCandidate(f('a.pdf'), 500, filter)).toBe(false); // 类型没勾
    expect(isAutoImportCandidate(f('cover.png'), 500, filter)).toBe(false);
  });
  it('跳过 err*.txt（原 app 的崩溃日志）', () => {
    expect(isAutoImportCandidate(f('err20261021.txt'), 0, filter)).toBe(false);
    expect(isAutoImportCandidate(f('error-story.txt'), 0, filter)).toBe(false);
    expect(isAutoImportCandidate(f('story.txt'), 0, filter)).toBe(true);
  });
});

describe('递归遍历目录', () => {
  const file = (name: string): FileEntry => ({ kind: 'file', name, getFile: async () => new File(['x'], name) });
  const dir = (name: string, ...kids: (DirHandle | FileEntry)[]): DirHandle => ({
    kind: 'directory',
    name,
    async *values() {
      yield* kids;
    },
  });
  it('带上子目录路径，跳过隐藏目录', async () => {
    const root = dir('Books', file('a.epub'), dir('Sci-Fi', file('b.epub'), dir('Deep', file('c.txt'))), dir('.Trash', file('gone.epub')));
    const seen: string[] = [];
    for await (const x of walkDir(root)) seen.push(`${x.dir}|${x.file.name}`);
    expect(seen).toEqual(['|a.epub', 'Sci-Fi|b.epub', 'Sci-Fi/Deep|c.txt']);
  });
});
