import { defineSettings } from '@/core/settings';

export const searchSettings = defineSettings('features.search', {
  caseSensitive: false,
  wholeWord: false,
  /** 只搜已读的（向后搜索） */
  backwardOnly: false,
  /** 只搜未读的（向前搜索） */
  forwardOnly: false,
  /** 关键词按正则解释（原版如此；关掉则按字面） */
  regex: true,
  /** 上次的关键词 */
  lastKey: '',
});
