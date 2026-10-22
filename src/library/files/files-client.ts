// 服务端书库目录（/api/library/*，shared/api.ts）的客户端。服务端不可用时抛 ServerUnavailableError，由页面置灰。
import type { HealthResponse, LibraryEntry, LibraryListResponse } from '@shared/api';
import { apiFetch, apiJson, apiPostJson, hasServer, responseErrorText, serverBase, serverToken } from '@/core/server';
import { serverFetch } from '@/storage/http';

export type LibraryAvailability = { ok: true } | { ok: false; reason: 'no-server' | 'unreachable' | 'no-library'; /** 连不上时服务端/网络给的原因（如跨站请求被拒、令牌错误） */ message?: string };

export async function checkLibrary(): Promise<LibraryAvailability> {
  if (!hasServer()) return { ok: false, reason: 'no-server' };
  try {
    const h = await apiJson<HealthResponse>('/api/health');
    return h.features?.library ? { ok: true } : { ok: false, reason: 'no-library' };
  } catch (e) {
    return { ok: false, reason: 'unreachable', message: (e as Error).message };
  }
}

export const listDir = (path: string, hidden: boolean) => apiJson<LibraryListResponse>(`/api/library/list?path=${encodeURIComponent(path)}&hidden=${hidden ? 1 : 0}`);
export const searchFiles = (path: string, q: string) => apiJson<LibraryListResponse>(`/api/library/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(q)}`);
export const mkdir = (path: string) => apiPostJson<{ entry: LibraryEntry }>('/api/library/mkdir', { path });
export const renameEntry = (path: string, newName: string) => apiPostJson<{ entry: LibraryEntry }>('/api/library/rename', { path, newName });
export const copyEntries = (paths: string[], to: string) => apiPostJson<{ entries: LibraryEntry[] }>('/api/library/copy', { paths, to });
export const moveEntries = (paths: string[], to: string) => apiPostJson<{ entries: LibraryEntry[] }>('/api/library/move', { paths, to });
export const deleteEntries = (paths: string[]) => apiPostJson<{ ok: true }>('/api/library/delete', { paths });

export async function uploadFiles(path: string, files: File[]): Promise<LibraryEntry[]> {
  const fd = new FormData();
  for (const f of files) fd.append('file', f, f.name);
  const res = await apiFetch(`/api/library/upload?path=${encodeURIComponent(path)}`, { method: 'POST', body: fd });
  return ((await res.json()) as { saved: LibraryEntry[] }).saved;
}

/** <img>/<a> 直链（带 ?token=） */
function directUrl(route: string, params: Record<string, string>): string {
  const token = serverToken();
  const q = new URLSearchParams(params);
  if (token) q.set('token', token);
  return `${serverBase()}${route}?${q}`;
}
export const thumbUrl = (path: string, size = 160) => directUrl('/api/library/thumb', { path, size: String(size) });
export const fileUrl = (path: string) => directUrl('/api/library/file', { path });

/** 下载服务端文件（带进度、可取消） */
export async function downloadServerFile(path: string, name: string, opts: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {}): Promise<File> {
  const res = await serverFetch(`/api/library/file?path=${encodeURIComponent(path)}`, { signal: opts.signal });
  if (!res.ok) throw new Error(await responseErrorText(res));
  const total = Number(res.headers.get('Content-Length')) || 0;
  const chunks: BlobPart[] = [];
  let loaded = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as unknown as BlobPart);
      loaded += value.byteLength;
      opts.onProgress?.(loaded, total);
    }
  } else {
    chunks.push(await res.blob());
  }
  return new File(chunks, name, { type: res.headers.get('Content-Type') ?? '' });
}
