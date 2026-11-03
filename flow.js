// How a task closes, shared by the app (index.html loads this file) and the server (api/cron.js, api/act.js).
// Rule: nothing is marked done when Pendi reminds; a task closes when Pendi asks afterwards and the person answers.
// - Instant tasks (shorter than 15 min, like a pill or a call): a reminder at the time, the question 10 min later
//   ("¿Ya te tomaste la pastilla?"), and once more only if the answer was "Todavía no" / "Responder luego".
// - Timed tasks (15 min or more): a reminder with "▶ Empezar", one check-in when the time is up ("¿Ya terminaste…?")
//   and one more question (after "Sigo en eso · +15", "Responder luego", or 30 min of silence).
// With no answer after that, the task is "Sin confirmar": never done, never a failure. It leaves the notifications
// and lives in the app's lists. Only a task the person marked "insistir" keeps asking by notification.
(function (g) {
  const MIN = 60000;
  const TIMED = 15; // minutes: from here a task is "con tiempo"
  const ASK_AFTER = 10; // instant: the question, 10 min after the reminder
  const AGAIN = 30; // "Todavía no" / "Responder luego" / silence on a timed check-in: asked again 30 min later
  const EXTRA = 15; // "Sigo en eso": 15 more minutes
  const MAX_EXT = 3; // at most 3 times; then it goes to the end-of-day review
  const SILENT = 60; // 1 h after the last question with no answer, it is "Sin confirmar"
  const WINDOW = 30; // a notification may still go out up to 30 min late (outside quiet hours)
  const ms = (s) => (s ? Date.parse(s) : NaN);
  const iso = (n) => new Date(n).toISOString();
  const timed = (t) => (Number(t.dur) || 0) >= TIMED;
  const closed = (t) => !!(t && (t.done || t.close));
  // "Bien / Regular / Mal", or for a call "Resolví / Queda pendiente / No contestó".
  const outcomes = (t) => (t.type === "call" ? ["solved", "pending", "noanswer"] : ["good", "meh", "bad"]);
  // "¿Cómo te fue?" makes sense after a timed task or a call (not after a pill).
  const asksHow = (t) => timed(t) || t.type === "call";
  const good = (k) => k === "good" || k === "solved";

  // Notification level (Ajustes > Avisos, and optionally per task). Summaries, birthdays and the test push are outside it.
  // - low  ("Solo lo esencial"): one reminder 5 min before; no closing question by push (closed inside the app).
  // - mid  (default): one reminder 10 min before + one closing question, no repeat on silence.
  // - high ("Que no se me pase nada"): 60/30/10 before, one at its time, the question and one repeat on silence (0.10.0).
  // "Insistir hasta que confirme" (t.critical) works above the level: it always asks and keeps asking.
  const LEVELS = ["low", "mid", "high"];
  const LEADS = { low: [5], mid: [10], high: [60, 30, 10] };
  // Accounts from before the levels: the level comes from the warnings they had (all three by default → high;
  // only the 10-min one → mid; none → low). New accounts are saved as mid when they first open the app.
  function fromRemind(r) {
    if (!Array.isArray(r)) return "high";
    if (!r.length) return "low";
    return r.some((x) => Number(x) > 10) ? "high" : "mid";
  }
  const levelOf = (s) => (s && LEVELS.includes(s.level) ? s.level : fromRemind(s && s.remind));
  const levelFor = (t, s) => (t && LEVELS.includes(t.level) ? t.level : levelOf(s));
  // Which pushes a task gets at a level: leads (minutes before), at (the one at its exact time), ask (closing question),
  // again (a repeat when there is no answer).
  function pushes(t, lv) {
    const c = !!(t && t.critical);
    return { leads: LEADS[lv] || LEADS.mid, at: lv === "high", ask: lv !== "low" || c, again: lv === "high" || c };
  }

  // The reminder's time: the task's time, or the later postponed one.
  function anchor(t) { const s = ms(t.start), z = ms(t.snooze); return z > s ? z : s; }
  // When each notification is due (ask: the question or check-in, ask2: the one repeat) and when silence
  // turns into "Sin confirmar" (until). runEnd: when a started task is expected to finish.
  // lv: the task's level; below "high" a timed check-in with no answer is not repeated (only when the person asked
  // for it with "Responder luego" or "Sigo en eso").
  function plan(t, lv) {
    const a = anchor(t), again = ms(t.again), ext = Number(t.ext) || 0, rep = !lv || pushes(t, lv).again;
    if (!timed(t)) {
      const ask = a + ASK_AFTER * MIN, ask2 = again > ask ? again : NaN;
      return { remind: a, ask, ask2, until: (ask2 || ask) + SILENT * MIN, runEnd: NaN };
    }
    const base = ms(t.startedAt) || a, end = base + (Number(t.dur) || 30) * MIN, runEnd = end + ext * EXTRA * MIN;
    // After "Sigo en eso", the next question comes when the extra time is over (the first check-in is already used).
    const ask = ext ? NaN : end;
    const ask2 = ext ? Math.max(runEnd, again || 0) : again > end ? again : rep ? end + AGAIN * MIN : NaN;
    return { remind: a, ask, ask2, until: (ask2 || ask) + SILENT * MIN, runEnd };
  }
  // closed | open (no time) | upcoming | running | due (reminded, not asked yet) | asking | unconfirmed
  function phase(t, now, lv) {
    if (closed(t)) return "closed";
    if (t.anytime || !t.start) return "open";
    const p = plan(t, lv);
    const started = !!(t.startedAt && timed(t));
    if (started && now < p.runEnd) return "running";
    // Started early ("Empezar temprano") and already over before its scheduled time: its check-in is due, not "upcoming".
    if (now < p.remind && !started) return "upcoming";
    if (timed(t) ? !t.startedAt && now < p.ask : now < p.ask) return "due";
    return now < p.until ? "asking" : "unconfirmed";
  }
  // Applies an answer to a copy of the task and returns it (null if the answer is unknown).
  // est and real minutes are kept with every close, to learn how long things really take.
  function apply(t0, a, now) {
    const t = { ...t0 }, log = (ev, v) => { t.history = [...(t.history || []), v == null ? { at: iso(now), ev } : { at: iso(now), ev, v }].slice(-20); };
    const close = (how) => {
      const from = ms(t.startedAt);
      t.close = { how, at: iso(now), est: Number(t.dur) || null, real: from ? Math.max(1, Math.round((now - from) / MIN)) : null };
      t.done = how === "done" || how === "half"; t.snooze = null; t.again = null; log(how);
    };
    const [k, arg] = String(a).split(":");
    switch (k) {
      case "go": log("go"); break; // "Voy ahora": nothing closes; the question still comes
      case "start": t.startedAt = iso(now); t.snooze = null; t.again = null; t.ext = 0; log("start"); break;
      case "yes": case "finished": case "done": if (!closed(t)) close("done"); break;
      case "half": if (!closed(t)) close("half"); break;
      case "notdone": if (!closed(t)) close("notdone"); break;
      case "skip": if (!closed(t)) close("skip"); break;
      case "notyet": case "later": t.again = iso(now + AGAIN * MIN); log(k); break;
      case "more": t.ext = Math.min(MAX_EXT, (Number(t.ext) || 0) + 1); t.again = null; log("more", t.ext); break;
      case "outcome": if (t.close && (outcomes(t).includes(arg) || !arg)) { t.close = { ...t.close, outcome: arg || null }; log("outcome", arg || null); } break;
      case "reopen": t.close = null; t.done = false; t.startedAt = null; t.again = null; t.ext = 0; log("reopen"); break;
      default: return null;
    }
    return t;
  }
  // ---- The person's routine (Ajustes > Tu rutina, from Pendi's interview) ----
  // SLEEP is a hard rule: Pendi never proposes a time inside it, warns once if the person picks one, and sends no new
  // non-critical push in the 40 min before bedtime (the calm shoulder). WORK is a soft rule: Pendi proposes only light
  // tasks (5 min or less) there and asks once if the person picks it for a longer one; it never blocks.
  // Times are "HH:MM" in the person's own clock; days are "YYYY-MM-DD".
  const CALM = 40; // minutes before bedtime with no new non-critical push
  const LIGHT = 5; // a light task lasts 5 minutes or less
  const LUNCH = 60; // the lunch break inside work hours
  const toM = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ""); return m ? +m[1] * 60 + +m[2] : NaN; };
  const dowOf = (k) => new Date(k + "T12:00:00Z").getUTCDay();
  const dayAdd = (k, n) => new Date(Date.parse(k + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const okPair = (x) => x && !isNaN(toM(x.up)) && !isNaN(toM(x.bed)) && x.up !== x.bed;
  const sleepOf = (s) => { const r = s && s.routine && s.routine.sleep; return okPair(r) ? r : null; };
  const workOf = (s) => { const w = s && s.routine && s.routine.work; return w && w.kind !== "none" && !isNaN(toM(w.from)) && !isNaN(toM(w.to)) && w.from !== w.to ? w : null; };
  const light = (t) => (Number(t && t.dur) || 30) <= LIGHT;
  // The night that starts on day k: Friday and Saturday nights use the weekend hours, if the person gave them.
  const nightOf = (r, k) => { const d = dowOf(k); return (d === 5 || d === 6) && okPair(r.we) ? r.we : r; };
  // Sleep spans in minutes from day k's midnight: the night before (ends this morning) and tonight's.
  // A bedtime earlier than the wake-up time (01:00 → 09:00) falls after midnight.
  function sleepSpans(r, k) {
    return [-1, 0].map((off) => {
      const n = nightOf(r, dayAdd(k, off)), b = toM(n.bed), u = toM(n.up), base = off * 1440;
      return b > u ? [base + b, base + 1440 + u] : [base + 1440 + b, base + 1440 + u];
    });
  }
  const hit = (spans, m, len) => spans.some(([a, b]) => (len > 0 ? m < b && m + len > a : m >= a && m < b));
  // Does a time (and, with len, the whole task) fall inside the sleep window?
  function inSleep(s, k, hm, len) { const r = sleepOf(s), m = toM(hm); return !!r && !isNaN(m) && hit(sleepSpans(r, k), m, len || 0); }
  // The calm shoulder: the 40 minutes before going to bed.
  function inCalm(s, k, hm) { const r = sleepOf(s), m = toM(hm); return !!r && !isNaN(m) && hit(sleepSpans(r, k).map(([a]) => [a - CALM, a]), m, 0); }
  // Work hours on a work day (minus lunch); a shift may end after midnight.
  function inWork(s, k, hm, len) {
    const w = workOf(s), m = toM(hm); if (!w || isNaN(m)) return false;
    const days = Array.isArray(w.days) ? w.days : [1, 2, 3, 4, 5], spans = [];
    for (const off of [-1, 0]) {
      if (!days.includes(dowOf(dayAdd(k, off)))) continue;
      const f = toM(w.from), t = toM(w.to), base = off * 1440, a = base + f, b = base + (f < t ? t : t + 1440), l = toM(w.lunch);
      let L = isNaN(l) ? NaN : base + l; if (L < a) L += 1440;
      if (L >= a && L < b) spans.push([a, L], [L + LUNCH, b]); else spans.push([a, b]);
    }
    return hit(spans.filter(([a, b]) => b > a), m, len || 0);
  }
  // Wake-up time on day k, and tonight's bedtime (it may be after midnight).
  const wakeOf = (s, k) => { const r = sleepOf(s); return r ? nightOf(r, dayAdd(k, -1)).up : null; };
  const bedOf = (s, k) => { const r = sleepOf(s); return r ? nightOf(r, k).bed : null; };
  // Summaries anchored to sleep: the morning one 15 min after waking up, the evening one 45 min before bed (the start
  // of the calm time). An evening time that would fall after midnight goes at 23:45. Without sleep hours: null.
  function briefTimes(s, k) {
    const r = sleepOf(s); if (!r) return null;
    const hh = (x) => String(Math.floor(x / 60)).padStart(2, "0") + ":" + String(x % 60).padStart(2, "0");
    const n = nightOf(r, k), b = toM(n.bed), late = b <= toM(n.up);
    let e = b - 45; if (late || e < 0) e = late && e >= 0 ? 23 * 60 + 45 : (e + 1440) % 1440;
    return { m: hh(Math.min(23 * 60 + 59, toM(wakeOf(s, k)) + 15)), e: hh(e) };
  }

  // A new time or day starts the cycle again.
  const fresh = (t) => ({ ...t, done: false, close: null, snooze: null, startedAt: null, again: null, ext: 0, openSeen: false });
  g.PendiFlow = { CALM, LIGHT, toM, dayAdd, sleepOf, workOf, light, inSleep, inCalm, inWork, wakeOf, bedOf, briefTimes, LEVELS, LEADS, fromRemind, levelOf, levelFor, pushes, MIN, TIMED, ASK_AFTER, AGAIN, EXTRA, MAX_EXT, SILENT, WINDOW, timed, closed, outcomes, asksHow, good, anchor, plan, phase, apply, fresh };
})(typeof self !== "undefined" ? self : globalThis);
