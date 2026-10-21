// 引擎在 open() 之前（features 先于 open 挂载）部分查询接口可能还不能用：这里统一兜底成「没有」。
import type { ReaderController, ReaderLocation, ReaderSelection } from '@/core/reader';

export function peekSelection(c: ReaderController): ReaderSelection | null {
  try {
    return c.getSelection();
  } catch {
    return null;
  }
}

export function peekLocation(c: ReaderController): ReaderLocation | null {
  try {
    return c.getLocation();
  } catch {
    return null;
  }
}
