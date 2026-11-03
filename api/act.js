// A button on a task notification (Empezar, Voy ahora, Ya terminé, Todavía no, Sigo en eso…), applied in the
// background by the service worker without opening any window. POST {o: owner, id, s: signature, a: action}.
import { supa, readBody, actOk } from "./_lib.js";
import "../flow.js";

const F = globalThis.PendiFlow;
// Only the answers a notification can give; choosing a time (Posponer, Ahora no) happens inside the app.
const OK = new Set(["go", "start", "yes", "finished", "done", "notyet", "later", "more"]);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { o, id, s, a } = await readBody(req);
  if (!o || !id || !OK.has(a) || !actOk(String(o), String(id), s)) return res.status(401).json({ error: "unauthorized" });
  const sb = supa();
  if (!sb) return res.status(503).json({ error: "no_db" });
  const { data: row, error } = await sb.from("items").select("data").eq("owner", o).eq("id", id).eq("kind", "task").maybeSingle();
  if (error) return res.status(500).json({ error: "db_error" });
  if (!row) return res.status(404).json({ error: "not_found" });
  const next = F.apply(row.data, a, Date.now());
  const { error: e2 } = await sb.from("items").update({ data: next, updated_at: new Date().toISOString() }).eq("owner", o).eq("id", id);
  if (e2) return res.status(500).json({ error: "db_error" });
  res.json({ ok: true, task: { ...next, id, kind: "task" } });
}
