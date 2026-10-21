import { describe, expect, it } from 'vitest';
import { downloadExt, downloadName, fillSearchTemplate, guessPrevUrl, pageInfo, parseOpds, parseOpenSearchDescription, resolveHref } from './opds';

const GUT_BOOK = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
<id>http://www.gutenberg.org/ebooks/1342.opds</id>
<title>Pride and Prejudice by Jane Austen</title>
<subtitle>Free eBooks since 1971.</subtitle>
<link rel="search" type="application/opensearchdescription+xml" title="Catalog Search" href="https://www.gutenberg.org/catalog/osd-books.xml"/>
<link rel="self" title="This Page" type="application/atom+xml;profile=opds-catalog" href="/ebooks/1342.opds"/>
<opensearch:itemsPerPage>25</opensearch:itemsPerPage>
<opensearch:startIndex>1</opensearch:startIndex>
<entry>
<title>Pride and Prejudice</title>
<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Summary: A novel &amp; more.</p><p>Author: Austen, Jane</p></div></content>
<id>urn:gutenberg:1342:2</id>
<author><name>Austen, Jane</name></author>
<dcterms:language>en</dcterms:language>
<link type="application/epub+zip" rel="http://opds-spec.org/acquisition" title="EPUB (older e-readers, no images)" length="561102" href="https://www.gutenberg.org/ebooks/1342.epub.noimages"/>
<link type="application/x-mobipocket-ebook" rel="http://opds-spec.org/acquisition" title="Kindle (no images)" length="540013" href="https://www.gutenberg.org/ebooks/1342.kindle.noimages"/>
<link type="image/jpeg" rel="http://opds-spec.org/image" href="https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg"/>
<link type="image/jpeg" rel="http://opds-spec.org/image/thumbnail" href="/cache/epub/1342/pg1342.cover.small.jpg"/>
<link type="application/atom+xml;profile=opds-catalog" rel="related" href="/ebooks/author/68.opds" title="By Austen, Jane…"/>
</entry>
</feed>`;

const GUT_SEARCH = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
<title>Books: dickens</title>
<link rel="self" type="application/atom+xml;profile=opds-catalog" href="/ebooks/search.opds/?query=dickens&amp;start_index=26"/>
<link rel="next" type="application/atom+xml;profile=opds-catalog" href="/ebooks/search.opds/?query=dickens&amp;start_index=51"/>
<opensearch:totalResults>120</opensearch:totalResults>
<opensearch:itemsPerPage>25</opensearch:itemsPerPage>
<opensearch:startIndex>26</opensearch:startIndex>
<entry><id>x1</id><title>Authors</title><content type="text">5 author names match.</content>
<link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/authors/search.opds/?query=dickens"/>
<link type="image/png" rel="http://opds-spec.org/image/thumbnail" href="data:image/png;base64,AAAA"/></entry>
<entry><id>x2</id><title>Oliver Twist</title><content type="text">Charles Dickens</content>
<link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/730.opds"/></entry>
</feed>`;

const MOON = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Moon+ Reader Online Catalogs from users</title>
<entry><title>Prestigio Plaza catalog</title><link type="application/atom+xml" href="http://ebooks.prestigioplaza.com/feed"/><content type="text">Enjoy eReading in your language.</content></entry>
<entry><title>Library Genesis</title><link type="text/html" href="http://gen.lib.rus.ec/"/><content type="text">gen.lib.rus.ec</content></entry>
</feed>`;

describe('opds 解析', () => {
  it('书条目：下载链接、封面、缩略图、xhtml 简介', () => {
    const feed = parseOpds(GUT_BOOK, 'https://www.gutenberg.org/ebooks/1342.opds')!;
    expect(feed.title).toBe('Pride and Prejudice by Jane Austen');
    expect(feed.searchDescUrl).toBe('https://www.gutenberg.org/catalog/osd-books.xml');
    expect(feed.searchTemplate).toBeUndefined();
    const e = feed.entries[0];
    expect(e.kind).toBe('book');
    expect(e.authors).toEqual(['Austen, Jane']);
    expect(e.downloads.map((d) => [d.ext, d.size])).toEqual([['epub', 561102], ['mobi', 540013]]);
    expect(e.downloads[0].title).toContain('EPUB');
    expect(e.cover).toBe('https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg');
    expect(e.thumb).toBe('https://www.gutenberg.org/cache/epub/1342/pg1342.cover.small.jpg');
    expect(e.summaryHtml).toContain('<p>Summary: A novel &amp; more.</p>');
    expect(e.related).toHaveLength(1);
    expect(e.language).toBe('en');
  });
  it('搜索页：子目录条目、data: 缩略图、分页信息', () => {
    const feed = parseOpds(GUT_SEARCH, 'https://www.gutenberg.org/ebooks/search.opds/?query=dickens&start_index=26')!;
    expect(feed.entries.map((e) => e.kind)).toEqual(['dir', 'dir']);
    expect(feed.entries[0].thumb).toBe('data:image/png;base64,AAAA');
    expect(feed.entries[1].href).toBe('https://www.gutenberg.org/ebooks/730.opds');
    expect(feed.nextUrl).toBe('https://www.gutenberg.org/ebooks/search.opds/?query=dickens&start_index=51');
    expect(pageInfo(feed)).toEqual({ page: 2, pages: 5 });
    expect(guessPrevUrl(feed)).toBe('https://www.gutenberg.org/ebooks/search.opds/?query=dickens&start_index=1');
  });
  it('无 rel 的 atom 链接是目录，text/html 是网页', () => {
    const feed = parseOpds(MOON, 'http://www.moondownload.com/catalog.xml')!;
    expect(feed.entries.map((e) => e.kind)).toEqual(['dir', 'web']);
    expect(feed.entries[0].href).toBe('http://ebooks.prestigioplaza.com/feed');
  });
  it('xml:base 与 self 决定相对链接基址；不是 feed 返回 null', () => {
    const f = parseOpds('<feed xml:base="http://a.com/opds/" xmlns="http://www.w3.org/2005/Atom"><entry><title>t</title><link rel="subsection" type="application/atom+xml" href="sub"/></entry></feed>', 'http://x/')!;
    expect(f.entries[0].href).toBe('http://a.com/opds/sub');
    expect(parseOpds('<html><body>login</body></html>', 'http://x/')).toBeNull();
  });
  it('搜索模板：直接给模板 / OpenSearch 描述文档', () => {
    const f = parseOpds(`<feed xmlns="http://www.w3.org/2005/Atom"><link rel="search" href="/search?q={searchTerms}"/></feed>`, 'http://a.com/x')!;
    expect(f.searchTemplate).toBe('http://a.com/search?q={searchTerms}');
    expect(fillSearchTemplate(f.searchTemplate!, '三体 a&b')).toBe('http://a.com/search?q=%E4%B8%89%E4%BD%93%20a%26b');
    expect(fillSearchTemplate('http://a/s?q={searchTerms}&p={startPage?}', 'x')).toBe('http://a/s?q=x&p=1');
    const osd = `<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"><Url type="text/html" template="/h?q={searchTerms}"/><Url type="application/atom+xml" template="/ebooks/search.opds/?query={searchTerms}"/></OpenSearchDescription>`;
    expect(parseOpenSearchDescription(osd, 'https://www.gutenberg.org/catalog/osd-books.xml')).toBe('https://www.gutenberg.org/ebooks/search.opds/?query={searchTerms}');
  });
});

describe('opds 辅助', () => {
  it('下载格式识别', () => {
    expect(downloadExt('application/epub+zip', 'x')).toBe('epub');
    expect(downloadExt('application/x-mobipocket-ebook', 'x')).toBe('mobi');
    expect(downloadExt('application/vnd.amazon.ebook', 'x')).toBe('azw3');
    expect(downloadExt('application/pdf', 'x')).toBe('pdf');
    expect(downloadExt('text/plain; charset=utf-8', 'x')).toBe('txt');
    expect(downloadExt('', 'https://a/b/c.epub3?x=1')).toBe('epub');
    expect(downloadExt('text/html', 'https://a/b')).toBeNull();
  });
  it('链接解析与保存文件名', () => {
    expect(resolveHref('http://a.com/b/c', '../d')).toBe('http://a.com/d');
    expect(resolveHref('http://a.com', 'data:image/png;base64,xx')).toBe('data:image/png;base64,xx');
    expect(downloadName('Pride: and/Prejudice', 'Jane Austen', 'epub')).toBe('Pride and Prejudice - Jane Austen.epub');
    expect(downloadName('T', '', 'pdf')).toBe('T.pdf');
    expect(downloadName('x'.repeat(150), '', 'epub').length).toBeLessThan(115);
  });
});
