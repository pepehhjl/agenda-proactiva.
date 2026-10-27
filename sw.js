// Service worker: shows push notifications sent by /api/cron and opens the app when tapped.
// "Posponer" and "Hecho" (Android) open the app with the action in the address, and the app applies it.
// A plain tap on a task notification opens the quick-action screen (iPhone has no buttons on web notifications).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const title = d.title || "Pendi";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: d.tag,
    data: { url: d.url || "/", taskId: d.taskId || null },
    actions: d.taskId ? [{ action: "snooze", title: "Posponer 10 min" }, { action: "done", title: "Hecho" }] : [],
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const { url = "/", taskId } = e.notification.data || {};
  const target = taskId ? `/?accion=${e.action || "open"}&id=${encodeURIComponent(taskId)}` : url;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if ("navigate" in w) return w.navigate(target).then((c) => c && c.focus());
    return self.clients.openWindow(target);
  }));
});
