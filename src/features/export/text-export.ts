// 标注导出文本（ANNO-010，原 PrefChapters.createShareContent）：纯文本 / HTML / Markdown。
import type { AnnotationRecord } from '@/core/library';
import { escapeHtml } from '../common/format';

export type ExportFormat = 'text' | 'html' | 'markdown';

export interface ShareContext {
  title: string;
  author: string;
  /** 分享内容里包含章节信息（shareWithChapter） */
  withChapter: boolean;
  lang?: 'zh' | 'en';
}

const RULE = '───────────────';

function labels(lang: 'zh' | 'en') {
  return lang === 'zh' ? { hl: '高亮', note: '标注' } : { hl: 'Highlights', note: 'Notes' };
}

export function countKinds(list: AnnotationRecord[]): { highlights: number; notes: number } {
  let highlights = 0;
  let notes = 0;
  for (const a of list) {
    if (a.kind !== 'highlight') continue;
    if (a.note) notes++;
    else highlights++;
  }
  return { highlights, notes };
}

/** 书签不导出；开启章节信息时按位置排序并在章变化处分组 */
export function selectForShare(list: AnnotationRecord[], withChapter: boolean): AnnotationRecord[] {
  const hl = list.filter((a) => a.kind === 'highlight' && !a.deletedAt);
  return withChapter ? [...hl].sort((a, b) => a.range.section - b.range.section || a.range.start - b.range.start) : hl;
}

export function headerLine(ctx: ShareContext, c: { highlights: number; notes: number }): string {
  const l = labels(ctx.lang ?? 'zh');
  const who = ctx.author ? `${ctx.title} - ${ctx.author}` : ctx.title;
  return `${who} (${l.hl}: ${c.highlights}; ${l.note}: ${c.notes})`;
}

/** 按章分组（保持顺序）；没有章节信息的归到空标题组 */
function groupByChapter(items: AnnotationRecord[]): { chapter: string; items: AnnotationRecord[] }[] {
  const groups: { chapter: string; section: number; items: AnnotationRecord[] }[] = [];
  for (const a of items) {
    const last = groups[groups.length - 1];
    if (last && last.section === a.range.section) last.items.push(a);
    else groups.push({ chapter: a.chapterTitle ?? '', section: a.range.section, items: [a] });
  }
  return groups;
}

export function buildShareText(list: AnnotationRecord[], ctx: ShareContext, format: ExportFormat = 'text'): string {
  const items = selectForShare(list, ctx.withChapter);
  const counts = countKinds(items);
  const head = headerLine(ctx, counts);
  const groups = ctx.withChapter ? groupByChapter(items) : [{ chapter: '', items }];

  if (format === 'text') {
    let out = `${head}\n${RULE}`;
    for (const g of groups) {
      if (ctx.withChapter && g.chapter) out += `\n\n◆ ${g.chapter}`;
      for (const a of g.items) {
        out += `\n\n${ctx.withChapter ? '  ▪ ' : '▪ '}${a.text}${a.note ? ` (${a.note})` : ''}`;
      }
    }
    return out + '\n';
  }

  if (format === 'markdown') {
    const quote = (s: string) => s.split('\n').map((l) => `> ${l}`).join('\n');
    let out = `# ${ctx.author ? `${ctx.title} - ${ctx.author}` : ctx.title}\n\n_${head.slice((ctx.author ? `${ctx.title} - ${ctx.author}` : ctx.title).length + 1)}_\n`;
    for (const g of groups) {
      if (ctx.withChapter && g.chapter) out += `\n## ${g.chapter}\n`;
      for (const a of g.items) {
        out += `\n${quote(a.text)}\n`;
        if (a.note) out += `\n${a.note}\n`;
      }
    }
    return out;
  }

  const body = groups
    .map((g) => {
      const h = ctx.withChapter && g.chapter ? `<h2>${escapeHtml(g.chapter)}</h2>\n` : '';
      const li = g.items
        .map((a) => `<blockquote><p>${escapeHtml(a.text).replace(/\n/g, '<br>')}</p>${a.note ? `<p class="note">${escapeHtml(a.note).replace(/\n/g, '<br>')}</p>` : ''}</blockquote>`)
        .join('\n');
      return h + li;
    })
    .join('\n');
  return `<!doctype html>\n<html lang="${ctx.lang ?? 'zh'}"><head><meta charset="utf-8"><title>${escapeHtml(ctx.title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.7}blockquote{margin:1em 0;padding:.2em 1em;border-left:4px solid #ccc;color:#333}.note{color:#b05a00}</style></head>
<body>\n<h1>${escapeHtml(ctx.author ? `${ctx.title} - ${ctx.author}` : ctx.title)}</h1>\n<p><small>${escapeHtml(head.slice((ctx.author ? `${ctx.title} - ${ctx.author}` : ctx.title).length + 1))}</small></p>\n${body}\n</body></html>\n`;
}

/** 过长（>80000 字符）时不走系统分享，改复制/保存（原 app 行为） */
export const SHARE_TEXT_LIMIT = 80_000;
