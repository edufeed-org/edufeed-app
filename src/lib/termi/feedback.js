// Termi answer feedback: which turns can be rated, and the text of the NIP-17
// message a rating becomes — a short German header for the person reading it
// and one fenced JSON object in the shape of an eval fixture
// (scripts/fixtures/termi-questions.json: text, history, lesson).
import { priorMessages } from './prior-turns.js';
import { NADDR_KEYS } from './lesson-state.js';
import { toolNameOf } from './tool-registry.js';

export const FEEDBACK_REASONS = ['nothing_found', 'wrong', 'not_asked', 'too_long_vague', 'other'];
export const FEEDBACK_MAX_BYTES = 20000;
export const FEEDBACK_COMMENT_MAX = 1000;

// For the reader of the message, not UI copy: the dialog's chips come from Paraglide.
/** @type {Record<string, string>} */
const REASON_LABELS = {
  nothing_found: 'Nichts Passendes gefunden',
  wrong: 'Inhaltlich falsch',
  not_asked: 'Nicht das, was ich gefragt habe',
  too_long_vague: 'Zu lang oder zu ungenau',
  other: 'Sonstiges'
};

/** @typedef {import('../components/assistant/history/conversation-codec.js').Turn} Turn */

// A model answer carries `model`; a tier-1 search answer carries `sourcesUnavailable` (an array,
// zero hits included) or, restored from the history, its `items`. Canned and router replies have neither.
/** @param {Turn} turn */
export function isRateable(turn) {
  if (turn?.role !== 'assistant') return false;
  if (turn.import || turn.error || turn.pending || turn.textStub) return false;
  const searched = Array.isArray(turn.sourcesUnavailable) || !!turn.items?.length;
  const failed = !turn.items?.length && !!turn.sourcesUnavailable?.includes('search');
  return !!turn.model || (searched && !failed);
}

const bytes = (/** @type {string} */ s) => new TextEncoder().encode(s).length;
/** `over` UTF-8 bytes off the end, never half a character. */
const cut = (/** @type {string} */ s, /** @type {number} */ over) => {
  const all = new TextEncoder().encode(s);
  return new TextDecoder()
    .decode(all.subarray(0, Math.max(0, all.length - over)))
    .replace(/\uFFFD+$/, '');
};
/** A turn as the model would read it: its text plus the titles of its hits. @param {Turn[]} turns */
const asText = (turns) =>
  priorMessages(turns).map((msg) => ({
    role: msg.role,
    text: /** @type {any} */ (msg.parts[0]).text
  }));

/**
 * @param {{
 *   vote: 'up' | 'down', reason?: string | null, comment?: string | null,
 *   turn: Turn, turns: Turn[],
 *   task?: 'ask' | 'lesson' | null, lesson?: object | null,
 *   attach: boolean, named: boolean, appVersion: string, now?: Date
 * }} input `turns` is the whole chat in order and contains `turn`; `lesson` is the state at send time
 * @returns {string} the header, then exactly one ```json fenced object, at most FEEDBACK_MAX_BYTES
 */
export function buildFeedbackBody({
  vote,
  reason = null,
  comment = null,
  turn,
  turns,
  task = null,
  lesson = null,
  attach,
  named,
  appVersion,
  now = new Date()
}) {
  comment = comment?.trim().slice(0, FEEDBACK_COMMENT_MAX) || null;
  /** @type {Record<string, any>} */
  const data = {
    vote,
    reason: reason || null,
    comment,
    // only by name: the id would tie an unnamed rating to a named one of the same answer
    ...(named ? { answerId: turn.id ?? null } : {}),
    model: turn.model ?? null,
    fallback: turn.fallback?.from ?? null,
    task,
    tools: [...new Set((turn.toolParts ?? []).map(toolNameOf).filter(Boolean))],
    appVersion,
    at: now.toISOString()
  };
  if (attach) {
    // the window's turns are re-projected on every change: the id is the identity
    let at = turns.indexOf(turn);
    if (at < 0 && turn.id) at = turns.findIndex((t) => t.id === turn.id);
    const asked = turns.findLastIndex((t, i) => i < at && t.role === 'user');
    data.text = asked < 0 ? '' : (turns[asked].text ?? '');
    data.answer = asText([turn])[0]?.text ?? '';
    // uploaded material and import turns never leave the device this way: neither the import's
    // card nor the question right before it (the instruction typed for the file)
    const before = turns.slice(0, Math.max(asked, 0));
    data.history = asText(before.filter((t, i) => !t.import && !before[i + 1]?.import));
    // the address fields name her pubkey: stripped also from a named message, a fixture has no use for them
    if (lesson)
      data.lesson = JSON.parse(
        JSON.stringify(lesson, (k, v) => (NADDR_KEYS.has(k) ? undefined : v))
      );
  }

  const head = [
    `Termi-Feedback ${vote === 'up' ? '👍' : `👎 — ${(reason && REASON_LABELS[reason]) || 'ohne Angabe'}`}`,
    `Modell: ${data.model ?? '–'} · Aufgabe: ${task ?? 'Suche'} · App ${appVersion}`,
    '',
    'Kommentar:',
    // the header must not open a fence of its own
    comment?.replaceAll('```', "'''") ?? '–',
    '',
    ''
  ].join('\n');
  const render = () => {
    // a backtick as \u0060 is the same JSON string, and no text can close the fence early
    const body = `${head}\`\`\`json\n${JSON.stringify(data, null, 2).replaceAll('`', '\\u0060')}\n\`\`\``;
    // these name an account (an naddr or nevent its author): an unnamed message carries none, wherever it stood
    return named ? body : body.replace(/\b(naddr|npub|nprofile|nevent)1[0-9a-z]+/gi, '$1…');
  };

  let body = render();
  for (let over; (over = bytes(body) - FEEDBACK_MAX_BYTES) > 0; body = render()) {
    if (!data.truncated) data.truncated = true;
    else if (data.history?.length) data.history.shift();
    // the planning state before any of the rated exchange: it is today's state, not the question's
    else if (data.lesson) delete data.lesson;
    else if (data.answer) data.answer = cut(data.answer, over);
    else if (data.text) data.text = cut(data.text, over);
    else break;
  }
  return body;
}
