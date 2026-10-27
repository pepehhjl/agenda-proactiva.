// Saves tasks, birthdays and settings in Supabase, each person in their own agenda. GET lists them; POST {upsert:[...], remove:[ids]} changes them.
import { who, deny, supa, readBody } from "./_lib.js";

export default async function handler(req, res) {
  const owner = await who(req);
  if (!owner) return deny(res);
  const sb = supa();
  if (!sb) return res.status(503).json({ error: "no_db", message: "Falta configurar Supabase." });

  if (req.method === "GET") {
    const { data, error } = await sb.from("items").select("id, kind, data").eq("owner", owner);
    if (error) return res.status(500).json({ error: "db_error", message: error.message });
    return res.json({ items: (data || []).map((r) => ({ ...r.data, id: r.id, kind: r.kind })) });
  }
  if (req.method === "POST") {
    const { upsert = [], remove = [] } = await readBody(req);
    if (upsert.length) {
      const rows = upsert.filter((x) => x && x.id && x.kind).map(({ id, kind, ...data }) => ({ owner, id: String(id), kind: String(kind), data, updated_at: new Date().toISOString() }));
      const { error } = await sb.from("items").upsert(rows, { onConflict: "owner,id" });
      if (error) return res.status(500).json({ error: "db_error", message: error.message });
    }
    if (remove.length) {
      const { error } = await sb.from("items").delete().eq("owner", owner).in("id", remove.map(String));
      if (error) return res.status(500).json({ error: "db_error", message: error.message });
    }
    return res.json({ ok: true });
  }
  res.status(405).end();
}
