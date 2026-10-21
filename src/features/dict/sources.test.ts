import { describe, expect, it } from 'vitest';
import { DICT_SOURCES, fillUrl, isSafeHttpUrl, sourceById, translateUrl, webSearchUrl, wikiLang } from './sources';

describe('词典来源', () => {
  it('%s 编码，<SL>/<TL>/<lang> 替换', () => {
    expect(fillUrl('https://x/?q=%s', { word: 'a b&c' })).toBe('https://x/?q=a%20b%26c');
    expect(fillUrl('https://<lang>.wikipedia.org/wiki/%s', { word: '静读', lang: 'zh' })).toBe('https://zh.wikipedia.org/wiki/%E9%9D%99%E8%AF%BB');
    expect(translateUrl('hello', 'auto', 'zh-CN')).toBe('https://translate.google.com/?sl=auto&tl=zh-CN&text=hello&op=translate');
  });
  it('每个 URL 词典都有 %s，且都是 https', () => {
    for (const s of DICT_SOURCES.filter((x) => x.kind === 'url')) {
      expect(s.url, s.id).toContain('%s');
      expect(isSafeHttpUrl(fillUrl(s.url!, { word: 'x' })), s.id).toBe(true);
      expect(s.url!.startsWith('https://'), s.id).toBe(true);
    }
    expect(new Set(DICT_SOURCES.map((s) => s.id)).size).toBe(DICT_SOURCES.length);
    expect(sourceById('custom')?.kind).toBe('custom');
  });
  it('只放行 http(s)', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,hi')).toBe(false);
    expect(isSafeHttpUrl('not a url')).toBe(false);
    expect(isSafeHttpUrl('http://a.b/c')).toBe(true);
  });
  it('网络搜索与维基语言', () => {
    expect(webSearchUrl(true)).toContain('baidu.com');
    expect(webSearchUrl(false)).toContain('google.com');
    expect(wikiLang('zh-CN', 'en')).toBe('zh');
    expect(wikiLang(undefined, 'en')).toBe('en');
    expect(wikiLang('', 'zh')).toBe('zh');
    expect(wikiLang('x-klingon-1234', 'en')).toBe('en');
  });
});
