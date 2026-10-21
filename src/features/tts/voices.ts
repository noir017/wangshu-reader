// 选声音（TTS-014）：按书籍语言/文字自动匹配，用户也可手选。纯逻辑，方便测试。

export interface VoiceLike {
  voiceURI: string;
  name: string;
  lang: string;
  default?: boolean;
  localService?: boolean;
}

const primary = (lang: string) => lang.toLowerCase().split(/[-_]/)[0];

/** 书籍语言（BCP47）或文字样本 → 期望的语言码；样本含 CJK 假名/谚文/汉字时优先判断 */
export function guessLang(bookLang: string | undefined, sample: string, fallback = 'en'): string {
  if (bookLang) return bookLang;
  if (/[぀-ヿ]/.test(sample)) return 'ja';
  if (/[가-힯]/.test(sample)) return 'ko';
  if (/[㐀-鿿]/.test(sample)) return 'zh';
  return fallback;
}

/** wantURI 优先；否则语言完全匹配 > 主语言匹配，同级优先本地声音/默认声音 */
export function pickVoice<T extends VoiceLike>(voices: T[], wantURI: string, lang: string): T | undefined {
  if (wantURI) {
    const exact = voices.find((v) => v.voiceURI === wantURI);
    if (exact) return exact;
  }
  const want = lang.toLowerCase().replace('_', '-');
  const p = primary(want);
  const score = (v: T): number => {
    const vl = v.lang.toLowerCase().replace('_', '-');
    let s = 0;
    if (vl === want) s += 100;
    else if (primary(vl) === p) s += 50;
    else return -1;
    if (v.default) s += 5;
    if (v.localService) s += 3;
    return s;
  };
  let best: T | undefined;
  let bestScore = -1;
  for (const v of voices) {
    const sc = score(v);
    if (sc > bestScore) {
      best = v;
      bestScore = sc;
    }
  }
  return best;
}

/** 声音下拉的分组标签：中文/英文… + 名称 */
export function voiceLabel(v: VoiceLike): string {
  return `${v.name} (${v.lang})`;
}
