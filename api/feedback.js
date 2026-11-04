// Problem reports and ideas from Ajustes → Ayuda y pruebas. POST {type:"bug"|"idea", message, meta} saves one
// (any agenda: the password or an invite key). GET lists them, newest first (main agenda only, read-only).
// meta keeps only version, screen and lastError: nothing else from the phone is stored.
import { who, deny, supa, readBody } from "./_lib.js";

const TYPES = new Set(["bug", "idea"]);
const short = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const noTable = (error) => /feedback/i.test(error.message || "") && /exist|schema cache|relation/i.test(error.message || "");

export default async function handler(req, res) {
  const owner = await who(req);
  if (!owner) return deny(res);
  const sb = supa();
  if (!sb) return res.status(503).json({ error: "no_db", message: "Falta configurar Supabase." });
  const fail = (error) => res.status(noTable(error) ? 503 : 500).json({ error: noTable(error) ? "no_table" : "db_error", message: error.message });

  if (req.method === "GET") {
    if (owner !== "main") return deny(res);
    const { data, error } = await sb.from("feedback").select("id, created_at, person_id, type, message, meta").order("created_at", { ascending: false }).limit(200);
    if (error) return fail(error);
    return res.json({ feedback: data || [] });
  }
  if (req.method === "POST") {
    const { type, message, meta } = await readBody(req);
    const text = short(message, 2000);
    if (!TYPES.has(type) || !text) return res.status(400).json({ error: "bad_request", message: "Falta el mensaje." });
    const m = meta && typeof meta === "object" ? meta : {};
    const row = {
      person_id: owner === "main" ? null : owner,
      type,
      message: text,
      meta: { version: short(m.version, 20), screen: short(m.screen, 60), lastError: short(m.lastError, 300) || null },
    };
    const { error } = await sb.from("feedback").insert(row);
    if (error) return fail(error);
    return res.json({ ok: true });
  }
  res.status(405).end();
}
