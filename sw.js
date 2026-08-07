const DEFAULT_NOTIFICATION = Object.freeze({
  title: "組み合わせ練習",
  body: "新しい予定が追加されました。タップして確認してください。",
  tag: "schedule-created",
  url: "/",
});

self.addEventListener("push", (event) => {
  let payload = DEFAULT_NOTIFICATION;
  if (event.data) {
    try {
      payload = { ...DEFAULT_NOTIFICATION, ...event.data.json() };
    } catch {
      payload = { ...DEFAULT_NOTIFICATION, body: event.data.text() || DEFAULT_NOTIFICATION.body };
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/app-icon-192.png",
      tag: payload.tag,
      renotify: true,
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const sameOriginClient = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (sameOriginClient) {
        if ("navigate" in sameOriginClient) await sameOriginClient.navigate(targetUrl);
        return sameOriginClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
