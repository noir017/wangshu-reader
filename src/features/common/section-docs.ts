// 章节文档：脚注锚点定位、点选取词/拖手柄反查字符偏移、看图器取图列表时用。
// 来源有两个：① 引擎的 sectionReady 事件（features 先于 open() 挂载时能收全）；
//            ② 引擎的 getSectionDocument——阅读页若在 open() 之后才挂 features，开头几章的 sectionReady 已经错过，靠这个补。
import type { ReaderController } from '@/core/reader';
import { sectionCount } from './section-text';

const docs = new Map<number, Document>();

export function rememberSectionDoc(section: number, doc: Document): void {
  docs.delete(section);
  docs.set(section, doc);
  if (docs.size > 8) docs.delete(docs.keys().next().value as number);
}

let source: ReaderController | null = null;

/** 阅读会话挂载时设置、卸载时传 null */
export function setSectionDocSource(c: ReaderController | null): void {
  source = c;
}

/** 引擎当前在渲染的章节文档（按 Map 查，不触发加载） */
function scanFrames(): { section: number; doc: Document }[] {
  const out: { section: number; doc: Document }[] = [];
  if (!source) return out;
  for (let s = 0, n = sectionCount(source); s < n; s++) {
    const doc = source.getSectionDocument(s);
    if (doc?.body) out.push({ section: s, doc });
  }
  return out;
}

/** 注册表里的文档可能已随章节卸载而失效（iframe 被移除）：用 isConnected 过滤 */
function alive(doc: Document): boolean {
  const f = doc.defaultView?.frameElement;
  return !f || f.isConnected;
}

export function getSectionDoc(section: number): Document | undefined {
  const hit = docs.get(section);
  if (hit && alive(hit)) return hit;
  const doc = source?.getSectionDocument(section) ?? undefined;
  if (doc?.body) rememberSectionDoc(section, doc);
  return doc?.body ? doc : undefined;
}

/** 新近的在前 */
export function recentSectionDocs(): { section: number; doc: Document }[] {
  const out = [...docs.entries()].reverse().filter(([, doc]) => alive(doc)).map(([section, doc]) => ({ section, doc }));
  for (const f of scanFrames()) if (!out.some((o) => o.section === f.section)) out.push(f);
  return out;
}

export function clearSectionDocs(): void {
  docs.clear();
}
