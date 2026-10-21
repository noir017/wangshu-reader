// 词典来源表（DICT-002）：原版靠 Android Intent 调外部词典 App，web 上改成两类——
//  ① URL 模板（在新标签打开，%s = 查询词，<SL>/<TL> = 翻译源/目标语言，<lang> = 书籍/界面语言）
//  ② 服务端 /api/dict 内联卡片（id = 'inline'，需要服务端的 dict 能力）
// 'translate' = 翻译（服务端 /api/translate 内联译文，不可用时退回打开翻译网站）。

export interface DictSource {
  id: string;
  name: string;
  nameEn?: string;
  kind: 'url' | 'inline' | 'translate' | 'custom';
  url?: string;
  /** 适合的语言：zh = 中文词典，en = 英文词典，any = 通用 */
  scope: 'zh' | 'en' | 'any';
}

export const TRANSLATION_URL = 'https://translate.google.com/?sl=<SL>&tl=<TL>&text=%s&op=translate';

export const DICT_SOURCES: DictSource[] = [
  { id: 'inline', name: '内置词典（服务端）', nameEn: 'Built-in (server)', kind: 'inline', scope: 'any' },
  { id: 'translate', name: '翻译', nameEn: 'Translate', kind: 'translate', scope: 'any' },
  { id: 'youdao', name: '有道词典', nameEn: 'Youdao', kind: 'url', url: 'https://dict.youdao.com/result?word=%s&lang=en', scope: 'zh' },
  { id: 'baidu', name: '百度在线词典', nameEn: 'Baidu Dict', kind: 'url', url: 'https://dict.baidu.com/s?wd=%s&ie=utf-8', scope: 'zh' },
  { id: 'dictcn', name: '海词在线词典', nameEn: 'Dict.cn', kind: 'url', url: 'https://dict.cn/search?q=%s', scope: 'zh' },
  { id: 'zdic', name: '汉典', nameEn: 'Zdic', kind: 'url', url: 'https://www.zdic.net/hans/%s', scope: 'zh' },
  { id: 'bing', name: '必应词典', nameEn: 'Bing Dict', kind: 'url', url: 'https://cn.bing.com/dict/search?q=%s', scope: 'any' },
  { id: 'dictionary', name: 'Dictionary.com', kind: 'url', url: 'https://www.dictionary.com/browse/%s', scope: 'en' },
  { id: 'merriam', name: 'Merriam-Webster', kind: 'url', url: 'https://www.merriam-webster.com/dictionary/%s', scope: 'en' },
  { id: 'oxford', name: "Oxford Learner's", kind: 'url', url: 'https://www.oxfordlearnersdictionaries.com/search/english/?q=%s', scope: 'en' },
  { id: 'cambridge', name: 'Cambridge', kind: 'url', url: 'https://dictionary.cambridge.org/search/english/direct/?q=%s', scope: 'en' },
  { id: 'freedict', name: 'TheFreeDictionary', kind: 'url', url: 'https://www.thefreedictionary.com/%s', scope: 'en' },
  { id: 'wiktionary', name: '维基词典', nameEn: 'Wiktionary', kind: 'url', url: 'https://<lang>.wiktionary.org/wiki/%s', scope: 'any' },
  { id: 'wikipedia', name: '维基百科', nameEn: 'Wikipedia', kind: 'url', url: 'https://<lang>.wikipedia.org/wiki/%s', scope: 'any' },
  { id: 'custom', name: '自定义在线词典...', nameEn: 'Custom online dictionary...', kind: 'custom', scope: 'any' },
];

export const DEFAULT_CUSTOM_URL = 'https://www.yourdictionary.com/%s';

export function sourceById(id: string): DictSource | undefined {
  return DICT_SOURCES.find((s) => s.id === id);
}

/** 网络搜索 URL（ANNO-012）：中文界面用百度，其他用 Google */
export function webSearchUrl(zhUi: boolean): string {
  return zhUi ? 'https://www.baidu.com/s?wd=%s&ie=utf-8' : 'https://www.google.com/search?q=%s';
}

/** 书籍语言/界面语言 → 维基子域（zh-CN → zh，缺省 en） */
export function wikiLang(bookLang: string | undefined, uiLang: string): string {
  const l = (bookLang || uiLang || 'en').toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(l) ? l : 'en';
}

export interface UrlVars {
  word: string;
  sl?: string;
  tl?: string;
  lang?: string;
}

/** 填充模板。%s 一律 encodeURIComponent（原版 Uri.encode） */
export function fillUrl(template: string, v: UrlVars): string {
  return template
    .replace(/<SL>/g, encodeURIComponent(v.sl ?? 'auto'))
    .replace(/<TL>/g, encodeURIComponent(v.tl ?? 'en'))
    .replace(/<lang>/g, encodeURIComponent(v.lang ?? 'en'))
    .replace(/%s/g, encodeURIComponent(v.word));
}

/** 只放行 http(s)，避免自定义模板里被塞 javascript: 之类 */
export function isSafeHttpUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 没有服务端时 inline 不可用，退回第一个按语言合适的 URL 词典 */
export function fallbackUrlSource(zhUi: boolean): DictSource {
  return sourceById(zhUi ? 'youdao' : 'dictionary')!;
}

export interface TranslateLang {
  code: string;
  zh: string;
  en: string;
}

/** 翻译语言（首项 auto，原版 R.array.translations） */
export const TRANSLATE_LANGS: TranslateLang[] = [
  { code: 'auto', zh: '自动检测', en: 'Auto detect' },
  { code: 'zh-CN', zh: '中文（简体）', en: 'Chinese (Simplified)' },
  { code: 'zh-TW', zh: '中文（繁体）', en: 'Chinese (Traditional)' },
  { code: 'en', zh: '英语', en: 'English' },
  { code: 'ja', zh: '日语', en: 'Japanese' },
  { code: 'ko', zh: '韩语', en: 'Korean' },
  { code: 'fr', zh: '法语', en: 'French' },
  { code: 'de', zh: '德语', en: 'German' },
  { code: 'es', zh: '西班牙语', en: 'Spanish' },
  { code: 'pt', zh: '葡萄牙语', en: 'Portuguese' },
  { code: 'it', zh: '意大利语', en: 'Italian' },
  { code: 'ru', zh: '俄语', en: 'Russian' },
  { code: 'ar', zh: '阿拉伯语', en: 'Arabic' },
  { code: 'hi', zh: '印地语', en: 'Hindi' },
  { code: 'th', zh: '泰语', en: 'Thai' },
  { code: 'vi', zh: '越南语', en: 'Vietnamese' },
  { code: 'id', zh: '印尼语', en: 'Indonesian' },
  { code: 'tr', zh: '土耳其语', en: 'Turkish' },
  { code: 'nl', zh: '荷兰语', en: 'Dutch' },
  { code: 'pl', zh: '波兰语', en: 'Polish' },
  { code: 'uk', zh: '乌克兰语', en: 'Ukrainian' },
  { code: 'sv', zh: '瑞典语', en: 'Swedish' },
  { code: 'el', zh: '希腊语', en: 'Greek' },
  { code: 'he', zh: '希伯来语', en: 'Hebrew' },
  { code: 'la', zh: '拉丁语', en: 'Latin' },
];

export function defaultDestLang(uiLang: 'zh' | 'en'): string {
  return uiLang === 'zh' ? 'zh-CN' : 'en';
}

/** 翻译网站 URL（服务端翻译不可用时的退路） */
export function translateUrl(text: string, sl: string, tl: string): string {
  return fillUrl(TRANSLATION_URL, { word: text, sl, tl });
}

/** 打开翻译网站：open 由调用方注入（带弹窗拦截提示） */
export function openTranslateSiteUrl(text: string, sl: string, tl: string, open: (url: string) => boolean): boolean {
  return open(translateUrl(text, sl, tl));
}
