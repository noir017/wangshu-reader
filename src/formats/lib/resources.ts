// 书内资源 → blob URL 的登记簿：同一资源只建一次，destroy() 统一回收。
export class ResourceStore {
  private cache = new Map<string, Promise<string | null>>();
  private urls = new Set<string>();
  private dead = false;

  /** key 相同只调用一次 make；make 返回 null 表示资源不存在 */
  url(key: string, make: () => Promise<Blob | null>): Promise<string | null> {
    let p = this.cache.get(key);
    if (!p) {
      p = (async () => {
        try {
          const blob = await make();
          if (!blob || this.dead) return null;
          return this.blobUrl(blob);
        } catch {
          return null;
        }
      })();
      this.cache.set(key, p);
    }
    return p;
  }

  blobUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    if (this.dead) {
      URL.revokeObjectURL(url);
      return url;
    }
    this.urls.add(url);
    return url;
  }

  get destroyed(): boolean {
    return this.dead;
  }

  destroy(): void {
    this.dead = true;
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls.clear();
    this.cache.clear();
  }
}

/** 小型 LRU，章节清洗结果缓存用 */
export class Lru<K, V> {
  private map = new Map<K, V>();
  constructor(private max: number) {}
  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: K, v: V): void {
    this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as K);
  }
  clear(): void {
    this.map.clear();
  }
}
