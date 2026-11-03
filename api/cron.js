// Runs every minute (called by Supabase pg_cron). Task notifications follow the level chosen in Ajustes > Avisos
// (or the task's own level; see flow.js): low = 5 min before only; mid = 10 min before + one closing question;
// high = 60, 30 and 10 minutes before, one at its exact time, then the closing question with a strict budget:
// instant tasks get the question 10 min later, timed ones a check-in when their time is up, each repeated once
// at most; several questions at once go out as one grouped notification;
// birthday notices 2 days before and on the day, at 9:00 in the user's time zone, and the morning, evening and
// Sunday summaries at the times chosen in Ajustes > Resúmenes.
import { authed, deny, supa, pushReady, sendToAll, actSig } from "./_lib.js";
import { texts } from "./_i18n.js";
import "../flow.js";

const F = globalThis.PendiFlow;

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
const pad = (n) => String(n).padStart(2, "0");
// "HH:MM" plus n minutes, no later than 23:59.
const addMin = (s, n) => { const [h, m] = s.split(":").map(Number); const x = Math.min(24 * 60 - 1, h * 60 + m + n); return pad(Math.floor(x / 60)) + ":" + pad(x % 60); };
// Quiet hours like {from:"22:00", to:"07:00"}; the range may cross midnight.
function isQuiet(q, hm) {
  if (!q || !q.from || !q.to || q.from === q.to) return false;
  return q.from < q.to ? hm >= q.from && hm < q.to : hm >= q.from || hm < q.to;
}

export default async function handler(req, res) {
  if (!(await authed(req))) return deny(res);
  const sb = supa();
  if (!sb || !pushReady()) return res.json({ skipped: "not_configured" });

  const { data: rows, error } = await sb.from("items").select("owner, id, kind, data");
  if (error) return res.status(500).json({ error: error.message });
  // Each agenda (the main one and every invited person's) has its own settings, reminders and devices.
  const byOwner = new Map();
  for (const r of rows) { if (!byOwner.has(r.owner)) byOwner.set(r.owner, []); byOwner.get(r.owner).push(r); }
  let sent = 0;
  for (const [owner, items] of byOwner) sent += await remind(sb, owner, items);
  res.json({ sent });
}

async function remind(sb, owner, items) {
  const now = Date.now();
  const settings = (items.find((r) => r.kind === "settings") || {}).data || {};
  const tz = settings.tz || "UTC";
  const tr = texts(settings.uiLang);
  // The buttons of a task notification (the service worker shows as many as the phone allows, in this order).
  // Posponer and Ahora no open a small choice inside the installed app; the others work in the background.
  const btn = (k, title) => ({ action: k, title: title || tr("a_" + k) });
  const sign = (id) => ({ act: { o: owner, s: actSig(owner, id) } });
  // Before the task's time, "▶ Empezar temprano": it starts now and the check-in comes when its duration is up from now.
  const lvOf = (t) => F.levelFor(t, settings);
  const remindBtns = (t) => (F.timed(t) ? [btn("start", now < Date.parse(t.start) ? tr("a_startEarly") : null), btn("notnow")] : [btn("snooze"), btn("go")]);
  const askBtns = (t) => (F.timed(t) ? [btn("finished"), ...((Number(t.ext) || 0) < F.MAX_EXT ? [btn("more")] : [])] : [btn("yes", t.yes), btn("notyet")]);
  const question = (t) => (F.timed(t) ? tr("askTimed", { x: t.title }) : t.q || tr("askInstant", { x: t.title }));
  const asks = []; // closing questions due now: grouped if there are several
  const hmNow = localHm(new Date(now), tz);
  if (isQuiet(settings.quiet, hmNow)) return 0;
  const lp0 = localParts(new Date(now), tz);
  // "YYYY-MM-DD" in the user's time zone, off days from today.
  const dayKey = (off) => new Date(Date.UTC(lp0.y, lp0.m - 1, lp0.d + off)).toISOString().slice(0, 10);
  const todayK = dayKey(0);
  const tasks = items.filter((r) => r.kind === "task").map((r) => r.data);
  const today = tasks.filter((t) => t.date === todayK), open = today.filter((t) => !F.closed(t));

  const due = []; // {keys, payload}
  for (const r of items) {
    const t = r.data;
    // A reminder the user postponed with "Posponer".
    const live = r.kind === "task" && !F.closed(t) && !t.startedAt;
    if (live && t.snooze && Date.parse(t.snooze) <= now && now - Date.parse(t.snooze) < 30 * 60000) {
      const key = `${r.id}@snooze@${t.snooze}`;
      const past = t.start && Date.parse(t.start) <= now;
      const body = t.anytime ? t.tip || "" : `${tr(past ? "wasAt" : "isAt", { t: clock(t.time, settings.clock) })}${t.tip ? " · " + t.tip : ""}`;
      due.push({ check: key, keys: [key], payload: { title: `⏰ ${tr("reminder").toUpperCase()} · ${icon(t)} ${t.title}`, body, tag: r.id, taskId: r.id, urgency: "high", actions: remindBtns(t), ...sign(r.id) } });
    }
    // At the task's exact time: a reminder that informs and never closes it ("Es hora de…" with Posponer / Voy ahora,
    // or ▶ Empezar / Ahora no for a timed task). Not after "Posponer": the postponed reminder takes over.
    // A 10-minute window, so quiet hours skip it. The old "+30 min, still open" repeat is gone: the closing question replaces it.
    if (live && t.start && !t.anytime && F.pushes(t, lvOf(t)).at && !(t.snooze && Date.parse(t.snooze) > Date.parse(t.start) - 3600000)) {
      const ago = (now - Date.parse(t.start)) / 60000;
      if (ago >= 0 && ago < 10) {
        const key = `${r.id}@${t.start}#due`, when = clock(t.time, settings.clock), name = `${t.star ? "⭐ " : ""}${icon(t)} ${t.title}`;
        due.push({ check: key, keys: [key], payload: { title: `⏰ ${tr("dueNow").toUpperCase()} · ${name}`, body: `${tr("at", { t: when })}${t.tip ? " · " + t.tip : ""}`, tag: r.id, taskId: r.id, urgency: "high", actions: remindBtns(t), ...sign(r.id) } });
      }
    }
    // The closing question: once (ask), and once more at most (ask2). After that, silence: the task is
    // "Sin confirmar" in the app. Only a task marked "insistir" keeps asking, every 30 min for up to 3 hours.
    // Level low: no question by push (unless the task insists); the task is closed inside the app.
    if (r.kind === "task" && !F.closed(t) && t.start && !t.anytime && F.pushes(t, lvOf(t)).ask) {
      const p = F.plan(t, lvOf(t)), win = F.WINDOW * 60000;
      const step = now >= p.ask && now < p.ask + win ? "ask" : now >= p.ask2 && now < p.ask2 + win ? "ask2"
        : t.critical && now >= p.until && now < p.until + 3 * 3600000 ? "crit" + Math.floor((now - p.until) / 1800000) : null;
      // A started task is not asked while its time runs.
      if (step && F.phase(t, now, lvOf(t)) !== "running") asks.push({ t, key: `${r.id}@${t.start}#${step}` });
    }
    // Tasks without a time (or already started) get no countdown reminders.
    if (r.kind === "task" && !F.closed(t) && !t.startedAt && t.start && !t.anytime) {
      const mins = (Date.parse(t.start) - now) / 60000;
      if (mins <= 0 || mins > 60) continue;
      const lv = lvOf(t), hit = F.pushes(t, lv).leads.filter((th) => mins <= th);
      if (!hit.length) continue;
      const smallest = hit[hit.length - 1];
      // Say the real time left (a task created 3 minutes ahead says "En 3 minutos", not "En 10").
      const left = Math.max(1, Math.round(mins));
      const label = left >= 55 ? tr("inHour") : tr("inMin", { n: left });
      due.push({
        check: `${r.id}@${t.start}#${smallest}`,
        keys: hit.map((th) => `${r.id}@${t.start}#${th}`),
        // The time left in capitals after an alarm clock, so it stands out among other notifications.
        // Below "high" this is the only reminder, so it carries the reminder's buttons (▶ Empezar temprano for a timed task).
        payload: { title: `⏰ ${label.toUpperCase()} · ${t.star ? "⭐ " : ""}${icon(t)} ${t.title}`, urgency: "high", body: `${tr("at", { t: clock(t.time, settings.clock) })}${t.tip ? " · " + t.tip : ""}`, tag: r.id, taskId: r.id, actions: lv === "high" ? [btn("snooze")] : remindBtns(t), ...sign(r.id) },
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

  // One question: in the task's own words ("¿Ya te tomaste la pastilla?"). Several at once: one notification.
  const fresh = [];
  if (asks.length) {
    const { data: was } = await sb.from("sent").select("key").in("key", asks.map((x) => (owner === "main" ? "" : owner + "/") + x.key));
    const seen = new Set((was || []).map((x) => x.key.replace(owner + "/", "")));
    fresh.push(...asks.filter((x) => !seen.has(x.key)));
  }
  if (fresh.length === 1) {
    const { t } = fresh[0];
    due.push({ check: fresh[0].key, keys: [fresh[0].key], payload: { title: `${icon(t)} ${question(t)}`, body: tr("askBody"), tag: t.id, taskId: t.id, urgency: "high", ask: true, actions: askBtns(t), ...sign(t.id) } });
  } else if (fresh.length > 1) {
    const keys = fresh.map((x) => x.key);
    due.push({ check: keys[0], keys, payload: { title: tr("groupTitle", { n: fresh.length }), body: fresh.map((x) => `${icon(x.t)} ${x.t.title}`).join(" · "), tag: "confirm", url: "/?accion=confirm", urgency: "high" } });
  }

  // Summaries, once a day each, within two hours of the chosen time (so quiet hours only delay them).
  const b = settings.brief || {};
  const within = (t) => hmNow >= t && hmNow < addMin(t, 120);
  const brief = (key, payload) => due.push({ check: key, keys: [key], payload: { tag: "brief", ...payload } });
  if (b.mOn !== false && within(b.m || "08:00")) {
    const first = open.filter((t) => !t.anytime && t.time).sort((p, q) => p.time.localeCompare(q.time))[0];
    const star = open.find((t) => t.star);
    const body = !open.length ? tr("mFree")
      : (first ? tr(open.length === 1 ? "mOne" : "mMany", { n: open.length, t: clock(first.time, settings.clock), x: first.title }) : tr("mNoTime", { n: open.length })) + (star && star !== first ? " " + tr("mStar", { x: star.title }) : "");
    // First what yesterday left open (up to 5, with their time), then today.
    const yday = tasks.filter((t) => t.date === dayKey(-1) && !F.closed(t) && !t.openSeen).sort((p, q) => (p.time || "99").localeCompare(q.time || "99"));
    const lead = yday.length ? tr("morningOpenLead", { n: yday.length, x: yday.slice(0, 5).map((t) => t.title + (t.anytime || !t.time ? "" : ` (${clock(t.time, settings.clock)})`)).join(", ") + (yday.length > 5 ? "…" : "") }) + " " : "";
    brief(`brief@${todayK}@m`, { title: tr("mTitle"), body: lead + body, url: "/" });
  }
  if (b.eOn !== false && within(b.e || "21:00") && today.length) {
    brief(`brief@${todayK}@e`, open.length
      ? { title: tr("eTitle"), body: tr(open.length === 1 ? "eOne" : "eMany", { n: open.length }), url: "/?accion=evening" }
      : { title: tr("eDoneTitle"), body: tr("eDoneBody"), url: "/" });
  }
  if (b.wOn !== false && new Date(Date.UTC(lp0.y, lp0.m - 1, lp0.d)).getUTCDay() === 0 && within("18:00")) {
    const past = new Set([0, 1, 2, 3, 4, 5, 6].map((i) => dayKey(-i))), next = new Set([1, 2, 3, 4, 5, 6, 7].map(dayKey));
    // "Cerraste 9 de 11; 6 salieron bien": a close is any confirmed answer (done, half, not done, skipped).
    const week = tasks.filter((t) => past.has(t.date)), good = week.filter((t) => t.close && F.good(t.close.outcome)).length;
    brief(`brief@${todayK}@w`, { title: tr("wTitle"), body: tr(good ? "wBodyGood" : "wBody", { d: week.filter(F.closed).length, t: week.length, g: good, n: tasks.filter((t) => next.has(t.date)).length }), url: "/?accion=week" });
  }
  // The number on the app icon: what is left for today.
  for (const x of due) x.payload.badge = open.length;
  if (!due.length) return 0;
  // Keys of the main agenda stay as they were; other agendas' keys start with their owner.
  if (owner !== "main") for (const x of due) { x.check = owner + "/" + x.check; x.keys = x.keys.map((k) => owner + "/" + k); }

  const { data: already } = await sb.from("sent").select("key").in("key", due.map((x) => x.check));
  const done = new Set((already || []).map((x) => x.key));
  let sent = 0;
  for (const x of due) {
    if (done.has(x.check)) continue;
    await sb.from("sent").upsert(x.keys.map((key) => ({ key })));
    sent += await sendToAll(sb, x.payload, owner);
  }
  return sent;
}
