import { defineSettings } from '@/core/settings';
import type { AnnotFilter } from '../annotations/model';

export const tocSettings = defineSettings('features.toc', {
  /** 目录/书签/图片倒序（原 chapterReversed） */
  chapterReversed: false,
  /** 书签页筛选：0 全部 / 1 书签 / 2 标注 / 3 高亮 */
  annotFilter: 0 as AnnotFilter,
});
