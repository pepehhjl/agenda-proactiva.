// Saves this device so it can receive notifications. POST {sub} saves, POST {test:true} sends a test.
// POST {sub, probe:id} sends a test to THIS device only; tapping it tells the app the reminders really arrive.
import { who, deny, supa, pushReady, sendToAll, sendOne, readBody } from "./_lib.js";
import { texts } from "./_i18n.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const owner = await who(req);
  if (!owner) return deny(res);
  const sb = supa();
  if (!sb) return res.status(503).json({ error: "no_db", message: "Falta configurar Supabase." });
  if (!pushReady()) return res.status(503).json({ error: "no_push", message: "Faltan las claves VAPID en Vercel." });

  const { sub, test, probe, lang } = await readBody(req);
  if (sub && sub.endpoint) {
    const { error } = await sb.from("push_subs").upsert({ endpoint: sub.endpoint, sub, owner });
    if (error) return res.status(500).json({ error: "db_error", message: error.message });
  }
  if (probe && sub && sub.endpoint) {
    const tr = texts(lang), id = String(probe).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
    try {
      await sendOne(sub, { title: tr("probeTitle"), body: tr("probeBody"), tag: "probe", probe: id, url: "/?probe=" + id, arrivedLabel: tr("arrived"), urgency: "high", ttl: 600 });
      return res.json({ ok: true, sent: 1 });
    } catch (e) {
      return res.status(502).json({ error: "push_failed", message: String((e && (e.body || e.message)) || "push failed").slice(0, 200) });
    }
  }
  if (test) {
    const tr = texts(lang);
    const sent = await sendToAll(sb, { title: tr("testTitle"), body: tr("testBody"), tag: "test" }, owner);
    return res.json({ ok: true, sent });
  }
  res.json({ ok: true });
}
