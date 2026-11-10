/**
 * System prompts per Termi assistant task — a thin derived map over
 * `composePrompt`/`TERMI_TASKS` (`./tasks.js`) kept for existing importers
 * that want the plain `ask` task's prompt without a request's today/tz.
 */
import { env } from '$env/dynamic/private';
import { TERMI_TASKS, composePrompt } from './tasks.js';

const appName = env.APP_NAME || 'Edufeed';

export const SYSTEM_PROMPTS = Object.fromEntries(
  /** @type {(keyof typeof TERMI_TASKS)[]} */ (Object.keys(TERMI_TASKS)).map((task) => [
    task,
    composePrompt(task, { appName })
  ])
);

/**
 * /api/termi/extract — calendar events from a dropped file's text. Not a chat
 * task, so it stays out of TERMI_TASKS (whose keys are the chat tasks).
 */
export const EXTRACT_EVENTS_PROMPT = `Du liest Text aus einer Datei (Tabelle, Dokument, PDF oder Kalender) und gibst die darin genannten Termine als JSON zurück: {"events": [...]}.

Datumsangaben ohne Jahr beziehen sich auf das nächste zukünftige Vorkommen ab dem heutigen Datum (steht in der Nachricht). Bei mehrdeutigen Datumsangaben wie 01/02 gilt in der Locale de Tag-zuerst, in en Monat-zuerst.

Regeln:
- Ein Objekt pro Termin mit title, startDate und, wenn vorhanden, startTime, endDate, endTime, allDay, location, description.
- Datum als YYYY-MM-DD, Uhrzeit als HH:MM (24 Stunden), so wie sie in der Quelle steht (Ortszeit, nicht umrechnen).
- Excel-Datumswerte können als Seriennummern erscheinen (z. B. 46275.375 = Tage seit 1899-12-30, der Nachkommaanteil ist die Uhrzeit): rechne sie in Datum und Uhrzeit um.
- allDay: true, wenn die Quelle keine Uhrzeit nennt.
- endDate weglassen, wenn der Termin am selben Tag endet.
- Erfinde niemals Termine. Was nicht in der Quelle steht, gibst du nicht aus.
- Überspringe Überschriften, Legenden, Summen und Beschreibungen von Wiederholungsregeln; bei wiederkehrenden Terminen nur das erste Vorkommen.
- Titel so übernehmen, wie sie geschrieben sind.
- location nur, wenn ein Ort genannt ist.
- Findest du keine Termine, antworte mit {"events": []}.
- Antworte nur mit dem JSON-Objekt, ohne weiteren Text.`;

/**
 * @param {string} filename
 * @param {string} today YYYY-MM-DD
 * @param {'de' | 'en'} locale
 * @param {string} tz
 * @param {string} text
 * @param {string} [instruction] the user's typed note to the file, already capped
 */
export function extractUserPrompt(filename, today, locale, tz, text, instruction) {
  const hint = instruction
    ? `\nHinweis der Nutzerin/des Nutzers: «${instruction}» — befolge ihn bei der Auswahl und Deutung der Termine, erfinde aber keine Termine.`
    : '';
  return `Heute ist ${today}. Locale: ${locale}. Zeitzone: ${tz}.\nDatei: ${filename}${hint}\n\n<datei>\n${text}\n</datei>`;
}
