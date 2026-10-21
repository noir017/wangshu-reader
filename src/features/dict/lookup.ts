// 查词 / 翻译的触发逻辑（DICT-001/004/005/006）。UI 卡片见 LookupCard.tsx。
import { create } from 'zustand';
import { appSettings } from '@/core/app-settings';
import type { TextRange } from '@/core/book';
import type { ReaderSession } from '@/core/reader-session';
import { toast } from '@/ui';
import { getSectionText } from '../common/section-text';
import { addDictHistory } from './history';
import { td } from './messages';
import { dictSettings } from './settings';
import { fallbackUrlSource, fillUrl, isSafeHttpUrl, openTranslateSiteUrl, sourceById, webSearchUrl, wikiLang } from './sources';
import { hasServer } from '@/core/server';

export interface LookupRequest {
  mode: 'dict' | 'translate';
  text: string;
  rect?: DOMRect;
  /** 内置词典卡片临时指定的来源 */
  sourceId?: string;
  bookLang?: string;
}

interface CardState {
  req: LookupRequest | null;
}

export const useLookupCard = create<CardState>(() => ({ req: null }));

export function closeLookupCard(): void {
  useLookupCard.setState({ req: null });
}

export function openLookupCard(req: LookupRequest): void {
  useLookupCard.setState({ req });
}

/** 去掉首尾空白/标点，压缩内部空白（查词用） */
export function cleanLookupText(s: string): string {
  return s.replace(/[\s　]+/g, ' ').trim();
}

/** 新标签打开；被拦截时提示。必须在用户手势里同步调用 */
export function openUrl(url: string): boolean {
  if (!isSafeHttpUrl(url)) return false;
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (!w) toast(td('popupBlocked'));
  return true;
}

function uiLang(): 'zh' | 'en' {
  return appSettings.get().language;
}

/** 在选区前后各取一小段，记进生词本作上下文 */
async function contextOf(session: ReaderSession, range: TextRange | undefined): Promise<string | undefined> {
  if (!range) return undefined;
  try {
    const t = await getSectionText(session.controller, range.section);
    return t.slice(Math.max(0, range.start - 40), range.end + 40).replace(/\s+/g, ' ').trim();
  } catch {
    return undefined;
  }
}

/** 词典按钮：second=true 为长按（词典 2） */
export function lookupWord(session: ReaderSession, text: string, opts: { second?: boolean; rect?: DOMRect; range?: TextRange } = {}): void {
  const word = cleanLookupText(text);
  if (!word) {
    toast(td('needText'));
    return;
  }
  void contextOf(session, opts.range).then((context) => addDictHistory({ word, book: session.record.title, context }));
  const s = dictSettings.get();
  const id = opts.second ? s.dict2 : s.dict1;
  const src = sourceById(id) ?? sourceById('inline')!;
  const bookLang = session.book.metadata.language;
  switch (src.kind) {
    case 'translate':
      translateSelection(session, word, opts.rect);
      return;
    case 'inline':
      openLookupCard({ mode: 'dict', text: word, rect: opts.rect, bookLang });
      return;
    case 'custom': {
      const tpl = s.myDictUrl || '';
      if (!tpl.includes('%s') || !openUrl(fillUrl(tpl, { word }))) toast(td('customUrlInvalid'));
      return;
    }
    default:
      openUrl(fillUrl(src.url!, { word, lang: wikiLang(bookLang, uiLang()), sl: s.sourceLanguage, tl: s.destLanguage }));
  }
}

/** 翻译按钮：有服务端先出内联卡片；没有服务端直接开翻译网站（和原版一致） */
export function translateSelection(session: ReaderSession, text: string, rect?: DOMRect): void {
  const t = cleanLookupText(text);
  if (!t) {
    toast(td('needText'));
    return;
  }
  const s = dictSettings.get();
  if (!hasServer()) {
    openTranslateSiteUrl(t, s.sourceLanguage, s.destLanguage, openUrl);
    return;
  }
  openLookupCard({ mode: 'translate', text: t, rect, bookLang: session.book.metadata.language });
}

/** 维基百科（按书语言选子域，缺省界面语言） */
export function openWikipedia(session: ReaderSession, text: string): void {
  const word = cleanLookupText(text);
  if (!word) return;
  openUrl(fillUrl(sourceById('wikipedia')!.url!, { word, lang: wikiLang(session.book.metadata.language, uiLang()) }));
}

/** 网络搜索：中文界面用百度，其他用 Google（ANNO-012） */
export function openWebSearch(text: string): void {
  const word = cleanLookupText(text);
  if (!word) return;
  openUrl(fillUrl(webSearchUrl(uiLang() === 'zh'), { word }));
}

/** 没有服务端时，内联词典的 URL 退路 */
export function fallbackSources(): { id: string; name: string; url: string }[] {
  const zh = uiLang() === 'zh';
  const first = fallbackUrlSource(zh);
  const ids = zh ? ['youdao', 'baidu', 'bing', 'wiktionary'] : ['dictionary', 'merriam', 'oxford', 'cambridge'];
  return [first.id, ...ids]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((id) => sourceById(id)!)
    .map((s) => ({ id: s.id, name: zh ? s.name : (s.nameEn ?? s.name), url: s.url! }));
}
