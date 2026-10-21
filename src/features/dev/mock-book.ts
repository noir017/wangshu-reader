// 开发/测试用的程序生成书：不依赖 formats 模块。内容专门覆盖 features 要处理的情形：
// 脚注（EPUB3 noteref）、内部/外部链接、图片、多级目录、重复词（搜索/同词高亮）、中英文、很长的章（翻页/朗读）。
import type { BookSection, ReflowableBook, SectionContent, TocEntry } from '@/core/book';
import { textOfHtml } from '@/core/text';

export interface DevBookOptions {
  /** 额外追加的长章节数（每章若干段，用来测翻页/朗读/大目录） */
  longChapters?: number;
  title?: string;
}

const IMG_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="100%" height="100%" fill="#6a9fd8"/><circle cx="160" cy="100" r="60" fill="#fff" opacity=".7"/></svg>',
)}`;
const IMG_SVG2 = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="100%" height="100%" fill="#d88a6a"/><rect x="80" y="50" width="160" height="100" fill="#fff" opacity=".7"/></svg>',
)}`;

const ZH_PARAS = [
  '山不在高，有仙则名。水不在深，有龙则灵。斯是陋室，惟吾德馨。苔痕上阶绿，草色入帘青。',
  '谈笑有鸿儒，往来无白丁。可以调素琴，阅金经。无丝竹之乱耳，无案牍之劳形。南阳诸葛庐，西蜀子云亭。孔子云：何陋之有？',
  '天行健，君子以自强不息；地势坤，君子以厚德载物。千里之行，始于足下；合抱之木，生于毫末。',
  '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。床前明月光，疑是地上霜。举头望明月，低头思故乡。',
  '“你好，”他说，“今天的天气真不错。”她笑了笑，没有回答，只是望着窗外缓缓飘落的雪花，心里想着很久以前的事情。',
];
const EN_PARAS = [
  'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness. Mr. Brown said hello.',
  'Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse, I thought I would sail about a little.',
  'The quick brown fox jumps over the lazy dog while the extraordinarily hyphenated international communication continues unabated.',
  'All happy families are alike; each unhappy family is unhappy in its own way. Everything was in confusion in the Oblonskys house.',
];

const para = (pool: string[], i: number) => pool[i % pool.length];

function ch1(): string {
  return `
<h1 id="top">第一章 起点</h1>
<p id="p1">${ZH_PARAS[0]}${ZH_PARAS[1]}</p>
<p id="p2">这一段里有一个脚注标记<a href="#fn1" epub:type="noteref" id="r1">[1]</a>，点它应该弹出气泡。还有一个<a href="ch2.xhtml">指向第二章的内部链接</a>，以及一个<a href="https://example.com/page">外部链接</a>。</p>
<p id="p3">${ZH_PARAS[2]}${ZH_PARAS[3]}</p>
<p id="p4">${ZH_PARAS[4]}苔痕上阶绿，苔痕上阶绿，重复的词用来测搜索与同词高亮。</p>
<p id="p5">${ZH_PARAS[0]}${ZH_PARAS[2]}</p>
<aside epub:type="footnote" id="fn1"><p>[1] 这是脚注的内容：陋室铭，唐代刘禹锡所作。</p></aside>`;
}

function ch2(): string {
  return `
<h1 id="c2">Chapter Two</h1>
<p>${para(EN_PARAS, 0)}</p>
<p><img src="${IMG_SVG}" alt="blue picture" id="img1"/></p>
<p>${para(EN_PARAS, 1)} The word fox appears here: fox.</p>
<p>${para(EN_PARAS, 2)}</p>
<p><img src="${IMG_SVG2}" alt="orange picture" id="img2"/></p>
<p>${para(EN_PARAS, 3)}</p>
<h2 id="c2s">A subsection</h2>
<p>${para(EN_PARAS, 1)}</p>`;
}

function longChapter(n: number): string {
  const parts: string[] = [`<h1 id="h${n}">第${n}章 长篇</h1>`];
  for (let i = 0; i < 36; i++) {
    if (i === 18) parts.push(`<h2 id="mid${n}">中段小节${n}</h2>`);
    parts.push(`<p>${ZH_PARAS[(i + n) % ZH_PARAS.length]}${ZH_PARAS[(i + n + 2) % ZH_PARAS.length]}</p>`);
  }
  return parts.join('\n');
}

export function makeDevBook(o: DevBookOptions = {}): ReflowableBook & { chapterTexts: string[] } {
  const longN = o.longChapters ?? 2;
  const bodies: { id: string; title: string; html: string }[] = [
    { id: 'ch1', title: '第一章 起点', html: ch1() },
    { id: 'ch2', title: 'Chapter Two', html: ch2() },
  ];
  for (let i = 0; i < longN; i++) bodies.push({ id: `long${i + 1}`, title: `第${i + 3}章 长篇`, html: longChapter(i + 3) });

  const sections: BookSection[] = bodies.map((b) => ({
    id: b.id,
    title: b.title,
    linear: true,
    charCount: b.html.replace(/<[^>]+>/g, '').length,
    async load(): Promise<SectionContent> {
      return { bodyHtml: b.html, styles: [] };
    },
  }));

  const toc: TocEntry[] = [
    { title: '第一部分', level: 1, section: 0, children: [
      { title: '第一章 起点', level: 2, section: 0 },
      { title: 'Chapter Two', level: 2, section: 1, children: [{ title: 'A subsection', level: 3, section: 1, anchor: 'c2s' }] },
    ] },
    ...(longN
      ? [{ title: '第二部分', level: 1, section: 2, children: bodies.slice(2).map((b, i) => ({
            title: b.title,
            level: 2,
            section: i + 2,
            children: [{ title: `中段小节${i + 3}`, level: 3, section: i + 2, anchor: `mid${i + 3}` }],
          })) } as TocEntry]
      : []),
  ];

  const idOf = (href: string): { section: number; anchor?: string } | null => {
    const [file, anchor] = href.split('#');
    if (!file) return null;
    const i = bodies.findIndex((b) => file === `${b.id}.xhtml`);
    return i < 0 ? null : { section: i, anchor: anchor || undefined };
  };

  const chapterTexts = bodies.map((b) => textOfHtml(b.html));

  return {
    kind: 'reflowable',
    format: 'epub',
    metadata: { title: o.title ?? '开发样书', authors: ['Moon Dev'], language: 'zh' },
    toc,
    sections,
    chapterTexts,
    async getCover() {
      return null;
    },
    destroy() {},
    async getFootnote(href, fromSection) {
      const r = idOf(href.startsWith('#') ? `${bodies[fromSection].id}.xhtml${href}` : href);
      if (!r?.anchor) return null;
      const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${bodies[r.section].html}</body></html>`, 'text/html');
      const el = doc.getElementById(r.anchor);
      return el?.getAttribute('epub:type') === 'footnote' ? el.innerHTML : null;
    },
    resolveHref(href, fromSection) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
      if (href.startsWith('#')) return { section: fromSection, anchor: href.slice(1) };
      return idOf(href);
    },
  };
}
