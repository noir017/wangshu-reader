// 显示用的格式化函数
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const p2 = (n: number) => String(n).padStart(2, '0');

export function formatDate(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export function formatDateTime(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${formatDate(ms)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** 毫秒 → 小时（两位小数） */
export function formatHours(ms: number): string {
  return (ms / 3_600_000).toFixed(2);
}

/** 毫秒 → 「1小时05分」/「5分钟」 */
export function formatInterval(ms: number, zh = true): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return zh ? `${m}分钟` : `${m} min`;
  return zh ? `${Math.floor(m / 60)}小时${p2(m % 60)}分` : `${Math.floor(m / 60)}h ${p2(m % 60)}m`;
}

export function formatPercent(progress: number | undefined): string {
  if (progress === undefined) return '0%';
  const v = progress * 100;
  return `${v >= 99.95 ? 100 : v < 10 ? v.toFixed(1) : Math.floor(v)}%`;
}

/** 文件名安全化：去掉路径分隔与控制字符，限长（下载保存名用） */
export function safeFileName(name: string, max = 100): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max).trim() : s;
}

export function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
