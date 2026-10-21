// 章节文档：脚注锚点定位、点选取词/拖手柄反查字符偏移、看图器取图列表时用。
// 来源有两个：① 引擎的 sectionReady 事件（features 先于 open() 挂载时能收全）；
//            ② 直接扫页面里的章节 iframe（title = "section-N"，引擎与假引擎都这样标）——
//               阅读页若在 open() 之后才挂 features，开头几章的 sectionReady 已经错过，靠这个补。
// 理想做法是引擎提供 getSectionDocument(section)，见汇报。
const docs = new Map<number, Document>();

export function rememberSectionDoc(section: number, doc: Document): void {
  docs.delete(section);
  docs.set(section, doc);
  if (docs.size > 8) docs.delete(docs.keys().next().value as number);
}

/** 页面里现有的章节 iframe 文档（同源才读得到） */
function scanFrames(): { section: number; doc: Document }[] {
  const out: { section: number; doc: Document }[] = [];
  if (typeof document === 'undefined') return out;
  for (const el of Array.from(document.querySelectorAll('iframe'))) {
    const m = /^section-(\d+)$/.exec(el.title);
    if (!m) continue;
    try {
      const doc = el.contentDocument;
      if (doc?.body) out.push({ section: Number(m[1]), doc });
    } catch {
      /* 跨域 iframe */
    }
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
  const found = scanFrames().find((f) => f.section === section);
  if (found) rememberSectionDoc(section, found.doc);
  return found?.doc;
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
