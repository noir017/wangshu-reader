import { describe, expect, it } from 'vitest';
import { child, childText, childrenOf, innerXml, parseXml, textOf } from './xml';

describe('xml', () => {
  it('命名空间前缀、属性、实体、CDATA、自闭合', () => {
    const root = parseXml(`garbage<?xml version="1.0"?><!-- c --><feed xmlns="http://www.w3.org/2005/Atom" xmlns:os="http://a9.com/-/spec/opensearch/1.1/">
      <title>A &amp; B &#20013;</title><os:totalResults>42</os:totalResults>
      <link rel="next" href="/p?a=1&amp;b=2" type="application/atom+xml"/>
      <entry><title><![CDATA[<raw>]]></title></entry></feed>`)!;
    expect(root.local).toBe('feed');
    expect(childText(root, 'title')).toBe('A & B 中');
    expect(childText(root, 'totalresults')).toBe('42');
    expect(child(root, 'link')!.attrs.href).toBe('/p?a=1&b=2');
    expect(textOf(child(childrenOf(root, 'entry')[0], 'title'))).toBe('<raw>');
  });
  it('xhtml 内容序列化回去', () => {
    const root = parseXml('<content type="xhtml"><div><p class="x">a<b>b</b></p><br/></div></content>')!;
    expect(innerXml(root)).toBe('<div><p class="x">a<b>b</b></p><br/></div>');
  });
  it('未闭合标签不崩', () => {
    const root = parseXml('<a><b>1<c>2</a>')!;
    expect(textOf(root)).toBe('12');
  });
});
