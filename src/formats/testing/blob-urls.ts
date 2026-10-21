// 测试用：URL.createObjectURL 在测试环境里取不回内容，自己记一份；每个用例结束还原
import { afterEach, beforeEach, vi } from 'vitest';

export function useBlobUrls() {
  const made = new Map<string, Blob>();
  const revoked: string[] = [];
  let n = 0;
  beforeEach(() => {
    made.clear();
    revoked.length = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
      const u = `blob:test/${++n}`;
      made.set(u, b as Blob);
      return u;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => void revoked.push(u));
  });
  afterEach(() => vi.restoreAllMocks());
  return { made, revoked };
}
