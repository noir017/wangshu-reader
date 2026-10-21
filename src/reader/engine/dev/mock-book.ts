// 开发/测试用的程序生成书：不依赖 formats 模块。
import type { BookSection, ReflowableBook, SectionContent, TocEntry } from '@/core/book';

export interface MockOptions {
  chapters?: number;
  paragraphs?: number;
  lang?: 'zh' | 'en';
  /** 书内 CSS（每章都带） */
  css?: string;
  /** 不在主线阅读顺序里的章节下标 */
  nonLinear?: number[];
  /** 每隔几个段落插入一张图（0 = 不插） */
  imageEvery?: number;
  /** 章节加载延迟 ms（测异步） */
  delay?: number;
  title?: string;
}

const ZH = [
  '山不在高，有仙则名。水不在深，有龙则灵。斯是陋室，惟吾德馨。苔痕上阶绿，草色入帘青。',
  '谈笑有鸿儒，往来无白丁。可以调素琴，阅金经。无丝竹之乱耳，无案牍之劳形。',
  '孔子云：何陋之有？学而时习之，不亦说乎？有朋自远方来，不亦乐乎？人不知而不愠，不亦君子乎？',
  '天行健，君子以自强不息；地势坤，君子以厚德载物。千里之行，始于足下；合抱之木，生于毫末。',
  '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。床前明月光，疑是地上霜。举头望明月，低头思故乡。',
  '“你好，”他说，“今天的天气真不错。”她笑了笑，没有回答，只是望着窗外缓缓飘落的雪花，心里想着很久以前的事情。',
];
const EN = [
  'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.',
  'Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse, I thought I would sail about a little.',
  'The quick brown fox jumps over the lazy dog while the extraordinarily hyphenated international communication continues unabated.',
  'All happy families are alike; each unhappy family is unhappy in its own way. Everything was in confusion in the Oblonskys house.',
];

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const SVG = (c: string, w = 300, h = 200) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${c}"/><circle cx="${w / 2}" cy="${h / 2}" r="${h / 3}" fill="white" opacity=".6"/></svg>`)}`;

export function makeMockBook(o: MockOptions = {}): ReflowableBook {
  const n = o.chapters ?? 3;
  const per = o.paragraphs ?? 30;
  const lang = o.lang ?? 'zh';
  const pool = lang === 'zh' ? ZH : EN;
  const sections: BookSection[] = [];
  const toc: TocEntry[] = [];
  for (let i = 0; i < n; i++) {
    const r = rng(i + 1);
    const title = lang === 'zh' ? `第${i + 1}章 示例章节` : `Chapter ${i + 1}`;
    let chars = title.length;
    const parts: string[] = [`<h1 id="title">${title}</h1>`];
    for (let k = 0; k < per; k++) {
      const count = 1 + Math.floor(r() * 3);
      let t = '';
      for (let j = 0; j < count; j++) t += pool[Math.floor(r() * pool.length)];
      let html = t;
      if (k === 3) html = `${t}<a href="#p10" id="lnk">跳到第十段</a>`;
      if (k === 4) html = `${t}<a href="notes.xhtml#n1" id="fn">[1]</a>`;
      if (k === 5) html = `${t}<a href="ch${Math.min(n - 1, i + 1)}.xhtml#p2" id="xch">下一章</a>`;
      if (k === 6) html = `${t}<a href="http://example.com/" id="ext">外链</a>`;
      chars += html.replace(/<[^>]+>/g, '').length;
      parts.push(`<p id="p${k}">${html}</p>`);
      if (o.imageEvery && k > 0 && k % o.imageEvery === 0) parts.push(`<p><img id="img${k}" src="${SVG(['#c66', '#6c6', '#66c'][k % 3])}" alt="示意图${k}"/></p>`);
    }
    const bodyHtml = parts.join('\n');
    sections.push({
      id: `c${i}`,
      title,
      linear: !o.nonLinear?.includes(i),
      charCount: chars,
      async load(): Promise<SectionContent> {
        if (o.delay) await new Promise((r2) => setTimeout(r2, o.delay));
        return { bodyHtml, styles: o.css ? [o.css] : [], lang: lang === 'zh' ? 'zh-CN' : 'en' };
      },
    });
    toc.push({ title, level: 0, section: i });
  }
  return {
    kind: 'reflowable',
    format: 'epub',
    metadata: { title: o.title ?? '示例书', authors: ['测试'], language: lang === 'zh' ? 'zh-CN' : 'en' },
    toc,
    sections,
    async getCover() {
      return null;
    },
    destroy() {},
    resolveHref(href, from) {
      if (/^https?:|^mailto:/i.test(href)) return null;
      if (href.startsWith('#')) return { section: from, anchor: href.slice(1) };
      const m = /^ch(\d+)\.xhtml(?:#(.*))?$/.exec(href);
      if (m) return { section: Number(m[1]), anchor: m[2] };
      if (href.startsWith('notes.xhtml')) return { section: n - 1, anchor: href.split('#')[1] };
      return null;
    },
    async getFootnote(href) {
      return href.startsWith('notes.xhtml') ? '<p>这是脚注内容。</p>' : null;
    },
  };
}

// ───────────── 固定版式的程序生成书（PDF/漫画） ─────────────
import type { FixedBook, FixedPageText } from '@/core/book';

export interface MockFixedOptions {
  pages?: number;
  /** 漫画（无文字层） */
  comic?: boolean;
  /** 格式名，缺省 pdf / cbz */
  format?: string;
  /** 横向页（宽>高）的下标 */
  wide?: number[];
  /** 长条页（600×2400）的下标 */
  tall?: number[];
  direction?: 'ltr' | 'rtl';
  /** renderPage 延迟 ms */
  delay?: number;
  title?: string;
}

const LINES = 10;
const LINE_Y = (k: number) => 120 + k * 62;
const FONT = '28px monospace';

export function makeMockFixedBook(o: MockFixedOptions = {}): FixedBook {
  const n = o.pages ?? 12;
  const comic = !!o.comic;
  const sizeOf = (i: number) => (o.wide?.includes(i) ? { width: 800, height: 600 } : o.tall?.includes(i) ? { width: 600, height: 2400 } : comic ? { width: 700, height: 1000 } : { width: 600, height: 800 });
  const lineText = (i: number, k: number) => `P${i + 1} L${k + 1} hello world`.padEnd(22, '.');
  let charW = 0;
  const measure = () => {
    if (!charW) {
      const c = document.createElement('canvas').getContext('2d')!;
      c.font = FONT;
      charW = c.measureText('m').width;
    }
    return charW;
  };
  const hue = (i: number) => (i * 47) % 360;
  return {
    kind: 'fixed',
    format: o.format ?? (comic ? 'cbz' : 'pdf'),
    metadata: { title: o.title ?? (comic ? '示例漫画' : '示例 PDF'), authors: ['测试'], direction: o.direction },
    toc: [
      { title: '第一部分', level: 0, section: 0 },
      { title: '第二部分', level: 0, section: Math.min(n - 1, 5) },
    ],
    pageCount: n,
    async getCover() {
      return null;
    },
    destroy() {},
    async getPageSize(i) {
      return sizeOf(i);
    },
    async renderPage(i, r) {
      if (o.delay) await new Promise((res) => setTimeout(res, o.delay));
      const s = sizeOf(i);
      const scale = Math.min((r.width * r.dpr) / s.width, (r.height * r.dpr) / s.height);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(s.width * scale));
      c.height = Math.max(1, Math.round(s.height * scale));
      const g = c.getContext('2d')!;
      g.scale(scale, scale);
      if (comic) {
        const grad = g.createLinearGradient(0, 0, s.width, s.height);
        grad.addColorStop(0, `hsl(${hue(i)},70%,70%)`);
        grad.addColorStop(1, `hsl(${hue(i) + 60},70%,35%)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, s.width, s.height);
        g.fillStyle = 'rgba(255,255,255,.85)';
        g.font = 'bold 220px sans-serif';
        g.textAlign = 'center';
        g.fillText(String(i + 1), s.width / 2, s.height / 2 + 80);
        g.strokeStyle = '#000';
        g.lineWidth = 6;
        g.strokeRect(20, 20, s.width - 40, s.height - 40);
      } else {
        g.fillStyle = '#fff';
        g.fillRect(0, 0, s.width, s.height);
        g.strokeStyle = '#999';
        g.lineWidth = 2;
        g.strokeRect(10, 10, s.width - 20, s.height - 20);
        g.fillStyle = '#c33';
        g.font = 'bold 56px sans-serif';
        g.fillText(`Page ${i + 1}`, 40, 80);
        g.fillStyle = '#111';
        g.font = FONT;
        for (let k = 0; k < LINES; k++) g.fillText(lineText(i, k), 40, LINE_Y(k) + 24);
        g.fillStyle = '#69c';
        g.fillRect(380, s.height - 130, 180, 90);
      }
      return c;
    },
    getPageText: comic
      ? undefined
      : async (i): Promise<FixedPageText | null> => {
          if (i < 0 || i >= n) return null;
          const s = sizeOf(i);
          const w = measure() * 22;
          let text = '';
          const items: FixedPageText['items'] = [];
          for (let k = 0; k < LINES; k++) {
            const t = lineText(i, k);
            items.push({ start: text.length, end: text.length + t.length, x: 40 / s.width, y: LINE_Y(k) / s.height, w: w / s.width, h: 32 / s.height });
            text += t + '\n';
          }
          return { text, items };
        },
  };
}
