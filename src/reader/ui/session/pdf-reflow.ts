// PDF 文本重排（PDF-006）：把固定版式书每页的文字整理成段落，包装成「一页一章」的可重排书，交给文本引擎排版
// （排版/主题/字号/朗读/选择/搜索全部可用）。原版 pdfTextReflowSwitch + A.formatPdfReflowText。
//
// 关键约束：章节 DOM 的文本节点按顺序拼起来必须与该页 getPageText().text 逐字相同（core/text 的偏移基准），
// 这样固定版式下的进度、标注、搜索结果在重排模式里位置照旧，切回去也对得上。所以不删字，只把要「接上」的
// 换行/连字符包进隐藏的 span（隐藏文本仍计入偏移），段落边界的换行留在段尾（行尾空白不显示）。
import type { BookSection, FixedBook, FixedPageText, ReflowableBook } from '@/core/book';

const HIDDEN = '<span style="display:none">';
const PAGE_CSS = '.mr-reflow-page{text-align:end;opacity:.5;font-size:.8em;text-indent:0}.mr-reflow-page::after{content:attr(data-p)}';

const esc = (s: string) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
/** Unicode Lo（汉字、假名等「其他字母」）：行内断开后直接接上，不补空格（原版 Character.getType == 5） */
const isOtherLetter = (ch: string) => /^\p{Lo}$/u.test(ch);

interface LineGeo {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 每一行（按 \n 切）的几何范围（归一化坐标）；没有文字块的行为 null */
function lineGeometry(text: string, items: FixedPageText['items']): Array<{ start: number; end: number; geo: LineGeo | null }> {
  const lines: Array<{ start: number; end: number; geo: LineGeo | null }> = [];
  let s = 0;
  for (;;) {
    const nl = text.indexOf('\n', s);
    const e = nl === -1 ? text.length : nl;
    lines.push({ start: s, end: e, geo: null });
    if (nl === -1) break;
    s = nl + 1;
  }
  let li = 0;
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    if (it.end <= it.start) continue;
    while (li < lines.length - 1 && it.start >= lines[li].end + 1) li++;
    const g = lines[li].geo;
    const r = { left: it.x, right: it.x + it.w, top: it.y, bottom: it.y + it.h };
    lines[li].geo = g ? { left: Math.min(g.left, r.left), right: Math.max(g.right, r.right), top: Math.min(g.top, r.top), bottom: Math.max(g.bottom, r.bottom) } : r;
  }
  return lines;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((p, q) => p - q);
  return a[a.length >> 1];
};

/**
 * 一页文字 → 段落 HTML（规则照 A.formatPdfReflowText）：
 *  - 与下一行的行距明显大于常规行距、或字高明显不同（标题）→ 分段；
 *  - 本行写满（超过所在栏宽的 80%）：行末连字符去掉并接上下一行；否则接上（汉字等直接接，其他语言以空格相隔）；
 *  - 本行没写满 → 段落结束。
 * 没有几何信息时退化为按标点判断（行末是句末标点才分段）。
 */
export function reflowPageHtml(text: string, items: FixedPageText['items'] = []): string {
  const lines = lineGeometry(text, items);
  const geos = lines.map((l) => l.geo).filter((g): g is LineGeo => !!g);
  const step = median(lines.slice(0, -1).flatMap((l, i) => (l.geo && lines[i + 1].geo && lines[i + 1].geo!.top > l.geo.top ? [lines[i + 1].geo!.top - l.geo.top] : [])));
  /** 同一栏（左边界相近的行）的最右边界：两栏排版时左栏的行不能拿右栏的宽度比 */
  const colRight = (g: LineGeo) => Math.max(...geos.filter((o) => Math.abs(o.left - g.left) < 0.15).map((o) => o.right));

  const paras: string[] = [];
  let cur = '';
  const endPara = (tail: string) => {
    cur += tail;
    if (cur.trim()) paras.push(cur);
    else if (paras.length) paras[paras.length - 1] += cur; // 空行的换行并进上一段段尾（只为保住偏移）
    else paras.push(cur);
    cur = '';
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = text.slice(lines[i].start, lines[i].end);
    if (i === lines.length - 1) {
      cur += esc(raw);
      endPara('');
      break;
    }
    const g = lines[i].geo;
    const n = lines[i + 1].geo;
    const last = raw.at(-1) ?? '';
    let join: boolean;
    if (!raw.trim() || !text.slice(lines[i + 1].start, lines[i + 1].end).trim()) join = false;
    else if (g && n) {
      const gap = n.top - g.top;
      const hg = g.bottom - g.top;
      const hn = n.bottom - n.top;
      const bigGap = step > 0 && gap > step * 1.6;
      const otherSize = Math.abs(hg - hn) > 0.25 * Math.max(hg, hn);
      const full = g.right >= g.left + 0.8 * (colRight(g) - g.left);
      join = !bigGap && !otherSize && full;
    } else join = !/[\p{Po}\p{Pf}]$/u.test(last) || last === ',';
    if (!join) {
      cur += esc(raw);
      endPara('\n');
    } else if (last === '-') cur += esc(raw.slice(0, -1)) + HIDDEN + '-\n</span>';
    else if (isOtherLetter(last)) cur += esc(raw) + HIDDEN + '\n</span>';
    else cur += esc(raw) + '\n'; // 普通空白：显示为一个空格
  }
  return paras.map((p) => `<p>${p}</p>`).join('');
}

/** 把固定版式书包装成重排书：一页一章，目录照搬（目录项的 section 就是页号），书籍元数据/封面不变 */
export function reflowFixedBook(fixed: FixedBook & { getPageText: NonNullable<FixedBook['getPageText']> }): ReflowableBook {
  const n = fixed.pageCount;
  const titles = new Map<number, string>();
  const walk = (es: FixedBook['toc']) => {
    for (const e of es) {
      if (!titles.has(e.section)) titles.set(e.section, e.title);
      if (e.children) walk(e.children);
    }
  };
  walk(fixed.toc);
  const sections: BookSection[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    title: titles.get(i) ?? `${i + 1}/${n}`,
    linear: true,
    charCount: 1500, // 只用于全书进度估算，要稳定：按每页大致字数算
    async load() {
      const t = await fixed.getPageText(i);
      const body = t?.text ? reflowPageHtml(t.text, t.items) : '';
      // 页尾的「<页/总页>」（原版也在重排文本末尾追加）用伪元素画，不产生文本节点，免得混进朗读/搜索
      return { bodyHtml: `${body}<p class="mr-reflow-page" data-p="<${i + 1}/${n}>"></p>`, styles: [PAGE_CSS] };
    },
  }));
  return {
    kind: 'reflowable',
    format: fixed.format,
    metadata: fixed.metadata,
    toc: fixed.toc,
    sections,
    resolveHref: () => null,
    getCover: () => fixed.getCover(),
    destroy: () => fixed.destroy(),
  };
}

/** 能否文本重排：有文字层的固定版式（PDF；DJVU 经服务端转成 PDF 后同样有） */
export function canReflow(book: { kind: string; format: string; getPageText?: unknown }): boolean {
  return book.kind === 'fixed' && typeof book.getPageText === 'function' && (book.format === 'pdf' || book.format === 'djvu');
}

/** 当前会话是否是重排出来的书 */
export function isReflowed(book: { kind: string; format: string }): boolean {
  return book.kind === 'reflowable' && (book.format === 'pdf' || book.format === 'djvu');
}
