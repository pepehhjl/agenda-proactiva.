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

  // The reminder's time: the task's time, or the later postponed one.
  function anchor(t) { const s = ms(t.start), z = ms(t.snooze); return z > s ? z : s; }
  // When each notification is due (ask: the question or check-in, ask2: the one repeat) and when silence
  // turns into "Sin confirmar" (until). runEnd: when a started task is expected to finish.
  function plan(t) {
    const a = anchor(t), again = ms(t.again), ext = Number(t.ext) || 0;
    if (!timed(t)) {
      const ask = a + ASK_AFTER * MIN, ask2 = again > ask ? again : NaN;
      return { remind: a, ask, ask2, until: (ask2 || ask) + SILENT * MIN, runEnd: NaN };
    }
    const base = ms(t.startedAt) || a, end = base + (Number(t.dur) || 30) * MIN, runEnd = end + ext * EXTRA * MIN;
    // After "Sigo en eso", the next question comes when the extra time is over (the first check-in is already used).
    const ask = ext ? NaN : end;
    const ask2 = ext ? Math.max(runEnd, again || 0) : again > end ? again : end + AGAIN * MIN;
    return { remind: a, ask, ask2, until: ask2 + SILENT * MIN, runEnd };
  }
  // closed | open (no time) | upcoming | running | due (reminded, not asked yet) | asking | unconfirmed
  function phase(t, now) {
    if (closed(t)) return "closed";
    if (t.anytime || !t.start) return "open";
    const p = plan(t);
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
  // A new time or day starts the cycle again.
  const fresh = (t) => ({ ...t, done: false, close: null, snooze: null, startedAt: null, again: null, ext: 0, openSeen: false });
  g.PendiFlow = { MIN, TIMED, ASK_AFTER, AGAIN, EXTRA, MAX_EXT, SILENT, WINDOW, timed, closed, outcomes, asksHow, good, anchor, plan, phase, apply, fresh };
})(typeof self !== "undefined" ? self : globalThis);
