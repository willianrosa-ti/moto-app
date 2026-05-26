self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var payload = {};

  if (event.data) {
    try {
      payload = event.data.json();
    } catch (error) {
      payload = { body: event.data.text() };
    }
  }

  var title = payload.title || 'Nova chamada MIL-LIN';
  var options = {
    body: payload.body || 'Abra o radar para ver a corrida disponivel.',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag: payload.tag || 'mil-lin-nova-corrida',
    renotify: true,
    requireInteraction: true,
    data: {
      url: payload.url || '/radar',
      corridaId: payload.corridaId || null
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  var destino = new URL(event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : '/radar', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientes) {
      for (var i = 0; i < clientes.length; i += 1) {
        var cliente = clientes[i];

        if ('focus' in cliente) {
          if ('navigate' in cliente && cliente.url.indexOf(self.location.origin) === 0) {
            return cliente.navigate(destino).then(function (navegado) {
              return navegado ? navegado.focus() : cliente.focus();
            });
          }

          return cliente.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(destino);
      }

      return undefined;
    })
  );
});
