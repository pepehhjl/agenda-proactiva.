// Notification texts in the language the app is shown in (settings.uiLang). Spanish when unknown.
const T = {
  es: {
    reminder: "Recordatorio", inHour: "En 1 hora", inMin: "En {n} min", at: "A las {t}", isAt: "Es a las {t}", wasAt: "Era a las {t}",
    bday2: "En 2 días cumple {n} 🎂", bday2Body: "¿Elegimos un regalo? Toca para ver ideas.",
    bday0: "Hoy cumple {n} 🎉", bday0Body: "Toca para ver un mensaje listo para enviarle.",
    testTitle: "Prueba de aviso", testBody: "Así te voy a avisar antes de cada cosa.",
    snooze: "Posponer 10 min", done: "Hecho",
  },
  en: {
    reminder: "Reminder", inHour: "In 1 hour", inMin: "In {n} min", at: "At {t}", isAt: "It's at {t}", wasAt: "It was at {t}",
    bday2: "{n}'s birthday is in 2 days 🎂", bday2Body: "Shall we pick a gift? Tap to see ideas.",
    bday0: "It's {n}'s birthday today 🎉", bday0Body: "Tap to see a message ready to send.",
    testTitle: "Test notification", testBody: "This is how I'll remind you before each thing.",
    snooze: "Snooze 10 min", done: "Done",
  },
  pt: {
    reminder: "Lembrete", inHour: "Em 1 hora", inMin: "Em {n} min", at: "Às {t}", isAt: "É às {t}", wasAt: "Era às {t}",
    bday2: "Daqui a 2 dias é o aniversário de {n} 🎂", bday2Body: "Vamos escolher um presente? Toque para ver ideias.",
    bday0: "Hoje é o aniversário de {n} 🎉", bday0Body: "Toque para ver uma mensagem pronta para enviar.",
    testTitle: "Aviso de teste", testBody: "É assim que vou te avisar antes de cada coisa.",
    snooze: "Adiar 10 min", done: "Feito",
  },
  fr: {
    reminder: "Rappel", inHour: "Dans 1 heure", inMin: "Dans {n} min", at: "À {t}", isAt: "C'est à {t}", wasAt: "C'était à {t}",
    bday2: "L'anniversaire de {n} est dans 2 jours 🎂", bday2Body: "On choisit un cadeau ? Touche pour voir des idées.",
    bday0: "C'est l'anniversaire de {n} aujourd'hui 🎉", bday0Body: "Touche pour voir un message prêt à envoyer.",
    testTitle: "Rappel de test", testBody: "C'est comme ça que je te préviendrai avant chaque chose.",
    snooze: "Reporter 10 min", done: "Fait",
  },
};

export const texts = (lang) => {
  const d = T[lang] || T.es;
  return (key, vars = {}) => d[key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
};
// Labels for the buttons on a task notification (read by sw.js).
export const actionLabels = (lang) => { const tr = texts(lang); return { snoozeLabel: tr("snooze"), doneLabel: tr("done") }; };
