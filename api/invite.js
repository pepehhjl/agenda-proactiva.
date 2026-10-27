// Invite links (main agenda only). GET lists them; POST {name} makes one; POST {remove: id} deletes that
// person's link, agenda and devices. Whoever opens a link gets their own empty agenda, without the password.
import crypto from "node:crypto";
import { authed, deny, supa, readBody } from "./_lib.js";

export default async function handler(req, res) {
  if (!(await authed(req))) return deny(res);
  const sb = supa();
  if (!sb) return res.status(503).json({ error: "no_db", message: "Falta configurar Supabase." });

  if (req.method === "GET") {
    const { data, error } = await sb.from("people").select("id, name, token, created_at").order("created_at");
    if (error) return res.status(500).json({ error: "db_error", message: error.message });
    return res.json({ people: data || [] });
  }
  if (req.method === "POST") {
    const { name, remove } = await readBody(req);
    if (remove) {
      const id = String(remove);
      for (const table of ["items", "push_subs"]) await sb.from(table).delete().eq("owner", id);
      const { error } = await sb.from("people").delete().eq("id", id);
      if (error) return res.status(500).json({ error: "db_error", message: error.message });
      return res.json({ ok: true });
    }
    const row = { id: "p_" + crypto.randomBytes(6).toString("hex"), name: String(name || "").trim().slice(0, 60) || "Invitado", token: crypto.randomBytes(24).toString("base64url") };
    const { error } = await sb.from("people").insert(row);
    if (error) return res.status(500).json({ error: "db_error", message: error.message });
    return res.json({ person: row });
  }
  res.status(405).end();
}
