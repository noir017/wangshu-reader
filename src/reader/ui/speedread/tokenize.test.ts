import { describe, expect, it } from 'vitest';
import { chunkDelay, chunkTokens, joinWords, tokenize } from './tokenize';

describe('速读分词（AUTO-004）', () => {
  it('英文按词；结尾标点粘在前一词上；开头引号粘在后一词上', () => {
    const tk = tokenize('He said, “Hello world!” Then left.', 'en');
    expect(tk.map((t) => t.text)).toEqual(['He', 'said,', '“Hello', 'world!”', 'Then', 'left.']);
  });

  it('start 是词在源文本里的偏移（带开头引号时指向引号）', () => {
    const text = 'ab “cd”';
    const tk = tokenize(text, 'en');
    expect(text.slice(tk[1].start)).toBe('“cd”');
  });

  it('中文逐词/字切分，标点并入前一词', () => {
    const tk = tokenize('山不在高，有仙则名。', 'zh');
    expect(tk.length).toBeGreaterThan(2);
    expect(tk.map((t) => t.text).join('')).toBe('山不在高，有仙则名。');
    expect(tk.some((t) => t.text.endsWith('，'))).toBe(true);
  });

  it('空文本 / 只有标点', () => {
    expect(tokenize('', 'en')).toEqual([]);
    expect(tokenize('...', 'en').length).toBeLessThanOrEqual(1);
  });
});

describe('分组与节奏', () => {
  const tokens = ['a', 'b', 'c', 'd', 'e'].map((text, i) => ({ text, start: i * 2 }));
  it('每次显示 N 个词；英文词间补空格，CJK 不补', () => {
    expect(chunkTokens(tokens, 2).map((c) => c.text)).toEqual(['a b', 'c d', 'e']);
    expect(chunkTokens(tokens, 2).map((c) => c.index)).toEqual([0, 2, 4]);
    expect(joinWords(['山不', '在高'])).toBe('山不在高');
    expect(joinWords(['hello', '世界'])).toBe('hello世界');
  });

  it('单词模式：基准 60000/WPM；长词与句末标点各加 min(基准/2, 100)ms', () => {
    const base = 60000 / 200;
    expect(chunkDelay({ text: 'cat', start: 0, index: 0, words: 1 }, 200)).toBe(base);
    expect(chunkDelay({ text: 'extraordinarily', start: 0, index: 0, words: 1 }, 200)).toBe(base + 100);
    expect(chunkDelay({ text: 'end.', start: 0, index: 0, words: 1 }, 200)).toBe(base + 100);
    expect(chunkDelay({ text: 'extraordinary!”', start: 0, index: 0, words: 1 }, 200)).toBe(base + 200);
    // 高速时额外停顿封顶为基准的一半
    expect(chunkDelay({ text: 'end.', start: 0, index: 0, words: 1 }, 2000)).toBe(30 + 15);
  });

  it('多词模式：词数 × 基准，不加停顿', () => {
    expect(chunkDelay({ text: 'a b c.', start: 0, index: 0, words: 3 }, 300)).toBe(600);
  });
});
