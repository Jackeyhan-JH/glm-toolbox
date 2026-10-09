/**
 * Service Worker（PWA 离线缓存）。
 *
 * 本文件是模板：scripts/build.mjs 在构建时扫描 dist/ 全部文件，
 * 计算每个文件的内容哈希，把预缓存清单与版本号注入后写入 dist/sw.js ——
 * 任何文件变化 → 清单变化 → 版本号变化。占位符写在字符串字面量里，
 * 未注入时本文件仍是合法 JavaScript（开发目录不注册，见 assets/js/sw-register.mjs）。
 *
 * 策略：
 *   - 导航请求（index.html）：网络优先，失败回退缓存；
 *   - 其他静态资源：缓存优先，未命中时取网络并写回缓存；
 *   - 安装时预缓存全部站点文件（含所有工具模块、vendor、词表数据）；
 *   - activate 时清理旧版本缓存；
 *   - 收到 SKIP_WAITING 消息才立即接管（配合页面上的「有新版本，点击刷新」）。
 */

/* 构建时注入：内容哈希版本号（清点清单变化即变化） */
const BUILD_VERSION = '__GLM_TOOLBOX_SW_VERSION__';

/* 构建时注入：预缓存清单（相对站点根的 URL 数组，含 index.html） */
const PRECACHE_URLS = JSON.parse('__GLM_TOOLBOX_SW_PRECACHE__');

const CACHE_PREFIX = 'glm-toolbox';
const CACHE_NAME = `${CACHE_PREFIX}:${BUILD_VERSION}`;

/* ---------------- 安装：预缓存全部站点文件 ---------------- */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // cache: 'reload' 绕过 HTTP 缓存，确保预缓存的是最新构建
      await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })));
      // 不自动 skipWaiting：等页面上「有新版本，点击刷新」的确认
    })(),
  );
});

/* ---------------- 激活：清理旧版本缓存 ---------------- */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/* ---------------- 请求处理 ---------------- */

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 导航请求（打开页面）：网络优先，失败回退缓存的 index.html（离线可用）
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match('./index.html')) ?? (await cache.match('index.html')) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // 同源静态资源：缓存优先，未命中取网络并写回
  if (new URL(request.url).origin === self.location.origin && request.method === 'GET') {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, { ignoreSearch: false });
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return Response.error();
        }
      })(),
    );
  }
});

/* ---------------- 新版本接管（页面确认后调用） ---------------- */

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
