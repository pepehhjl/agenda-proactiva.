// Notification texts in the language the app is shown in (settings.uiLang). Spanish when unknown.
const T = {
  es: {
    reminder: "Recordatorio", inHour: "En 1 hora", inMin: "En {n} min", at: "A las {t}", isAt: "Es a las {t}", wasAt: "Era a las {t}",
    bday2: "En 2 días cumple {n} 🎂", bday2Body: "¿Elegimos un regalo? Toca para ver ideas.",
    bday0: "Hoy cumple {n} 🎉", bday0Body: "Toca para ver un mensaje listo para enviarle.",
    testTitle: "Prueba de aviso", testBody: "Así te voy a avisar antes de cada cosa.",
    snooze: "Posponer 10 min", done: "Hecho",
    mTitle: "☀️ Buenos días", mOne: "Hoy tienes 1 cosa: {x}, a las {t}.", mMany: "Hoy tienes {n} cosas. La primera, a las {t}: {x}.", mNoTime: "Hoy tienes {n} cosas, sin hora fija.",
    mFree: "Hoy tienes el día libre. ¿Organizamos algo?", mStar: "⭐ No olvides: {x}.",
    eTitle: "🌙 Cierre del día", eOne: "Te queda 1 pendiente de hoy. ¿Lo paso a mañana?", eMany: "Te quedan {n} pendientes de hoy. ¿Los paso a mañana?",
    eDoneTitle: "🎉 ¡Día completo!", eDoneBody: "Hiciste todo lo de hoy. ¡A descansar!",
    wTitle: "📊 Tu semana", wBody: "Hiciste {d} de {t} cosas. La próxima semana trae {n}. Toca para verla.",
  },
  en: {
    reminder: "Reminder", inHour: "In 1 hour", inMin: "In {n} min", at: "At {t}", isAt: "It's at {t}", wasAt: "It was at {t}",
    bday2: "{n}'s birthday is in 2 days 🎂", bday2Body: "Shall we pick a gift? Tap to see ideas.",
    bday0: "It's {n}'s birthday today 🎉", bday0Body: "Tap to see a message ready to send.",
    testTitle: "Test notification", testBody: "This is how I'll remind you before each thing.",
    snooze: "Snooze 10 min", done: "Done",
    mTitle: "☀️ Good morning", mOne: "Today you have 1 thing: {x}, at {t}.", mMany: "Today you have {n} things. The first, at {t}: {x}.", mNoTime: "Today you have {n} things, no set times.",
    mFree: "Your day is free today. Shall we plan something?", mStar: "⭐ Don't forget: {x}.",
    eTitle: "🌙 End of the day", eOne: "1 thing is left from today. Move it to tomorrow?", eMany: "{n} things are left from today. Move them to tomorrow?",
    eDoneTitle: "🎉 Day complete!", eDoneBody: "You did everything today. Time to rest!",
    wTitle: "📊 Your week", wBody: "You did {d} of {t} things. Next week brings {n}. Tap to see it.",
  },
  pt: {
    reminder: "Lembrete", inHour: "Em 1 hora", inMin: "Em {n} min", at: "Às {t}", isAt: "É às {t}", wasAt: "Era às {t}",
    bday2: "Daqui a 2 dias é o aniversário de {n} 🎂", bday2Body: "Vamos escolher um presente? Toque para ver ideias.",
    bday0: "Hoje é o aniversário de {n} 🎉", bday0Body: "Toque para ver uma mensagem pronta para enviar.",
    testTitle: "Aviso de teste", testBody: "É assim que vou te avisar antes de cada coisa.",
    snooze: "Adiar 10 min", done: "Feito",
    mTitle: "☀️ Bom dia", mOne: "Hoje você tem 1 coisa: {x}, às {t}.", mMany: "Hoje você tem {n} coisas. A primeira, às {t}: {x}.", mNoTime: "Hoje você tem {n} coisas, sem hora fixa.",
    mFree: "Hoje seu dia está livre. Vamos organizar algo?", mStar: "⭐ Não esqueça: {x}.",
    eTitle: "🌙 Fim do dia", eOne: "Falta 1 coisa de hoje. Passo para amanhã?", eMany: "Faltam {n} coisas de hoje. Passo para amanhã?",
    eDoneTitle: "🎉 Dia completo!", eDoneBody: "Você fez tudo hoje. Hora de descansar!",
    wTitle: "📊 Sua semana", wBody: "Você fez {d} de {t} coisas. A próxima semana traz {n}. Toque para ver.",
  },
  fr: {
    reminder: "Rappel", inHour: "Dans 1 heure", inMin: "Dans {n} min", at: "À {t}", isAt: "C'est à {t}", wasAt: "C'était à {t}",
    bday2: "L'anniversaire de {n} est dans 2 jours 🎂", bday2Body: "On choisit un cadeau ? Touche pour voir des idées.",
    bday0: "C'est l'anniversaire de {n} aujourd'hui 🎉", bday0Body: "Touche pour voir un message prêt à envoyer.",
    testTitle: "Rappel de test", testBody: "C'est comme ça que je te préviendrai avant chaque chose.",
    snooze: "Reporter 10 min", done: "Fait",
    mTitle: "☀️ Bonjour", mOne: "Aujourd'hui tu as 1 chose : {x}, à {t}.", mMany: "Aujourd'hui tu as {n} choses. La première, à {t} : {x}.", mNoTime: "Aujourd'hui tu as {n} choses, sans heure fixe.",
    mFree: "Ta journée est libre. On organise quelque chose ?", mStar: "⭐ N'oublie pas : {x}.",
    eTitle: "🌙 Fin de journée", eOne: "Il te reste 1 chose d'aujourd'hui. Je la passe à demain ?", eMany: "Il te reste {n} choses d'aujourd'hui. Je les passe à demain ?",
    eDoneTitle: "🎉 Journée complète !", eDoneBody: "Tu as tout fait aujourd'hui. Repos !",
    wTitle: "📊 Ta semaine", wBody: "Tu as fait {d} choses sur {t}. La semaine prochaine en a {n}. Touche pour voir.",
  },
};

export const texts = (lang) => {
  const d = T[lang] || T.es;
  return (key, vars = {}) => d[key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
};
// Labels for the buttons on a task notification (read by sw.js).
export const actionLabels = (lang) => { const tr = texts(lang); return { snoozeLabel: tr("snooze"), doneLabel: tr("done") }; };
