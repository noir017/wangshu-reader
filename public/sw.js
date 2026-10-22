// 望舒（Wangshu Reader）的 service worker（MISC-008）：离线打开应用壳 + PWA「分享目标」接收文件。
// 只在 http(s) 部署时由 src/library/pwa.ts 注册；file:// 单文件版不注册。
// 缓存策略：
//  - /api、/dav、/transfer 一律不拦截（数据永远走网络，鉴权与 CORS 由服务端处理）
//  - 页面导航：网络优先，断网时回退到缓存的 index.html（IndexedDB 里的书照常能读）
//  - assets/、icons/（文件名带 hash，内容不变）：缓存优先
//  - 其余同源 GET（manifest 等）：网络优先，失败回退缓存
// 改名为望舒时升到 v2：activate 会删掉旧的 mr-v1-shell（里面是旧品牌的 index.html/manifest）
const VERSION = 'mr-v2';
const SHELL = `${VERSION}-shell`;
const SHARE = 'mr-share';
const SCOPE = new URL(self.registration.scope);

/** 请求路径相对 service worker 作用域的部分 */
const rel = (url) => decodeURIComponent(new URL(url).pathname.slice(SCOPE.pathname.length));

self.addEventListener('install', (e) => {
  // 预缓存应用壳；失败（例如离线安装）不阻塞安装
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icons/icon-192.png']))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('mr-v') && k !== SHELL) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

// 页面把本次加载用到的资源地址发过来，补进缓存（首次访问时页面还没被 SW 控制，这些请求没经过 fetch 事件）
self.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.type !== 'cache-urls' || !Array.isArray(d.urls)) return;
  e.waitUntil(
    caches.open(SHELL).then(async (c) => {
      for (const u of d.urls) {
        try {
          const url = new URL(u, SCOPE);
          if (url.origin !== SCOPE.origin || !/^(assets|icons)\//.test(rel(url.href))) continue;
          if (!(await c.match(url.href))) await c.add(url.href);
        } catch {
          /* 单个失败忽略 */
        }
      }
    }),
  );
});

async function networkFirst(req, fallbackUrl) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(fallbackUrl ?? req, res.clone()).catch(() => undefined);
    return res;
  } catch (err) {
    const hit = (await cache.match(fallbackUrl ?? req)) ?? (await cache.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => undefined);
  return res;
}

/** 分享目标（manifest.share_target，POST multipart）：把收到的文件存进 Cache，再重定向回应用，由应用导入 */
async function handleShare(req) {
  try {
    const form = await req.formData();
    const cache = await caches.open(SHARE);
    for (const k of await cache.keys()) await cache.delete(k); // 只保留最近一次分享
    let n = 0;
    for (const f of form.getAll('files')) {
      if (!(f instanceof File) || f.size === 0) continue;
      const headers = new Headers({ 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name), 'X-File-Time': String(f.lastModified || Date.now()) });
      await cache.put(new Request(new URL(`__shared__/${Date.now()}-${n++}`, SCOPE).href), new Response(f, { headers }));
    }
    if (n > 0) return Response.redirect(new URL('./?shared=1#/shelf', SCOPE).href, 303);
    // 没有文件：文本或链接分享 → 交给应用的「从链接下载」（?open=）
    const text = [form.get('url'), form.get('text'), form.get('title')].map((x) => (typeof x === 'string' ? x : '')).join(' ');
    const link = /https?:\/\/[^\s<>"']+/i.exec(text)?.[0];
    return Response.redirect(link ? new URL(`./?open=${encodeURIComponent(link)}#/net`, SCOPE).href : new URL('./#/shelf', SCOPE).href, 303);
  } catch {
    return Response.redirect(new URL('./#/shelf', SCOPE).href, 303);
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin) return;
  const path = rel(req.url);
  if (req.method === 'POST' && path === 'share-target') {
    e.respondWith(handleShare(req));
    return;
  }
  if (req.method !== 'GET') return;
  if (/^(api|dav|transfer)(\/|$)/.test(path)) return;
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, new URL('./index.html', SCOPE).href));
    return;
  }
  if (/^(assets|icons)\//.test(path)) {
    e.respondWith(cacheFirst(req));
    return;
  }
  if (path === 'manifest.webmanifest' || path === 'index.html') e.respondWith(networkFirst(req));
});
