// 最近 sectionReady 的章节文档：脚注锚点定位、点选取词、看图器取图列表时用。
const docs = new Map<number, Document>();

export function rememberSectionDoc(section: number, doc: Document): void {
  docs.delete(section);
  docs.set(section, doc);
  if (docs.size > 8) docs.delete(docs.keys().next().value as number);
}

export function getSectionDoc(section: number): Document | undefined {
  return docs.get(section);
}

/** 新近的在前 */
export function recentSectionDocs(): { section: number; doc: Document }[] {
  return [...docs.entries()].reverse().map(([section, doc]) => ({ section, doc }));
}

export function clearSectionDocs(): void {
  docs.clear();
}
