// The way in for an invite link: /api/enter?invite=KEY checks the key and leaves it in a cookie (pendi_key), then
// goes to the app. The cookie lets the person in wherever the page's own storage is empty: the installed app
// (whose start page is this address, so each open plants it again), another tab, or after storage was cleared.
// A key that is not valid goes to the app with no cookie, where the usual password screen shows.
// /api/enter?out=1 forgets the cookie (Cerrar sesión).
import { supa } from "./_lib.js";

const COOKIE = "pendi_key";

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  const q = req.query || {};
  if (q.out) {
    res.setHeader("set-cookie", `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly`);
  } else {
    const key = String(q.invite || "");
    let ok = false;
    if (/^[A-Za-z0-9_-]{20,64}$/.test(key)) {
      const sb = supa();
      if (sb) {
        const { data } = await sb.from("people").select("id").eq("token", key).maybeSingle();
        ok = !!data;
      }
    }
    if (ok) res.setHeader("set-cookie", `${COOKIE}=${key}; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly`);
  }
  res.statusCode = 302;
  res.setHeader("location", "/");
  res.end();
}
