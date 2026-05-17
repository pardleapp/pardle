// Pardle service worker. Lives at /sw.js so it's same-origin and can
// intercept push events for the whole pardle.app scope.

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Pardle", body: event.data.text() };
  }
  const title = payload.title || "Pardle";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/icon-192.png",
    tag: payload.tag,
    data: { url: payload.url || "/" },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsArr) => {
        // If a tab is already on Pardle, focus + navigate to the target.
        for (const client of clientsArr) {
          if ("focus" in client) {
            const u = new URL(client.url);
            if (u.origin === self.location.origin) {
              client.focus();
              if ("navigate" in client) {
                client.navigate(targetUrl);
              }
              return;
            }
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      }),
  );
});
