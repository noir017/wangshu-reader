// 书签名生成（spec 03 §4.9，原 generateBookmarkName）。

export interface BookmarkNameInput {
  /** 章节纯文本 */
  sectionText: string;
  /** 书签位置（当前页首）的章内偏移 */
  offset: number;
  /** 全书进度 0..1 */
  progress: number;
  /** 中文取 60 字符，其他取 100 */
  chinese: boolean;
  /** 全文太短（<3 字符）时用的时间文本 */
  fallback: string;
}

export function formatBookmarkPercent(p: number): string {
  return `${(Math.max(0, Math.min(1, p)) * 100).toFixed(1)}%`;
}

export function generateBookmarkName(i: BookmarkNameInput): string {
  const n = i.chinese ? 60 : 100;
  let s = i.sectionText.slice(Math.max(0, i.offset), Math.max(0, i.offset) + n);
  if (s.length >= n) {
    // 尽量别把单词截在半截：最后一个空格离末尾不足 8 个字符才按它截断
    const sp = s.lastIndexOf(' ');
    if (sp !== -1 && s.length - sp < 8) s = s.slice(0, sp);
  }
  if (s.trim().length < 3 && i.sectionText.slice(Math.max(0, i.offset)).trim().length < 3) s = i.fallback;
  const body = s.replace(/\n/g, ' ').replace(/　/g, ' ').trim();
  return `(${formatBookmarkPercent(i.progress)}) ${body}...`;
}
