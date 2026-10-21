export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 2026-05-01 10:20 */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 0..1 → "12.3%" */
export function percentStr(p: number | undefined): string {
  if (p === undefined || !Number.isFinite(p)) return '';
  return `${(Math.max(0, Math.min(1, p)) * 100).toFixed(1)}%`;
}

/** 秒 → mm:ss（≥1 小时 h:mm:ss） */
export function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`;
}

export function isCjkText(s: string, sample = 200): boolean {
  const t = s.slice(0, sample);
  if (!t) return false;
  let n = 0;
  for (const ch of t) if (/[぀-ヿ㐀-鿿豈-﫿가-힯]/.test(ch)) n++;
  return n / t.length > 0.2;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 是否手机尺寸（原 app 按平板/手机取不同摘要长度、字号） */
export function isTabletViewport(): boolean {
  return Math.min(globalThis.screen?.width ?? 400, globalThis.screen?.height ?? 800) >= 600;
}
