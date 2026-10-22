// 「待补文件」的书（从原版 .mrpro 导入、备份里没带书籍文件，id 以 legacy- 开头）：用户选一次原文件后，
// 按文件内容正式入库（取到真实 id、封面、元数据），再把进度/标注/统计/最近阅读/用户编辑过的信息搬过去。
import type { BookRecord } from '@/core/library';
import { deleteBook, getBook, getHistory, getPosition, getStats, listAnnotations, putAnnotation, putManyRaw, savePosition, setKV, updateBook } from '@/storage/db';
import { importFile } from './import';

/** 返回新的（真实）书 id */
export async function adoptLegacyBook(legacy: BookRecord, file: File): Promise<string> {
  const { book: fresh } = await importFile({ file }, { onShelf: true });
  const id = fresh.id;
  await updateBook(id, {
    title: legacy.title,
    authors: legacy.authors,
    description: legacy.description,
    tags: legacy.tags,
    series: legacy.series,
    favorite: legacy.favorite,
    addedAt: legacy.addedAt,
    pinnedAt: legacy.pinnedAt,
    manualOrder: legacy.manualOrder,
    readState: legacy.readState,
    onShelf: true,
  });
  const pos = await getPosition(legacy.id);
  if (pos && !(await getPosition(id))) await savePosition({ ...pos, bookId: id });
  for (const a of await listAnnotations(legacy.id, { includeDeleted: true })) await putAnnotation({ ...a, bookId: id });
  const st = await getStats(legacy.id);
  if (st && !(await getStats(id))) await putManyRaw('stats', [{ ...st, bookId: id }]);
  const hist = await getHistory();
  if (hist.some((h) => h.bookId === legacy.id)) {
    const at = hist.find((h) => h.bookId === legacy.id)!.at;
    await setKV('library.history', [...hist.filter((h) => h.bookId !== legacy.id && h.bookId !== id), { bookId: id, at }].sort((a, b) => b.at - a.at));
  }
  if (await getBook(legacy.id)) await deleteBook(legacy.id, { keepAnnotations: true, keepProgress: false });
  return id;
}
