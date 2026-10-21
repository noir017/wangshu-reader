// 开发/测试用的假书：可重排书（多章中英文混排文本）与固定版式书（画页码的 canvas）。
import type { FixedBook, ReflowableBook, TocEntry } from '@/core/book';

const ZH = [
  '山不在高，有仙则名。水不在深，有龙则灵。斯是陋室，惟吾德馨。苔痕上阶绿，草色入帘青。谈笑有鸿儒，往来无白丁。可以调素琴，阅金经。无丝竹之乱耳，无案牍之劳形。',
  '行到水穷处，坐看云起时。偶然值林叟，谈笑无还期。人闲桂花落，夜静春山空。月出惊山鸟，时鸣春涧中。',
  '这是一个用于界面开发的假章节。段落里同时包含中文、English words, numbers 12345 以及标点符号，用来检验字号、行距、字距、对齐、缩进和页边距的设置是否即时生效。',
  'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump! Sphinx of black quartz, judge my vow.',
  '“你好，”他说，“今天的天气真不错。”她笑了笑，没有回答，只是把目光移向窗外那一片渐渐暗下去的天空。远处传来钟声，一下，两下，三下。',
];

export function mockChapterText(i: number, paragraphs = 16): string[] {
  const out: string[] = [];
  for (let p = 0; p < paragraphs; p++) out.push(`${ZH[(i + p) % ZH.length]}${p % 3 === 0 ? ZH[(i + p + 1) % ZH.length] : ''}`);
  return out;
}

export function createMockBook(opts: { chapters?: number; paragraphs?: number; title?: string; language?: string } = {}): ReflowableBook {
  const n = opts.chapters ?? 8;
  const sections = Array.from({ length: n }, (_, i) => {
    const paras = mockChapterText(i, opts.paragraphs ?? 16);
    const text = paras.join('');
    return {
      id: `c${i}`,
      title: `第 ${i + 1} 章 · 假章节`,
      linear: true,
      charCount: text.length,
      load: async () => ({ bodyHtml: paras.map((p) => `<p>${p}</p>`).join(''), styles: [] }),
    };
  });
  const toc: TocEntry[] = sections.map((s, i) => ({ title: s.title!, level: 0, section: i }));
  return {
    kind: 'reflowable',
    format: 'epub',
    metadata: { title: opts.title ?? '界面开发样书', authors: ['Moon Dev'], language: opts.language ?? 'zh' },
    toc,
    sections,
    resolveHref: () => null,
    getCover: async () => null,
    destroy: () => {},
  };
}

export function createMockFixedBook(pageCount = 20): FixedBook {
  return {
    kind: 'fixed',
    format: 'pdf',
    metadata: { title: '假 PDF', authors: [] },
    toc: [],
    pageCount,
    getPageSize: async () => ({ width: 600, height: 800 }),
    renderPage: async (index, { width, height, dpr }) => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(width * dpr));
      c.height = Math.max(1, Math.round(height * dpr));
      const g = c.getContext('2d');
      if (g) {
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#333';
        g.font = `${Math.round(c.height / 5)}px sans-serif`;
        g.textAlign = 'center';
        g.fillText(String(index + 1), c.width / 2, c.height / 2);
        g.strokeRect(2, 2, c.width - 4, c.height - 4);
      }
      return c;
    },
    getCover: async () => null,
    destroy: () => {},
  };
}
