// 设置对话框用到的选项清单与取值范围。
import { textSettings } from '@/reader/settings';

const tablet = Math.min(globalThis.screen?.width ?? 400, globalThis.screen?.height ?? 800) >= 600;

export const MIN_FONT_SIZE = tablet ? 12 : 10;
export const MAX_FONT_SIZE = 100;
export const MAX_MARGIN = tablet ? 300 : 200;

export function clampFontSize(v: number): number {
  return Math.round(Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, v)) * 10) / 10;
}

/** 文字编码：value 为 TextDecoder 支持的标签，auto 为自动检测 */
export const ENCODINGS: { value: string; label: string }[] = [
  { value: 'auto', label: 'AUTO' },
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-16le', label: 'UTF-16LE' },
  { value: 'utf-16be', label: 'UTF-16BE' },
  { value: 'gbk', label: 'GBK' },
  { value: 'gb18030', label: 'GB18030' },
  { value: 'big5', label: 'BIG5' },
  { value: 'shift_jis', label: 'SHIFT-JIS' },
  { value: 'euc-jp', label: 'EUC-JP' },
  { value: 'iso-2022-jp', label: 'ISO-2022-JP' },
  { value: 'euc-kr', label: 'EUC-KR' },
  { value: 'koi8-r', label: 'KOI8-R' },
  { value: 'koi8-u', label: 'KOI8-U' },
  { value: 'ibm866', label: 'CP866' },
  { value: 'macintosh', label: 'Macintosh' },
  ...Array.from({ length: 16 }, (_, i) => i + 1)
    .filter((n) => n !== 11 && n !== 12)
    .map((n) => ({ value: `iso-8859-${n}`, label: `ISO-8859-${n}` })),
  ...Array.from({ length: 9 }, (_, i) => 1250 + i).map((n) => ({ value: `windows-${n}`, label: `Windows-${n}` })),
  { value: 'windows-874', label: 'CP874' },
  { value: 'us-ascii', label: 'US-ASCII' },
];

/** apk 内带断字词典的 22 种语言 */
export const HYPHEN_LANGS = ['en', 'bg', 'cs', 'da', 'de', 'el', 'eo', 'es', 'fi', 'fr', 'hu', 'id', 'it', 'lt', 'nb', 'nl', 'pl', 'pt', 'ru', 'sv', 'tr', 'uk'];

export function langName(code: string, ui: 'zh' | 'en'): string {
  try {
    return new Intl.DisplayNames([ui === 'zh' ? 'zh-CN' : 'en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** 段距：存值 0..20，UI 显示 ×10% */
export const paraToPct = (v: number): number => v * 10;
export const pctToPara = (v: number): number => Math.round(v / 10);

/** 重置到默认（取 slice 的默认值，不硬编码） */
export function resetTextKeys(keys: (keyof typeof textSettings.defaults)[]): void {
  const d = textSettings.defaults;
  const patch: Record<string, unknown> = {};
  for (const k of keys) patch[k] = d[k];
  textSettings.set(patch);
}
