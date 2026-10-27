// Service worker: keeps the app opening without internet, shows push notifications sent by /api/cron,
// and receives what is shared to Pendi from other apps (Android).
// "Posponer" and "Hecho" (Android) open the app with the action in the address, and the app applies it.
// A plain tap on a task notification opens the quick-action screen (iPhone has no buttons on web notifications).
const CACHE = "pendi-v2";
const SHELL = ["/"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
// Old saved copies are dropped when a new version takes over.
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== "pendi-share").map((k) => caches.delete(k)))).then(() => self.clients.claim())));

// Pages and files come from the network first, so a new version shows on the next open; the saved copy is used
// only without internet. The API is never cached: the app keeps its own copy of the data and sends changes later.
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method === "POST" && url.pathname === "/share") return e.respondWith(shared(req));
  if (req.method !== "GET" || url.pathname.startsWith("/api/")) return;
  // The phone reads the icons and the manifest straight from the server when the app is added to the home screen.
  if (/\.(png|webmanifest)$/.test(url.pathname)) return;
  const font = /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== self.location.origin && !font) return;
  e.respondWith(fromNetwork(req, font));
});
async function fromNetwork(req, font) {
  const cache = await caches.open(CACHE), page = req.mode === "navigate", key = page ? "/" : req;
  if (font) { const hit = await cache.match(req); if (hit) return hit; }
  try {
    // A very slow connection counts as none, so the app still opens.
    const res = await Promise.race([fetch(req), new Promise((_, ko) => setTimeout(() => ko(new Error("slow")), page ? 6000 : 10000))]);
    if (res.ok || res.type === "opaque") cache.put(key, res.clone()).catch(() => {});
    return res;
  } catch {
    return (await cache.match(key, { ignoreSearch: true })) || (page && (await cache.match("/"))) || Response.error();
  }
}
// Share sheet (Android): the text goes in the address; a picture waits in a cache until the app reads it.
async function shared(req) {
  const f = await req.formData();
  const text = ["title", "text", "url"].map((k) => f.get(k)).filter(Boolean).join(" ").slice(0, 1000);
  const img = f.get("image");
  const has = img && typeof img === "object" && img.size > 0;
  if (has) await (await caches.open("pendi-share")).put("/shared-image", new Response(img, { headers: { "content-type": img.type || "image/jpeg" } }));
  return Response.redirect(new URL(`/?share=1&text=${encodeURIComponent(text)}${has ? "&img=1" : ""}`, self.location.origin).href, 303);
}

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const title = d.title || "Pendi";
  const jobs = [self.registration.showNotification(title, {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: d.tag,
    renotify: !!d.taskId,
    data: { url: d.url || "/", taskId: d.taskId || null },
    actions: d.taskId ? [{ action: "snooze", title: d.snoozeLabel || "Posponer 10 min" }, { action: "done", title: d.doneLabel || "Hecho" }] : [],
  })];
  // The number on the app icon: what is left for today.
  if (typeof d.badge === "number" && self.navigator.setAppBadge) jobs.push((d.badge ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => {}));
  e.waitUntil(Promise.all(jobs));
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
