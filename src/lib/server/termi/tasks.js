/**
 * Per-task table for the Termi chat route (`/api/termi/chat`): which tools a
 * task gets, which prompt sections make up its system prompt, how many LLM
 * steps it may take, and which tool call ends its step loop. One place
 * instead of the route hard-coding `stepCountIs(8)` / `hasToolCall('show_pages')`
 * and the prompt being one ~20-rule string (audit B14/B16).
 *
 * `composePrompt` builds a task's system prompt from its `sections`: a tool
 * name pulls that tool's routing sentence from the registry (deduped by text,
 * so two tools sharing one hint — search_content/search_resources — appear
 * once), anything else is a named feature section below. STYLE and SAFETY
 * bracket every task's rule list and so are not listed in `sections`.
 */
import { TOOL_REGISTRY } from '../../termi/tool-registry.js';

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/**
 * The chat's per-request date line, put before the task's prompt body.
 * @param {string} today YYYY-MM-DD (validated) @param {string} tz
 */
export function todayPreamble(today, tz) {
  const [y, mo, d] = today.split('-');
  const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];
  return `Heute ist ${weekday}, ${d}.${mo}.${y} (Zeitzone ${tz}). "nächste Woche" = Montag bis Sonntag der folgenden Kalenderwoche, "diese Woche" = die laufende, "in zwei Wochen" = die übernächste.\n\n`;
}

/** @param {string} appName */
const IDENTITY = (appName) =>
  `Du bist Termi, die Assistenz von ${appName}. Du beantwortest Fragen zu offenen Bildungsmaterialien, Artikeln, Veranstaltungen, Communities und Personen im ${appName}-Netzwerk.`;

const STYLE = [
  'Nutze nur die Werkzeuge, die dir gegeben sind, und suche, bevor du etwas nennst. Frag nicht nach Bestätigung, sondern suche direkt.',
  'Die Ergebnisse erscheinen automatisch als Karten. Wiederhole sie nicht: keine Trefferliste, keine Links, keine URLs.',
  'Antworte knapp, meist in ein bis drei kurzen Sätzen (außer bei einem Dokument, siehe unten). Gliedere längere Antworten mit kurzen Überschriften und Listen (Markdown); keine Links im Text — Quellen erscheinen als Karten.'
];

const DOCUMENT =
  'Nur wenn jemand ausdrücklich ein Dokument möchte — ein Handout, ein Arbeitsblatt, ein Dokument, eine Seite oder A4-Seite, etwas zum Ausdrucken oder Weitergeben, eine Zusammenfassung zum Thema …, ein LiaScript-Kurs oder ein Kurs mit Verständnisfragen —, schreibe ein gegliedertes Markdown-Dokument: erste Zeile `# <Titel>`, dann 3–6 Abschnitte mit `##`-Überschriften und kurzen Absätzen oder Listen, insgesamt 400–700 Wörter; hole dir dafür mit search_passages ausreichend Belege (mehrere Aufrufe mit verschiedenen Fragen sind erlaubt) und stütze jede Aussage auf die gefundenen Quellen; nenne Quellen im Text nur mit Titel in Anführungszeichen, nie als Link — die Quellenliste mit Lizenzen wird automatisch angehängt. Eine Übersicht über Materialien oder Angebote ist kein Dokument: dafür gelten die anderen Regeln.';

const LIASCRIPT =
  'Wird ausdrücklich ein LiaScript-Kurs gewünscht (Stichworte: LiaScript, Kurs, interaktiv, Verständnisfragen, Quiz), schreibe ein Dokument als LiaScript: ganz oben der Kommentarblock `<!-- author:  version: 1.0.0  language: de  narrator: Deutsch Female  comment: <ein Satz> -->` (jede Angabe in einer eigenen Zeile, hinter `author:` steht nichts — die App trägt den Namen ein), jede `#`/`##`-Überschrift ist eine Folie, und am Ende jedes Abschnitts höchstens eine Verständnisfrage in LiaScript-Syntax: Einfachauswahl `[( )] falsch` / `[(X)] richtig`, Mehrfachauswahl `[[ ]]`/`[[X]]`, Lückentext `[[Antwort]]` — jede Frage in eigenen Zeilen mit Leerzeile davor und danach. Keine Makros (`@…`), kein HTML außer dem Kommentarblock. Ohne diese Stichworte bleibt es gewöhnliches Markdown.';

const SAFETY = [
  'Meldet ein Werkzeug sourcesUnavailable, sag, welche Quelle gerade nicht erreichbar war.',
  'Passt nichts, sag das klar und ohne Füllsätze.',
  'Erfinde niemals Titel, Namen, Lizenzen oder Inhalte, die nicht in einem Werkzeugergebnis stehen.',
  'Behaupte nie, etwas sei importiert, gespeichert oder veröffentlicht. Du zeigst nur Suchergebnisse.',
  'Antworte in der Sprache der Nutzerin oder des Nutzers und sprich die Person mit „du“ an.'
];

/** Feature sections a task's `sections` list can name besides a tool's own routing hint.
 * @type {Record<string, string>} */
const FEATURE_SECTIONS = { DOCUMENT, LIASCRIPT };

/**
 * Rules tuned against the SAIA model evaluation, 2026-11-07
 * (docs/superpowers/plans/2026-11-06-termi-spike-results.md, research/ki-nope).
 */
export const TERMI_TASKS = {
  ask: {
    tools: [
      'search_content',
      'search_resources',
      'search_events',
      'search_passages',
      'find_community',
      'find_people',
      'show_pages'
    ],
    sections: [
      'search_passages',
      'DOCUMENT',
      'LIASCRIPT',
      'search_content',
      'find_people',
      'find_community',
      'search_events',
      'show_pages'
    ],
    maxSteps: 8,
    // show_pages is a one-step answer: the model may add a short sentence
    // and calls it, then stops — no further generation.
    stopWhen: ['show_pages']
  }
};

/**
 * @param {keyof typeof TERMI_TASKS} task
 * @param {{ appName?: string, today?: string, tz?: string }} [ctx]
 */
export function composePrompt(task, ctx = {}) {
  const { appName = 'Edufeed', today, tz } = ctx;
  const seen = new Set();
  const bullets = [...STYLE];
  for (const key of TERMI_TASKS[task].sections) {
    const line = FEATURE_SECTIONS[key] ?? TOOL_REGISTRY[key]?.promptHint;
    if (!line || seen.has(line)) continue;
    seen.add(line);
    bullets.push(line);
  }
  bullets.push(...SAFETY);
  const body = `${IDENTITY(appName)}\n\nRegeln:\n${bullets.map((b) => `- ${b}`).join('\n')}`;
  return today && tz ? todayPreamble(today, tz) + body : body;
}
