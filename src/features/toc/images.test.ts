import { describe, expect, it } from 'vitest';
import type { ReflowableBook } from '@/core/book';
import { bookHasImages, extractImageSrcs, scanBookImages } from './images';

function book(htmls: string[]): ReflowableBook {
  return {
    kind: 'reflowable', format: 'epub', metadata: { title: 't', authors: [] }, toc: [],
    sections: htmls.map((h, i) => ({ id: 's' + i, linear: true, charCount: 1, load: async () => ({ bodyHtml: h, styles: [] }) })),
    resolveHref: () => null, getCover: async () => null, destroy() {},
  };
}

describe('图片索引', () => {
  it('提取 <img> 与 SVG <image>，按文档顺序，还原 &amp;', () => {
    const html = `<p>x</p><img alt="a" src="blob:1"/><svg><image xlink:href="blob:2"/></svg><IMG SRC='data:a&amp;b'>`;
    expect(extractImageSrcs(html)).toEqual(['blob:1', 'blob:2', 'data:a&b']);
    expect(extractImageSrcs('<p>没有图</p>')).toEqual([]);
  });
  it('整本扫描：记录章号与章内序号；缓存', async () => {
    const b = book(['<p>a</p>', '<img src="x"><img src="y">', '<img src="z">']);
    const progress: number[] = [];
    const list = await scanBookImages(b, { onProgress: (d) => progress.push(d) });
    expect(list).toEqual([{ src: 'x', section: 1, index: 0 }, { src: 'y', section: 1, index: 1 }, { src: 'z', section: 2, index: 0 }]);
    expect(progress).toEqual([1, 2, 3]);
    expect(await scanBookImages(b)).toBe(list);
  });
  it('某个调用方中途放弃（面板关闭/StrictMode 重挂载）不影响后来的调用方拿到完整结果', async () => {
    const b = book(['<img src="x">', '<img src="y">']);
    const ac = new AbortController();
    const first = scanBookImages(b, { signal: ac.signal });
    ac.abort();
    await expect(first).rejects.toThrow();
    const second = await scanBookImages(b, { signal: new AbortController().signal });
    expect(second.map((i) => i.src)).toEqual(['x', 'y']);
  });
  it('是否有图', async () => {
    expect(await bookHasImages(book(['<p>a</p>', '<img src="x">']))).toBe(true);
    expect(await bookHasImages(book(['<p>a</p>']))).toBe(false);
  });
});
