/* =========================================
   Service Worker - 身心健康评估 PWA
   版本: 1.0.4
   ========================================= */

const CACHE_NAME = 'health-assess-v1.0.3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

// 安装：预缓存核心资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] 预缓存资源');
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => {
      return Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => {
          console.log('[SW] 删除旧缓存:', n);
          return caches.delete(n);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 请求拦截：Cache-first 策略
self.addEventListener('fetch', event => {
  // 只处理 GET 请求
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // 后台更新缓存（stale-while-revalidate）
        fetchAndCache(event.request);
        return cached;
      }
      return fetchAndCache(event.request).catch(() => {
        // 离线且缓存未命中：返回离线页面
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('./index.html');
        }
      });
    })
  );
});

function fetchAndCache(request) {
  return fetch(request).then(response => {
    if (response && response.status === 200 && response.type === 'basic') {
      const respClone = response.clone();
      caches.open(CACHE_NAME).then(cache => {
        cache.put(request, respClone);
      });
    }
    return response;
  });
}

// 监听消息（供页面控制更新）
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
