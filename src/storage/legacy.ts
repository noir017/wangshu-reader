// 导入原版 Moon+ Reader 的单文件数据（BAK-003、SYNC-002/003）：.po 阅读进度、.an / .mrexpt 标注。
// 原版整库备份 .mrpro 需要 SQLite（sql.js/WASM），这一版不做。
import type { BookRecord } from '@/core/library';
import { strFromU8 } from 'fflate';
import { findBooksByFileName } from './db';
import { decodeAnText, decodePo, decompressAn, parsePositionString } from './moon-formats';
import { importPoText, mergeRemoteAnnotations, type AnnotationMergeResult } from './sync';

export type LegacyFile =
  | { kind: 'po'; text: string; hints: string[] }
  | { kind: 'an'; text: string; hints: string[]; fileSize: number; count: number };

const baseName = (p: string) => p.replace(/^.*[\\/]/, '');

/** 认出文件类型并给出「这是哪本书」的线索（文件名、标注里记录的书名）。认不出返回 null */
export function readLegacyFile(name: string, bytes: Uint8Array): LegacyFile | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.po')) {
    const text = strFromU8(bytes);
    const po = decodePo(text);
    if (!po || !parsePositionString(po.position)) return null;
    return { kind: 'po', text, hints: [baseName(name).slice(0, -3)] };
  }
  const text = decompressAn(bytes);
  const parsed = decodeAnText(text);
  if (!parsed) return null;
  const hints: string[] = [];
  const stem = baseName(name).replace(/\.(an|mrexpt|txt)$/i, '');
  if (stem) hints.push(stem);
  const first = parsed.notes[0];
  if (first) {
    if (first.book) hints.push(baseName(first.book));
    if (first.filename) hints.push(baseName(first.filename));
  }
  return { kind: 'an', text, hints: [...new Set(hints)], fileSize: parsed.fileSize, count: parsed.notes.length };
}

/** 按文件名线索在书库里找书（不区分大小写）；标注文件带书的字节数时优先挑大小相近的 */
export async function findLegacyBook(hints: string[], fileSize?: number): Promise<BookRecord | undefined> {
  for (const h of hints) {
    const hits = await findBooksByFileName(h);
    if (!hits.length) continue;
    if (fileSize) return hits.find((b) => Math.abs(b.size - fileSize) <= 100000) ?? hits[0];
    return hits[0];
  }
  return undefined;
}

export type LegacyApplyResult = { kind: 'po'; ok: boolean } | ({ kind: 'an' } & AnnotationMergeResult);

export async function applyLegacyFile(file: LegacyFile, book: BookRecord): Promise<LegacyApplyResult> {
  if (file.kind === 'po') return { kind: 'po', ok: await importPoText(book.id, file.text) };
  return { kind: 'an', ...(await mergeRemoteAnnotations(book, file.text)) };
}
