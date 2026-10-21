// 朗读字符过滤（TTS-008）：原文 → 要读的文字。规则表 + 几条硬编码替换。

export interface TtsFilter {
  from: string;
  to: string;
}

/** 原 app 出厂 4 条：— - ` '` `' ` → 空格 */
export const DEFAULT_FILTERS: TtsFilter[] = [
  { from: '—', to: ' ' },
  { from: '-', to: ' ' },
  { from: " '", to: ' ' },
  { from: "' ", to: ' ' },
];

/** 单条规则替换；useRegex 时 from 按正则（出错忽略该条），否则按字面（全部替换） */
export function applyFilter(text: string, f: TtsFilter, useRegex: boolean): string {
  if (!f.from) return text;
  try {
    return useRegex ? text.replace(new RegExp(f.from, 'g'), f.to) : text.split(f.from).join(f.to);
  } catch {
    return text;
  }
}

/**
 * 把一句原文整理成要读出来的文字：规则表依次替换 → 「」→"，’‘→空格，换行（含两侧空格）→空格 → 去首尾引号/括号/空格。
 * 返回空串表示这句没有可读内容（调用方跳过）。
 */
export function toSpeakText(raw: string, filters: TtsFilter[], useRegex: boolean): string {
  let s = raw;
  for (const f of filters) s = applyFilter(s, f, useRegex);
  s = s.replace(/[「」]/g, '"').replace(/[’‘]/g, ' ').replace(/ *[\r\n]+ */g, ' ');
  s = s.replace(/^[\s"“”'(){}[\]]+|[\s"“”'(){}[\]]+$/g, '');
  // 全是标点/空白的行不读
  if (!/[\p{L}\p{N}]/u.test(s)) return '';
  return s;
}

/** 规则表导出/导入（JSON，便于复制粘贴；也接受原 app 的 `原文#->#替换` 逐行格式） */
export function filtersToJson(list: TtsFilter[]): string {
  return JSON.stringify(list, null, 2);
}

export function parseFilters(text: string): TtsFilter[] | null {
  const t = text.trim();
  if (!t) return [];
  try {
    const v = JSON.parse(t) as unknown;
    if (Array.isArray(v)) return v.filter((x): x is TtsFilter => typeof (x as TtsFilter)?.from === 'string' && typeof (x as TtsFilter)?.to === 'string').map((x) => ({ from: x.from, to: x.to }));
  } catch {
    /* 不是 JSON，按原 app 的逐行格式试 */
  }
  const out: TtsFilter[] = [];
  for (const line of t.split(/\r?\n/)) {
    const i = line.indexOf('#->#');
    if (i > 0) out.push({ from: line.slice(0, i), to: line.slice(i + 4) });
  }
  return out.length ? out : null;
}
