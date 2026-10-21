// 翻译（DICT-004）：优先服务端 /api/translate；服务端不可用时退回打开翻译网站。
import type { TranslateRequest, TranslateResponse } from '@shared/api';
import { apiJson, apiPostJson, hasServer, ServerUnavailableError } from '@/core/server';
import { hasServerFeature } from '../common/server-features';
import { isSafeHttpUrl, translateUrl } from './sources';

export type TranslateOutcome =
  | { ok: true; text: string; provider: string; detectedFrom?: string }
  | { ok: false; reason: 'no-server' | 'error'; message: string };

export async function translateText(req: TranslateRequest): Promise<TranslateOutcome> {
  if (!hasServer()) return { ok: false, reason: 'no-server', message: '未配置服务端' };
  try {
    if (!(await hasServerFeature('translate'))) return { ok: false, reason: 'no-server', message: '服务端未启用翻译' };
    const r = await apiPostJson<TranslateResponse>('/api/translate', req);
    return { ok: true, text: r.text, provider: r.provider, detectedFrom: r.detectedFrom };
  } catch (e) {
    return { ok: false, reason: e instanceof ServerUnavailableError ? 'no-server' : 'error', message: (e as Error).message };
  }
}

export async function listTranslateProviders(): Promise<{ id: string; name: string }[]> {
  try {
    return (await apiJson<{ providers: { id: string; name: string }[] }>('/api/translate/providers')).providers ?? [];
  } catch {
    return [];
  }
}

/** 打开翻译网站（浏览器弹窗拦截：必须在用户手势内同步调用） */
export function openTranslateSite(text: string, sl: string, tl: string): void {
  const url = translateUrl(text, sl, tl);
  if (isSafeHttpUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
}
