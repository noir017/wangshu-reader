// 格式解析自己的设置（通用的排版类设置读 reader/settings.ts，不在这里重复）
import { defineSettings } from '@/core/settings';

export type TxtChapterMode = 'auto' | 'keyword' | 'line' | 'regex' | 'off';

export const txtSettings = defineSettings('formats.txt', {
  /**
   * TXT 自动分章（FMT-003）：
   * auto = 关键字法 + 行特征法取条数多者（原版语义，语言按内容判断）；keyword / line = 只用其中一种；
   * regex = 用 chapterRegex 逐行匹配；off = 不分章（只按大小切段）
   */
  chapterMode: 'auto' as TxtChapterMode,
  /** 自定义分章正则（原版没有，spec FMT-003 建议）。逐行匹配；可写 /pattern/flags，也可直接写 pattern（默认不区分大小写） */
  chapterRegex: '',
  /** 青空文库注音：汉字《かな》→ <ruby>（MISC-003） */
  aozoraRuby: true,
  /** 单个 section 的字符上限（FMT-005 大文件分块）：超过就在行边界切成多个 section */
  maxSectionChars: 60000,
});

export const htmlSettings = defineSettings('formats.html', {
  /** 单文件 HTML/Markdown 的章节拆分上限（原 app maxHtmlChapterSize = 100000，FMT-006） */
  maxChapterChars: 100000,
});
