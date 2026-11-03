// Офлайн-кэш оболочки приложения. Данные (data/*) всегда берутся из сети.
const CACHE = 'knn-v9';
const SHELL = ['./', 'index.html', 'style.css', 'js/app.js', 'js/admin.js', 'js/crypto.js', 'js/lessons.js', 'js/data.js', 'js/notify.js', 'js/util.js', 'js/views.js', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Сначала сеть, при отсутствии сети — кэш. no-cache: Pages разрешает браузеру держать файлы
// 10 минут, из-за этого после обновления новая страница смешивалась со старыми скриптами
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/data/')) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Напоминания от бота рассылки: { title, body, url, tag }
self.addEventListener('push', e => {
  const m = e.data ? e.data.json() : { title: 'КНН трекер' };
  e.waitUntil(self.registration.showNotification(m.title, { body: m.body, icon: 'icon.svg', badge: 'icon.svg', tag: m.tag, data: { url: m.url } }));
});

// Нажатие — открыть комнату пары или трекер
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || './'));
});
