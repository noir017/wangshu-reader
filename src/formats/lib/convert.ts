// 服务端转换/解包客户端（FMT-014 CHM、FMT-020 RAR/7z/CBR、PDF-010 DJVU）。契约见 shared/api.ts。
// 一律经 core/server：没配置服务端 → ServerRequiredError（带中文提示）；连不上/转换失败 → 同类错误或 BookOpenError('server')。
import { ARCHIVE_EXTRACT_PATH, ARCHIVE_LIST_PATH, CONVERT_PATH, type ArchiveListResponse, type HealthResponse, type ServerFeature } from '@shared/api';
import { ServerUnavailableError, apiFetch, apiJson, hasServer } from '@/core/server';
import { BookOpenError, ServerRequiredError, fmtMsg } from '../errors';

export type ConvertTarget = 'cbz' | 'epub' | 'pdf';

/** 服务端接口只要纯文件名（不含目录、不含压缩包内路径） */
function plainName(fileName: string): string {
  const n = (fileName.split('?')[0] ?? fileName).split(/[\\/]/).pop() ?? fileName;
  return n || 'file';
}

function fail(label: string, e: unknown): never {
  if (e instanceof BookOpenError) throw e;
  if (e instanceof ServerUnavailableError) throw new ServerRequiredError(label, e.message, e);
  if ((e as { name?: string })?.name === 'AbortError') throw e;
  const why = e instanceof Error ? e.message : String(e);
  throw new BookOpenError('server', fmtMsg('serverFail', { why }), { cause: e });
}

/** 查服务端能力开关；服务端不可达或老版本不报能力时返回 undefined（调用方继续尝试，让真实请求给出错误） */
export async function serverFeature(feature: ServerFeature): Promise<boolean | undefined> {
  if (!hasServer()) return undefined;
  try {
    const h = await apiJson<HealthResponse>('/api/health');
    return h.features ? Boolean(h.features[feature]) : undefined;
  } catch {
    return undefined;
  }
}

/** 同一个 Blob 同一种转换只做一次（导入时 probe 完马上 open 不用再传一遍） */
const cache = new WeakMap<Blob, Map<string, Promise<Blob>>>();

export interface ConvertOptions {
  /** 用于提示的格式名，如 'CHM' */
  label: string;
  /** 需要的服务端能力（djvu 要 djvulibre），health 明确报告没有时直接给出清晰提示 */
  feature?: ServerFeature;
  signal?: AbortSignal;
}

/** POST /api/convert?to=…&name=…（cbr/cb7/rar/7z → cbz，chm → epub，djvu → pdf） */
export async function convertViaServer(file: Blob, fileName: string, to: ConvertTarget, o: ConvertOptions): Promise<Blob> {
  if (!hasServer()) throw new ServerRequiredError(o.label);
  const key = `${to}:${plainName(fileName)}`;
  let per = cache.get(file);
  if (!per) cache.set(file, (per = new Map()));
  const hit = per.get(key);
  if (hit) return hit;
  const job = (async () => {
    try {
      if (o.feature && (await serverFeature(o.feature)) === false) {
        throw new ServerRequiredError(o.label, fmtMsg('serverFeature', { feature: o.feature, why: '服务端缺少所需的外部程序' }));
      }
      const res = await apiFetch(`${CONVERT_PATH}?to=${to}&name=${encodeURIComponent(plainName(fileName))}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
        signal: o.signal,
      });
      return await res.blob();
    } catch (e) {
      return fail(o.label, e);
    }
  })();
  per.set(key, job);
  job.catch(() => per!.delete(key));
  return job;
}

/** POST /api/archive/list?name=… */
export async function listArchiveViaServer(file: Blob, fileName: string, label: string, signal?: AbortSignal): Promise<ArchiveListResponse['entries']> {
  if (!hasServer()) throw new ServerRequiredError(label);
  try {
    const res = await apiFetch(`${ARCHIVE_LIST_PATH}?name=${encodeURIComponent(plainName(fileName))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
      signal,
    });
    return ((await res.json()) as ArchiveListResponse).entries ?? [];
  } catch (e) {
    return fail(label, e);
  }
}

/** POST /api/archive/extract?name=…&entry=… */
export async function extractArchiveEntryViaServer(file: Blob, fileName: string, entry: string, label: string, signal?: AbortSignal): Promise<Blob> {
  if (!hasServer()) throw new ServerRequiredError(label);
  try {
    const res = await apiFetch(`${ARCHIVE_EXTRACT_PATH}?name=${encodeURIComponent(plainName(fileName))}&entry=${encodeURIComponent(entry)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
      signal,
    });
    return await res.blob();
  } catch (e) {
    return fail(label, e);
  }
}
