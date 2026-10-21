// 名字替换规则的纯逻辑（MISC-002）。规则表本身是引擎的 nameSettings（reader.names），引擎负责应用；
// 这里只管编辑界面用到的校验、作用域和导入导出。
import type { NameRule } from '@/reader/engine/transforms';

export type { NameRule };

/** 规则作用域：全局，或只对某本书（按书名，与引擎的过滤条件一致） */
export type RuleScope = 'global' | 'book';

export const scopeOf = (r: NameRule): RuleScope => (r.book ? 'book' : 'global');

export function withScope(r: NameRule, scope: RuleScope, bookTitle: string): NameRule {
  const { book: _drop, ...rest } = r;
  return scope === 'book' && bookTitle ? { ...rest, book: bookTitle } : rest;
}

/** 返回错误原因；null = 可用。空原文会让替换变成无限插入，直接拒绝 */
export function validateRule(r: NameRule): 'empty' | 'regex' | null {
  if (!r.from) return 'empty';
  if (r.regex) {
    try {
      new RegExp(r.from, 'g');
    } catch {
      return 'regex';
    }
  }
  return null;
}

/** 对这本书生效的规则（启用 + 全局或本书），顺序保持：用于编辑页顶部的计数 */
export function activeRulesFor(rules: NameRule[], bookTitle: string): NameRule[] {
  return rules.filter((r) => r.enabled !== false && !validateRule(r) && (!r.book || r.book === bookTitle));
}

/** 逐行「原文#->#替换」（与朗读过滤表同一格式，方便从原 app 搬过来）→ 规则；不认识的行忽略 */
export function parseRuleLines(text: string, bookTitle?: string): NameRule[] {
  const out: NameRule[] = [];
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('#->#');
    if (i > 0) out.push({ from: line.slice(0, i), to: line.slice(i + 4), ...(bookTitle ? { book: bookTitle } : {}) });
  }
  return out;
}

export function ruleLines(rules: NameRule[]): string {
  return rules.map((r) => `${r.from}#->#${r.to}`).join('\n');
}
