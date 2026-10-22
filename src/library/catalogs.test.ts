import { describe, expect, it } from 'vitest';
import { dbEvents, getKV, setKV } from '@/storage/db';
import { catalogSummary, catalogTitle, deleteCatalog, listCatalogs } from './catalogs';

describe('网络书库站点（NET-001/005）', () => {
  it('删除内置站点后不再恢复：删除与重新读取并发时也一样（墓碑先写）', async () => {
    expect((await listCatalogs()).map((c) => c.id)).toContain('feedbooks');
    // 和界面（useCatalogs）一样：kv 一变就重新 listCatalogs。之前先删列表后写墓碑，这次重读会把 Feedbooks 合并回去
    const reads: Promise<unknown>[] = [];
    const off = dbEvents.on('change', (e) => e.store === 'kv' && e.key === 'library.catalogs' && reads.push(listCatalogs()));
    await deleteCatalog('feedbooks');
    await Promise.all(reads);
    off();
    expect((await getKV<{ id: string }[]>('library.catalogs'))?.map((c) => c.id)).not.toContain('feedbooks');
    expect((await listCatalogs()).map((c) => c.id)).not.toContain('feedbooks');
  });

  it('旧数据里残留的已删除内置站点被清掉', async () => {
    const list = (await getKV<{ id: string }[]>('library.catalogs')) ?? [];
    await setKV('library.catalogs', [...list, { id: 'moonreader', title: 'Moon+ Catalogs', main: 'x', builtin: true, version: 5, addedAt: 0 }]);
    await setKV('library.catalogs.deleted', ['feedbooks', 'moonreader']);
    const ids = (await listCatalogs()).map((c) => c.id);
    expect(ids).not.toContain('moonreader');
    expect(ids).toContain('gutenberg');
  });

  it('内置站点：文字没被用户改过时按界面语言显示，品牌名不翻', () => {
    expect(catalogTitle({ id: 'moonreader', title: 'Moon+ Catalogs' })).toBe('Moon+ 书库目录');
    expect(catalogTitle({ id: 'moonreader', title: '我自己起的名' })).toBe('我自己起的名');
    expect(catalogTitle({ id: 'gutenberg', title: 'Project Gutenberg' })).toBe('Project Gutenberg');
    expect(catalogSummary({ id: 'gutenberg', summary: 'The first producer of free ebooks (since 1971).' })).toBe('最早的免费电子书提供者（始于 1971 年）');
    expect(catalogSummary({ id: 'c-1234', summary: 'My OPDS' })).toBe('My OPDS');
  });
});
