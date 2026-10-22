// 服务端能力探测：/api/health 的 features 决定朗读/词典/翻译是否可用（不可用时只隐藏/置灰，不报错）。
import type { HealthResponse, ServerFeature } from '@shared/api';
import { apiJson, hasServer, serverBase, serverToken } from '@/core/server';

let cache: { base: string; at: number; features: Partial<Record<ServerFeature, boolean>> } | undefined;
let inflight: Promise<Partial<Record<ServerFeature, boolean>>> | undefined;

export async function serverFeatures(force = false): Promise<Partial<Record<ServerFeature, boolean>>> {
  if (!hasServer()) return {};
  const base = serverBase();
  if (!force && cache && cache.base === base && Date.now() - cache.at < 30_000) return cache.features;
  inflight ??= apiJson<HealthResponse>('/api/health')
    .then((h) => h.features ?? {})
    .catch(() => ({}) as Partial<Record<ServerFeature, boolean>>)
    .then((features) => {
      cache = { base, at: Date.now(), features };
      return features;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

export async function hasServerFeature(f: ServerFeature): Promise<boolean> {
  return !!(await serverFeatures())[f];
}

/** 服务端直链（<audio>/<a> 用）：相对路径补上服务端地址，开了鉴权的带 ?token= */
export function serverUrl(pathOrUrl: string): string {
  if (/^https?:/i.test(pathOrUrl)) return pathOrUrl;
  const token = serverToken();
  const url = serverBase() + pathOrUrl;
  return token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url;
}
