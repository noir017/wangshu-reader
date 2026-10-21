import { describe, expect, it } from 'vitest';
import { decodeAuto, decodeMarkup, detectEncoding, normalizeEncoding } from './encoding';
import { encodeLegacy, encodeUtf16, u8 } from './testing/builders';

const ZH_SIMP =
  '我在山里走了很多天，终于看到了一座小村庄。村里的人们都很和气，他们说这里已经有几百年的历史了。' +
  '老人对我说：“你是从哪里来的？”我告诉他，我从大城市来，想看看这里的风景，也想了解一下人们的生活。' +
  '那天晚上我们在一起吃饭，大家一边喝茶一边聊天，说到了很多过去的事情，还有他们对未来的想法。第二天早上天气很好，我就起身继续赶路了。';
const ZH_TRAD =
  '我在山裡走了很多天，終於看到了一座小村莊。村裡的人們都很和氣，他們說這裡已經有幾百年的歷史了。' +
  '老人對我說：「你是從哪裡來的？」我告訴他，我從大城市來，想看看這裡的風景，也想了解一下人們的生活。' +
  '那天晚上我們在一起吃飯，大家一邊喝茶一邊聊天，說到了很多過去的事情，還有他們對未來的想法。第二天早上天氣很好，我就起身繼續趕路了。';
const JA =
  '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。' +
  '吾輩はここで始めて人間というものを見た。しかもあとで聞くとそれは書生という人間中で一番獰悪な種族であったそうだ。';
const KO =
  '그는 오래된 집에서 태어났다. 어릴 때부터 책을 읽는 것을 좋아했고, 학교에서는 항상 좋은 성적을 받았다. ' +
  '그러나 가족은 가난했기 때문에 일을 해야 했다. 그는 매일 아침 일찍 일어나서 일을 하러 갔다. 하지만 그는 포기하지 않았다.';
const RU =
  'Это было давно, в одном маленьком городе на берегу большой реки. Люди там жили тихо и мирно, и каждый знал своего соседа. ' +
  'Однажды утром в город приехал незнакомый человек, и все стали говорить о том, что он ищет какую-то старую книгу.';

describe('encoding detect', () => {
  it('BOM 与纯 ASCII', () => {
    expect(detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toMatchObject({ encoding: 'utf-8', bom: 3 });
    expect(detectEncoding(encodeUtf16('abc', true, true)).encoding).toBe('utf-16le');
    expect(detectEncoding(encodeUtf16('abc', false, true)).encoding).toBe('utf-16be');
    expect(detectEncoding(u8('hello world')).encoding).toBe('utf-8');
    expect(detectEncoding(new Uint8Array()).encoding).toBe('utf-8');
  });
  it('无 BOM 的 UTF-16', () => {
    expect(detectEncoding(encodeUtf16('Hello there, this is a test of utf16 text.', true, false)).encoding).toBe('utf-16le');
    expect(detectEncoding(encodeUtf16('Hello there, this is a test of utf16 text.', false, false)).encoding).toBe('utf-16be');
  });
  it('UTF-8 中文', () => {
    expect(detectEncoding(u8(ZH_SIMP)).encoding).toBe('utf-8');
  });
  it('GBK / Big5', () => {
    expect(detectEncoding(encodeLegacy(ZH_SIMP, 'gbk')).encoding).toBe('gbk');
    expect(detectEncoding(encodeLegacy(ZH_TRAD, 'big5')).encoding).toBe('big5');
  });
  it('Shift_JIS / EUC-JP / EUC-KR', () => {
    expect(detectEncoding(encodeLegacy(JA, 'shift_jis')).encoding).toBe('shift_jis');
    expect(detectEncoding(encodeLegacy(JA, 'euc-jp')).encoding).toBe('euc-jp');
    expect(detectEncoding(encodeLegacy(KO, 'euc-kr')).encoding).toBe('euc-kr');
  });
  it('西里尔字母', () => {
    expect(detectEncoding(encodeLegacy(RU, 'windows-1251')).encoding).toBe('windows-1251');
    expect(detectEncoding(encodeLegacy(RU, 'koi8-r')).encoding).toBe('koi8-r');
  });
  it('解码往返', () => {
    expect(decodeAuto(encodeLegacy(ZH_SIMP, 'gbk')).text).toBe(ZH_SIMP);
    expect(decodeAuto(encodeLegacy(ZH_TRAD, 'big5')).text).toBe(ZH_TRAD);
    expect(decodeAuto(encodeUtf16(ZH_SIMP, true, true)).text).toBe(ZH_SIMP);
    // 强制编码优先于检测
    expect(decodeAuto(encodeLegacy(ZH_SIMP, 'gbk'), 'GB2312').text).toBe(ZH_SIMP);
  });
  it('编码名规整', () => {
    expect(normalizeEncoding('GB2312')).toBe('gbk');
    expect(normalizeEncoding('Windows-950')).toBe('big5');
    expect(normalizeEncoding('auto')).toBeNull();
    expect(normalizeEncoding('nonsense-enc')).toBeNull();
    expect(normalizeEncoding('UTF-32')).toBe('utf-32le');
  });
  it('UTF-32', () => {
    const b = new Uint8Array([0xff, 0xfe, 0, 0, 0x41, 0, 0, 0, 0x60, 0x4f, 0, 0]);
    expect(decodeAuto(b).text).toBe('A你');
  });
  it('标记语言：声明的编码', () => {
    const gbk = encodeLegacy('<?xml version="1.0" encoding="gbk"?><a>你好，世界</a>', 'gbk');
    expect(decodeMarkup(gbk).text).toContain('你好，世界');
    const html = encodeLegacy('<html><head><meta charset="windows-1251"></head><body>Привет мир</body></html>', 'windows-1251');
    expect(decodeMarkup(html).text).toContain('Привет мир');
  });
});
