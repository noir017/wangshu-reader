import { describe, expect, it } from 'vitest';
import { activeRulesFor, parseRuleLines, ruleLines, scopeOf, validateRule, withScope } from './rules';

describe('名字替换规则', () => {
  it('校验：空原文、坏正则不可用', () => {
    expect(validateRule({ from: '', to: 'x' })).toBe('empty');
    expect(validateRule({ from: '(', to: 'x', regex: true })).toBe('regex');
    expect(validateRule({ from: '(', to: 'x' })).toBeNull();
    expect(validateRule({ from: 'a+', to: 'x', regex: true })).toBeNull();
  });

  it('作用域切换只动 book 字段', () => {
    const r = { from: '甲', to: '乙', regex: true };
    const b = withScope(r, 'book', '三体');
    expect(b).toEqual({ from: '甲', to: '乙', regex: true, book: '三体' });
    expect(scopeOf(b)).toBe('book');
    expect(withScope(b, 'global', '三体')).toEqual(r);
    // 没有书名时不能设成本书
    expect(withScope(r, 'book', '')).toEqual(r);
  });

  it('对本书生效的规则：启用 + 合法 + 全局或本书', () => {
    const rules = [
      { from: 'a', to: 'b' },
      { from: 'c', to: 'd', enabled: false },
      { from: 'e', to: 'f', book: '甲书' },
      { from: 'g', to: 'h', book: '乙书' },
      { from: '(', to: 'x', regex: true },
    ];
    expect(activeRulesFor(rules, '甲书').map((r) => r.from)).toEqual(['a', 'e']);
  });

  it('逐行格式往返', () => {
    const rules = [
      { from: '老王', to: '小李' },
      { from: 'x', to: '' },
    ];
    expect(ruleLines(rules)).toBe('老王#->#小李\nx#->#');
    expect(parseRuleLines('老王#->#小李\n乱七八糟\nx#->#', '书')).toEqual([
      { from: '老王', to: '小李', book: '书' },
      { from: 'x', to: '', book: '书' },
    ]);
  });
});
