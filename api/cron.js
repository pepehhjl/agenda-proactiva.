// Runs every minute (called by Supabase pg_cron). Sends reminders 60, 30 and 10 minutes before each task,
// and birthday notices 2 days before and on the day, at 9:00 in the user's time zone.
import { authed, deny, supa, pushReady, sendToAll } from "./_lib.js";

const THRESHOLDS = [60, 30, 10];

function localParts(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour };
}

export default async function handler(req, res) {
  if (!authed(req)) return deny(res);
  const sb = supa();
  if (!sb || !pushReady()) return res.json({ skipped: "not_configured" });

  const { data: items, error } = await sb.from("items").select("id, kind, data");
  if (error) return res.status(500).json({ error: error.message });
  const now = Date.now();
  const settings = (items.find((r) => r.kind === "settings") || {}).data || {};
  const tz = settings.tz || "UTC";

  const due = []; // {keys, payload}
  for (const r of items) {
    const t = r.data;
    if (r.kind === "task" && !t.done && t.start) {
      const mins = (Date.parse(t.start) - now) / 60000;
      if (mins <= 0 || mins > 60) continue;
      const hit = THRESHOLDS.filter((th) => mins <= th);
      const smallest = hit[hit.length - 1];
      const label = smallest === 60 ? "En 1 hora" : `En ${smallest} minutos`;
      due.push({
        check: `${r.id}@${t.start}#${smallest}`,
        keys: hit.map((th) => `${r.id}@${t.start}#${th}`),
        payload: { title: `${label}: ${t.title}`, body: t.tip || `A las ${t.time}.`, tag: r.id },
      });
    }
    if (r.kind === "bday" && t.month && t.day) {
      const lp = localParts(new Date(now), tz);
      if (lp.h < 9) continue;
      const today = Date.UTC(lp.y, lp.m - 1, lp.d);
      let next = Date.UTC(lp.y, t.month - 1, t.day);
      if (next < today) next = Date.UTC(lp.y + 1, t.month - 1, t.day);
      const days = Math.round((next - today) / 86400000);
      if (days !== 2 && days !== 0) continue;
      const key = `${r.id}@${new Date(next).getUTCFullYear()}#bd${days}`;
      due.push({
        check: key, keys: [key],
        payload: days === 2
          ? { title: `En 2 días cumple ${t.name}`, body: "Abre la agenda para ver ideas de regalo y un mensaje.", tag: r.id }
          : { title: `Hoy cumple ${t.name}`, body: "No olvides escribirle.", tag: r.id },
      });
    }
  }
  if (!due.length) return res.json({ sent: 0 });

  const { data: already } = await sb.from("sent").select("key").in("key", due.map((x) => x.check));
  const done = new Set((already || []).map((x) => x.key));
  let sent = 0;
  for (const x of due) {
    if (done.has(x.check)) continue;
    await sb.from("sent").upsert(x.keys.map((key) => ({ key })));
    sent += await sendToAll(sb, x.payload);
  }
  res.json({ sent });
}
