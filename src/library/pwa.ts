// PWA（MISC-008）：注册 service worker、接收「分享目标」收到的文件。
// 只在 http(s) 部署时启用：file:// 单文件版不能注册 SW，也不去请求 manifest（否则控制台里满是 CORS 报错）；
// vite 开发服务器（import.meta.env.DEV）也不注册，免得缓存干扰热更新；Android app 也不注册（页面在 APK 里，SW 缓存会让升级后还跑旧壳）。
import { nativeHost } from '@/core/host';
import { importWithUi } from './ImportDialogs';
import { goRead } from './actions';

const SHARE_CACHE = 'mr-share';

export function pwaSupported(): boolean {
  return typeof window !== 'undefined' && !nativeHost && /^https?:$/.test(window.location.protocol) && 'serviceWorker' in navigator && !import.meta.env.DEV && __BUILD_MODE__ !== 'single';
}

/** 注册 service worker，并把本次页面加载用到的静态资源地址告诉它（首次访问时这些请求没经过 SW，补进缓存才能离线打开） */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (!pwaSupported()) return undefined;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    void navigator.serviceWorker.ready.then((r) => {
      const urls = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => u.startsWith(window.location.origin) && /\/(assets|icons)\//.test(u));
      r.active?.postMessage({ type: 'cache-urls', urls });
    });
    return reg;
  } catch {
    return undefined; // 不支持/被浏览器策略禁用：当普通网页用
  }
}

/** 分享目标：service worker 把文件存进 Cache 后重定向到 ?shared=1，这里取出来导入并清掉 */
export async function consumeSharedFiles(): Promise<boolean> {
  if (typeof window === 'undefined' || !new URLSearchParams(window.location.search).has('shared') || !('caches' in window)) return false;
  history.replaceState(null, '', window.location.pathname + window.location.hash);
  const cache = await caches.open(SHARE_CACHE);
  const reqs = await cache.keys();
  const files: File[] = [];
  for (const r of reqs) {
    const res = await cache.match(r);
    if (!res) continue;
    const name = decodeURIComponent(res.headers.get('X-File-Name') ?? 'shared');
    files.push(new File([await res.blob()], name, { type: res.headers.get('Content-Type') ?? '', lastModified: Number(res.headers.get('X-File-Time')) || Date.now() }));
    await cache.delete(r);
  }
  if (!files.length) return false;
  const res = await importWithUi(files.map((file) => ({ file })));
  const first = res.added[0] ?? res.existing[0];
  if (first && files.length === 1) goRead(first.id);
  return true;
}
