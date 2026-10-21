// 开发用的书库占位：阅读页只用到书库模块的这几个出口。书库模块施工期间文件可能不全，开发服务器把 `@/library` 指到这里，
// 让阅读页的集成冒烟不被别的模块的进度拖住（正式构建与 vitest 不使用）。
export function openBookInfo(bookId: string): void {
  console.info('[dev] openBookInfo', bookId);
}

/** 开发页：用 sessionStorage 里的 mrdev.adjacent（JSON：{prev?: id, next?: id}）模拟书架相邻书 */
export async function getAdjacentBook(_bookId: string, dir: 1 | -1): Promise<string | null> {
  try {
    const m = JSON.parse(sessionStorage.getItem('mrdev.adjacent') ?? '{}') as { prev?: string; next?: string };
    return (dir === 1 ? m.next : m.prev) ?? null;
  } catch {
    return null;
  }
}

export async function syncToCloud(bookId: string): Promise<void> {
  console.info('[dev] syncToCloud', bookId);
}

export async function syncFromCloud(bookId: string): Promise<void> {
  console.info('[dev] syncFromCloud', bookId);
}
