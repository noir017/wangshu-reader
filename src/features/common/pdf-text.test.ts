import { describe, expect, it } from 'vitest';
import { formatPdfCopyText } from './pdf-text';

describe('formatPdfCopyText（照原 app A.formatPdfCopyText）', () => {
  it('行末连字符：接回被拆开的单词', () => {
    expect(formatPdfCopyText('inter-\nnational trade')).toBe('international trade');
  });
  it('段内断行：英文补空格，中文直接接上', () => {
    expect(formatPdfCopyText('the quick brown\nfox jumps')).toBe('the quick brown fox jumps');
    expect(formatPdfCopyText('山不在高，有仙\n则名')).toBe('山不在高，有仙则名');
  });
  it('行末是标点（一句结束）保留换行；空行保留', () => {
    expect(formatPdfCopyText('First sentence.\nSecond one')).toBe('First sentence.\nSecond one');
    // 空行不特殊处理：两个换行都因行末不是标点被并成空格（与原算法一致）
    expect(formatPdfCopyText('para one\n\npara two')).toBe('para one  para two');
  });
  it('去掉 \\r；最后一个字符是换行时不动它', () => {
    expect(formatPdfCopyText('ab\r\ncd')).toBe('ab cd');
    // 原算法的边界：第一个字符后面的换行（p=0）不处理
    expect(formatPdfCopyText('a\nb')).toBe('a\nb');
    expect(formatPdfCopyText('abc\n')).toBe('abc\n');
  });
});
