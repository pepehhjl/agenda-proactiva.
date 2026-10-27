// Runs every minute (called by Supabase pg_cron). Sends reminders 60, 30 and 10 minutes before each task,
// and birthday notices 2 days before and on the day, at 9:00 in the user's time zone.
import { authed, deny, supa, pushReady, sendToAll } from "./_lib.js";
import { texts, actionLabels } from "./_i18n.js";

const THRESHOLDS = [60, 30, 10];
const EMOJI = { trabajo: "💼", personal: "🙋", casa: "🏠", salud: "💪", creativo: "🎨", social: "🎉", otro: "📌" };
const icon = (t) => t.emoji || EMOJI[t.cat] || "📌";

function localParts(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour };
}
// "HH:MM" now in the user's time zone.
const localHm = (date, tz) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
// "HH:MM" in the clock the user chose (Ajustes > Formato): "3:52 PM" by default, "15:52" for 24 h.
const clock = (s, mode) => {
  if (!s || mode === "24") return s || "";
  const [h, m] = s.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
// Quiet hours like {from:"22:00", to:"07:00"}; the range may cross midnight.
function isQuiet(q, hm) {
  if (!q || !q.from || !q.to || q.from === q.to) return false;
  return q.from < q.to ? hm >= q.from && hm < q.to : hm >= q.from || hm < q.to;
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
  const tr = texts(settings.uiLang);
  const labels = actionLabels(settings.uiLang);
  // Which warnings the user wants (Ajustes > Avisos). Default: all three.
  const wanted = Array.isArray(settings.remind) && settings.remind.length ? THRESHOLDS.filter((x) => settings.remind.includes(x)) : THRESHOLDS;
  if (isQuiet(settings.quiet, localHm(new Date(now), tz))) return res.json({ sent: 0, quiet: true });

  const due = []; // {keys, payload}
  for (const r of items) {
    const t = r.data;
    // A reminder the user postponed with "Posponer".
    if (r.kind === "task" && !t.done && t.snooze && Date.parse(t.snooze) <= now && now - Date.parse(t.snooze) < 30 * 60000) {
      const key = `${r.id}@snooze@${t.snooze}`;
      const past = t.start && Date.parse(t.start) <= now;
      due.push({ check: key, keys: [key], payload: { title: `${icon(t)} ${tr("reminder")}: ${t.title}`, body: `${tr(past ? "wasAt" : "isAt", { t: clock(t.time, settings.clock) })}${t.tip ? " · " + t.tip : ""}`, tag: r.id, taskId: r.id, ...labels } });
    }
    if (r.kind === "task" && !t.done && t.start) {
      const mins = (Date.parse(t.start) - now) / 60000;
      if (mins <= 0 || mins > 60) continue;
      const hit = wanted.filter((th) => mins <= th);
      if (!hit.length) continue;
      const smallest = hit[hit.length - 1];
      // Say the real time left (a task created 3 minutes ahead says "En 3 minutos", not "En 10").
      const left = Math.max(1, Math.round(mins));
      const label = left >= 55 ? tr("inHour") : tr("inMin", { n: left });
      due.push({
        check: `${r.id}@${t.start}#${smallest}`,
        keys: hit.map((th) => `${r.id}@${t.start}#${th}`),
        payload: { title: `${icon(t)} ${label}: ${t.title}`, body: `${tr("at", { t: clock(t.time, settings.clock) })}${t.tip ? " · " + t.tip : ""}`, tag: r.id, taskId: r.id, ...labels },
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
          ? { title: tr("bday2", { n: t.name }), body: tr("bday2Body"), tag: r.id, url: "/?tab=chat" }
          : { title: tr("bday0", { n: t.name }), body: tr("bday0Body"), tag: r.id, url: "/?tab=chat" },
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
