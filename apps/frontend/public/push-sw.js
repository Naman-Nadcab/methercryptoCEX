/* eslint-disable */
// Push notification service worker. Registered on demand from the preferences page.
// Keeps a narrow scope (/push-sw.js at origin root) so it does not interfere with
// Next.js build assets or existing SW behaviour. Does NOT cache the app shell.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Notification', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Mether Exchange';
  const options = {
    body: data.body || '',
    icon: data.icon || '/assets/icon-192.png',
    badge: data.badge || '/assets/badge-72.png',
    tag: data.tag,
    data: { url: data.url || '/', ...(data.data || {}) },
    requireInteraction: Boolean(data.requireInteraction),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        try {
          const url = new URL(client.url);
          const dest = new URL(targetUrl, self.registration.scope);
          if (url.origin === dest.origin) {
            await client.focus();
            if ('navigate' in client) {
              try { await client.navigate(dest.href); } catch {}
            }
            return;
          }
        } catch {}
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(new URL(targetUrl, self.registration.scope).href);
      }
    })()
  );
});
