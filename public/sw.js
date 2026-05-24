const NOTIFICATION_TITLE = 'Nova corrida disponível';
const DEFAULT_URL = '/radar';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || NOTIFICATION_TITLE;
  const body = payload.body || payload.message || 'Toque para abrir o app do motorista.';
  const url = payload.url || payload.deepLink || DEFAULT_URL;
  const corridaId = payload.corridaId || payload.id || Date.now();

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/pwa/icon-192.png',
      badge: '/pwa/badge-96.png',
      tag: `corrida-${corridaId}`,
      renotify: true,
      requireInteraction: true,
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || DEFAULT_URL;

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    for (const client of clientList) {
      if ('focus' in client) {
        client.navigate(url);
        return client.focus();
      }
    }

    return self.clients.openWindow(url);
  })());
});
