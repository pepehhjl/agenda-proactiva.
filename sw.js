// Service worker: keeps the app opening without internet, shows push notifications sent by /api/cron,
// and receives what is shared to Pendi from other apps (Android).
// The buttons on a task notification (Android) work in the background: they send the answer to /api/act and
// never open a window. Only "Posponer" and "Ahora no" (a choice of time) and a tap on the notification itself open
// Pendi, and then always the installed app's window, never a browser tab (iPhone has no buttons: a tap opens Pendi).
const CACHE = "pendi-v3";
const SHELL = ["/", "/flow.js"];
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
    data: { url: d.url || "/", taskId: d.taskId || null, probe: d.probe || null, act: d.act || null, ask: !!d.ask },
    // As many buttons as this phone shows (2 on Android), in the order the server chose.
    actions: (Array.isArray(d.actions) ? d.actions : d.probe ? [{ action: "arrived", title: d.arrivedLabel || "Llegó" }] : [])
      .slice(0, (self.Notification && Notification.maxActions) || 2),
  })];
  // The number on the app icon: what is left for today.
  if (typeof d.badge === "number" && self.navigator.setAppBadge) jobs.push((d.badge ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => {}));
  e.waitUntil(Promise.all(jobs));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const { url = "/", taskId, probe } = e.notification.data || {};
  // The test reminder: tapping it (or "Llegó") is the proof it arrived. The open app is told right away; the proof is
  // also kept in a cache, so the app finds it even if the message is lost, and a closed app opens with ?probe=.
  if (probe) {
    e.waitUntil(caches.open("pendi-share").then((c) => c.put("/probe-ok", new Response(probe))).catch(() => {})
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true })).then((wins) => {
        for (const w of wins) { w.postMessage({ probe }); if ("focus" in w) return w.focus().catch(() => {}); return; }
        return self.clients.openWindow(url);
      }));
    return;
  }
  const { act, ask } = e.notification.data || {};
  const a = e.action === "done" ? "yes" : e.action; // "Hecho" on a notification sent before 0.10
  if (taskId && BACKGROUND.has(a)) { e.waitUntil(answer(taskId, act, a)); return; }
  const target = taskId ? `/?accion=${a || (ask ? "ask" : "open")}&id=${encodeURIComponent(taskId)}` : url;
  e.waitUntil(openApp(target));
});

// Answers that need no screen. If the server can't be reached, the app opens and applies it itself.
const BACKGROUND = new Set(["go", "start", "yes", "finished", "notyet", "later", "more"]);
async function answer(id, act, a) {
  try {
    if (!act) throw new Error("unsigned");
    const r = await fetch("/api/act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ o: act.o, s: act.s, id, a }) });
    if (!r.ok) throw new Error("http " + r.status);
    const { task } = await r.json();
    // An open Pendi updates the task at once; a closed one reads it from the server when it opens.
    for (const w of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) w.postMessage({ task, answer: a });
  } catch {
    return openApp(`/?accion=${a}&id=${encodeURIComponent(id)}`);
  }
}

// Which windows are the installed app: each Pendi window tells us when it opens (see "hello" in index.html).
// Kept in a cache, because the service worker may be restarted between two taps.
async function appInfo() {
  try { const r = await (await caches.open("pendi-share")).match("/app-windows"); return r ? await r.json() : { installed: false, ids: [] }; }
  catch { return { installed: false, ids: [] }; }
}
self.addEventListener("message", (e) => {
  if (!e.data || !e.data.hello || !e.source) return;
  e.waitUntil(appInfo().then((info) => {
    const ids = e.data.standalone ? [e.source.id, ...info.ids.filter((x) => x !== e.source.id)].slice(0, 8) : info.ids;
    const next = { installed: info.installed || !!e.data.standalone, ids };
    return caches.open("pendi-share").then((c) => c.put("/app-windows", new Response(JSON.stringify(next))));
  }).catch(() => {}));
});
// Opens Pendi on that address: the installed app's window if it is open (it is told where to go, without reloading);
// otherwise a new app window. A browser tab is reused only when Pendi was never installed on this phone.
async function openApp(target) {
  const [wins, info] = await Promise.all([self.clients.matchAll({ type: "window", includeUncontrolled: true }), appInfo()]);
  const w = wins.find((x) => info.ids.includes(x.id)) || (!info.installed && wins[0]);
  if (w) { w.postMessage({ open: target }); return w.focus().catch(() => {}); }
  return self.clients.openWindow(target);
}
