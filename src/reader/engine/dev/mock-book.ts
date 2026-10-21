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
