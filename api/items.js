// Saves tasks, birthdays and settings in Supabase. GET lists them; POST {upsert:[...], remove:[ids]} changes them.
import { authed, deny, supa, readBody } from "./_lib.js";

export default async function handler(req, res) {
  if (!authed(req)) return deny(res);
  const sb = supa();
  if (!sb) return res.status(503).json({ error: "no_db", message: "Falta configurar Supabase." });

  if (req.method === "GET") {
    const { data, error } = await sb.from("items").select("id, kind, data");
    if (error) return res.status(500).json({ error: "db_error", message: error.message });
    return res.json({ items: (data || []).map((r) => ({ ...r.data, id: r.id, kind: r.kind })) });
  }
  if (req.method === "POST") {
    const { upsert = [], remove = [] } = await readBody(req);
    if (upsert.length) {
      const rows = upsert.filter((x) => x && x.id && x.kind).map(({ id, kind, ...data }) => ({ id: String(id), kind: String(kind), data, updated_at: new Date().toISOString() }));
      const { error } = await sb.from("items").upsert(rows);
      if (error) return res.status(500).json({ error: "db_error", message: error.message });
    }
    if (remove.length) {
      const { error } = await sb.from("items").delete().in("id", remove.map(String));
      if (error) return res.status(500).json({ error: "db_error", message: error.message });
    }
    return res.json({ ok: true });
  }
  res.status(405).end();
}
