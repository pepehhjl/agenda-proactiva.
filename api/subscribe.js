// Saves this device so it can receive notifications. POST {sub} saves, POST {test:true} sends a test.
import { authed, deny, supa, pushReady, sendToAll, readBody } from "./_lib.js";
import { texts } from "./_i18n.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!authed(req)) return deny(res);
  const sb = supa();
  if (!sb) return res.status(503).json({ error: "no_db", message: "Falta configurar Supabase." });
  if (!pushReady()) return res.status(503).json({ error: "no_push", message: "Faltan las claves VAPID en Vercel." });

  const { sub, test, lang } = await readBody(req);
  if (sub && sub.endpoint) {
    const { error } = await sb.from("push_subs").upsert({ endpoint: sub.endpoint, sub });
    if (error) return res.status(500).json({ error: "db_error", message: error.message });
  }
  if (test) {
    const tr = texts(lang);
    const sent = await sendToAll(sb, { title: tr("testTitle"), body: tr("testBody"), tag: "test" });
    return res.json({ ok: true, sent });
  }
  res.json({ ok: true });
}
