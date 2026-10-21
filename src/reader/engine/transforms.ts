// 显示性文本变换（MISC-001 简繁、MISC-002 名字替换、TYPO-009 去空行）。
// 铁律：Locator/TextRange 的偏移基于「原文」。简繁转换只接受等长结果；名字替换若改变长度，就在 TextIndex 里登记分段映射。
import { defineSettings } from '@/core/settings';
import type { ChapterFrame } from './frame';
import type { ReplaceSeg } from './text-index';

/** MISC-002 名字替换规则 */
export interface NameRule {
  from: string;
  to: string;
  regex?: boolean;
  /** 只对某本书生效（填书名；缺省 = 全局） */
  book?: string;
  enabled?: boolean;
}

/** 名字替换的全局规则表。reader/ui 负责编辑界面；引擎还提供 setNameRules 给「仅本书」规则。 */
export const nameSettings = defineSettings('reader.names', {
  rules: [] as NameRule[],
});

export interface TransformOptions {
  jian2fan: boolean;
  fan2jian: boolean;
  trimBlank: boolean;
  rules: NameRule[];
}

type Conv = (s: string) => string;
let s2t: Promise<Conv> | undefined;
let t2s: Promise<Conv> | undefined;

async function loadConverter(dir: 'j2f' | 'f2j'): Promise<Conv> {
  const OpenCC = await import('opencc-js');
  return dir === 'j2f' ? OpenCC.Converter({ from: 'cn', to: 't' }) : OpenCC.Converter({ from: 't', to: 'cn' });
}

export function getConverter(dir: 'j2f' | 'f2j'): Promise<Conv> {
  if (dir === 'j2f') return (s2t ??= loadConverter('j2f'));
  return (t2s ??= loadConverter('f2j'));
}

/** 转换后长度必须不变；词组替换若变长，退回逐字映射，仍不等长的字保持原样 */
export function convertKeepLength(conv: Conv, text: string): string {
  if (!text) return text;
  const out = conv(text);
  if (out.length === text.length) return out;
  let r = '';
  for (const ch of text) {
    const c = conv(ch);
    r += c.length === ch.length ? c : ch;
  }
  return r;
}

interface Match {
  s: number;
  e: number;
  to: string;
}

/** 对一段文本应用名字规则：从左到右取最早的匹配（同位置取靠前的规则），不重叠 */
export function replaceNames(text: string, rules: NameRule[]): { text: string; segs: ReplaceSeg[] } | null {
  const compiled: Array<{ re: RegExp; to: string }> = [];
  for (const r of rules) {
    if (r.enabled === false || !r.from) continue;
    try {
      const src = r.regex ? r.from : r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      compiled.push({ re: new RegExp(src, 'g'), to: r.to });
    } catch {
      /* 规则里的正则写错：忽略这一条 */
    }
  }
  if (!compiled.length) return null;
  const matches: Match[] = [];
  for (const { re, to } of compiled) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      matches.push({ s: m.index, e: m.index + m[0].length, to: m[0].replace(new RegExp(re.source, 'g'), to) });
    }
  }
  if (!matches.length) return null;
  matches.sort((a, b) => a.s - b.s || b.e - a.e);
  let out = '';
  let pos = 0;
  const segs: ReplaceSeg[] = [];
  for (const m of matches) {
    if (m.s < pos) continue;
    out += text.slice(pos, m.s);
    const ds = out.length;
    out += m.to;
    segs.push({ os: m.s, oe: m.e, ds, de: out.length });
    pos = m.e;
  }
  out += text.slice(pos);
  return { text: out, segs };
}

const SOLID = 'img,svg,video,canvas,hr,table,audio,object,iframe';

/** TYPO-009：隐藏空段落与连续的 <br>（不改文本节点，偏移不变） */
export function hideBlankLines(doc: Document): void {
  for (const el of Array.from(doc.body.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6'))) {
    if (el.querySelector(SOLID)) continue;
    if ((el.textContent ?? '').trim() === '') el.classList.add('mr-hide');
  }
  for (const br of Array.from(doc.body.querySelectorAll('br'))) {
    let prev: Node | null = br.previousSibling;
    while (prev && prev.nodeType === 3 && !(prev as Text).data.trim()) prev = prev.previousSibling;
    if (prev && prev.nodeType === 1 && (prev as Element).tagName === 'BR') br.classList.add('mr-hide');
  }
}

/** 在章节加载钩子里调用：先名字替换（改 TextIndex 映射），再简繁，再去空行 */
export async function applyTransforms(frame: ChapterFrame, o: TransformOptions): Promise<void> {
  const idx = frame.text;
  const conv = o.jian2fan && !o.fan2jian ? await getConverter('j2f') : o.fan2jian && !o.jian2fan ? await getConverter('f2j') : null;
  const rules = o.rules;
  if (rules.length || conv) {
    for (let i = 0; i < idx.nodes.length; i++) {
      const node = idx.nodes[i];
      let text = idx.orig[i];
      if (rules.length) {
        const r = replaceNames(text, rules);
        if (r) {
          text = r.text;
          idx.setReplacements(i, r.segs);
        }
      }
      if (conv) text = convertKeepLength(conv, text);
      if (text !== node.data) node.data = text;
    }
  }
  if (o.trimBlank) hideBlankLines(frame.doc);
}
