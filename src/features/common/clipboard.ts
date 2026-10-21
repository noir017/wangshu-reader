import { formatPdfCopyText } from './pdf-text';

// 复制 / 分享 / 下载：能用的浏览器 API 不同，逐级降级。

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 非安全上下文或权限被拒：走下面的 execCommand */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/** Web Share API 分享文字；不支持时复制到剪贴板 */
export async function shareText(text: string, title?: string): Promise<ShareResult> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text, title });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
    }
  }
  return (await copyText(text)) ? 'copied' : 'failed';
}

/** 能分享文件时分享，否则返回 false（调用方改为下载） */
export async function shareFile(file: File, title?: string): Promise<boolean> {
  try {
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return true;
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return true;
  }
  return false;
}

/** 选中文字的统一整理：U+3000 → 空格并去首尾空白（ANNO-003） */
export function normalizeSelectedText(s: string): string {
  return s.replace(/　/g, ' ').trim();
}

/** 选中文字交给各个动作（拷贝/分享/词典…）前的整理：固定版式（PDF）先去排版换行，再统一空白（原 getSelectedWord） */
export function selectedWordOf(kind: 'reflowable' | 'fixed', raw: string): string {
  return normalizeSelectedText(kind === 'fixed' ? formatPdfCopyText(raw) : raw);
}
