// 固定版式（PDF）里选中的文字常常带着排版换行：照原 app 的 A.formatPdfCopyText 整理（ANNO-003）。
//  - 行末是连字符：去掉「-\n」，把被拆开的单词接回去；
//  - 行末不是标点、且上一个字符不是换行：段内断行，CJK 文字直接接上，其他语言补一个空格；
//  - 行末是标点（句子结束）或前面是空行：保留换行。

/** 原文里第 i 个字符（含代理对）的 Unicode 类别判断用：只关心 Po（其他标点）与 Lo（其他字母，含汉字假名） */
const isPunctuation = (ch: string) => /^\p{Po}$/u.test(ch);
const isOtherLetter = (ch: string) => /^\p{Lo}$/u.test(ch);

export function formatPdfCopyText(input: string): string {
  let s = input.replace(/\r/g, '');
  let i = 1;
  for (;;) {
    const nl = s.indexOf('\n', i);
    if (nl === -1 || nl === s.length - 1) break;
    const p = nl - 1;
    const prev = s[p];
    if (prev === '-') {
      s = s.slice(0, p) + s.slice(nl + 1);
    } else if (!isPunctuation(prev) && p > 0 && s[p - 1] !== '\n') {
      s = s.slice(0, nl) + (isOtherLetter(prev) ? '' : ' ') + s.slice(nl + 1);
    }
    i = nl + 1;
  }
  return s;
}
