import { describe, expect, it } from 'vitest';
import { guessLang, pickVoice, type VoiceLike } from './voices';

const voices: VoiceLike[] = [
  { voiceURI: 'en-us', name: 'US', lang: 'en-US' },
  { voiceURI: 'en-gb', name: 'GB', lang: 'en-GB', default: true },
  { voiceURI: 'zh-cn', name: 'Xiaoxiao', lang: 'zh-CN', localService: true },
  { voiceURI: 'zh-tw', name: 'Hanhan', lang: 'zh_TW' },
  { voiceURI: 'ja', name: 'Kyoko', lang: 'ja-JP' },
];

describe('声音选择', () => {
  it('用户手选的优先', () => {
    expect(pickVoice(voices, 'ja', 'en')?.voiceURI).toBe('ja');
  });
  it('语言完全匹配 > 主语言匹配；同级优先默认/本地', () => {
    expect(pickVoice(voices, '', 'zh-TW')?.voiceURI).toBe('zh-tw');
    expect(pickVoice(voices, '', 'zh-HK')?.voiceURI).toBe('zh-cn'); // 主语言匹配，本地声音加分
    expect(pickVoice(voices, '', 'en-AU')?.voiceURI).toBe('en-gb'); // 默认声音加分
    expect(pickVoice(voices, '', 'en-US')?.voiceURI).toBe('en-us');
  });
  it('没有可用声音返回 undefined（交给引擎默认）', () => {
    expect(pickVoice(voices, '', 'fr')).toBeUndefined();
    expect(pickVoice([], '', 'en')).toBeUndefined();
    expect(pickVoice(voices, 'gone', 'ja')?.voiceURI).toBe('ja');
  });
  it('猜语言：书籍语言优先，否则看文字', () => {
    expect(guessLang('fr', '你好')).toBe('fr');
    expect(guessLang(undefined, 'こんにちは世界')).toBe('ja');
    expect(guessLang(undefined, '안녕하세요')).toBe('ko');
    expect(guessLang(undefined, '你好世界')).toBe('zh');
    expect(guessLang(undefined, 'Hello')).toBe('en');
  });
});
