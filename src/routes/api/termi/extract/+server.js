/**
 * POST /api/termi/extract — calendar events from a dropped file's text, read
 * by the Termi model on SAIA. Body `{ text, filename, locale, today, tz, instruction? }`
 * (instruction = the user's typed note, trimmed and capped at 500 chars),
 * NIP-98 signed over the raw body; same gate and quota as /api/termi/chat
 * (`authorize.js`), one quota step per request.
 *
 * 503 LLM off · 401/403/503/429 see authorizeTermiRequest · 400 `invalid_body`
 * · 502 `termi:upstream`. Answers `{ events }` (raw rows; the client
 * validates them). The file text is never logged.
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { APICallError, NoObjectGeneratedError, Output, generateText, jsonSchema } from 'ai';
import { createTermiModel } from '$lib/server/termi/llm.js';
import { authorizeTermiRequest, termiQuota } from '$lib/server/termi/authorize.js';
import { EXTRACT_EVENTS_PROMPT, extractUserPrompt } from '$lib/server/termi/prompts.js';

const MAX_TEXT_CHARS = 64_000;
// A hung SAIA call must not hold the request (and the user's bubble) open forever.
const EXTRACT_TIMEOUT_MS = 60_000;
// JSON escaping can double the text (newlines, quotes).
const MAX_BODY_CHARS = 2 * MAX_TEXT_CHARS + 2_000;

const str = /** @type {const} */ ({ type: 'string' });
/** @type {import('ai').JSONSchema7} */
const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: str,
          startDate: str,
          startTime: str,
          endDate: str,
          endTime: str,
          allDay: { type: 'boolean' },
          location: str,
          description: str
        },
        required: ['title', 'startDate']
      }
    }
  },
  required: ['events']
};

/** @param {any} b */
function isValidBody(b) {
  return (
    typeof b?.text === 'string' &&
    b.text.length <= MAX_TEXT_CHARS &&
    typeof b.filename === 'string' &&
    b.filename.length > 0 &&
    b.filename.length <= 200 &&
    (b.locale === 'de' || b.locale === 'en') &&
    typeof b.today === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(b.today) &&
    typeof b.tz === 'string' &&
    b.tz.length > 0 &&
    b.tz.length <= 64
  );
}

/** A provider that cannot do `response_format: json_schema`. @param {unknown} err */
function isStructuredOutputRejected(err) {
  if (NoObjectGeneratedError.isInstance(err)) return true;
  return (
    APICallError.isInstance(err) &&
    err.statusCode === 400 &&
    /response_format/.test(`${err.message} ${err.responseBody ?? ''}`)
  );
}

/** @param {string} text @returns {unknown[] | null} */
function parseEventsFromText(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const events = JSON.parse(text.slice(start, end + 1))?.events;
    return Array.isArray(events) ? events : null;
  } catch {
    return null;
  }
}

/** Status only: the error's request body carries the file text. @param {unknown} err */
function logUpstream(err) {
  const e = /** @type {{ statusCode?: number, name?: string } | null} */ (
    err && typeof err === 'object' ? err : null
  );
  console.error('[/api/termi/extract] upstream failed:', e?.statusCode ?? e?.name ?? 'unknown');
}

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function POST({ request }) {
  const model = createTermiModel(env);
  if (!model) return json({ error: 'termi_llm_disabled' }, { status: 503 });

  const rawBody = await request.text();
  if (!rawBody || rawBody.length > MAX_BODY_CHARS) {
    return json({ error: 'invalid_body' }, { status: 400 });
  }

  const auth = await authorizeTermiRequest(request, rawBody);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_body' }, { status: 400 });
  }
  if (!isValidBody(body)) return json({ error: 'invalid_body' }, { status: 400 });

  termiQuota.charge(auth.pubkey);
  const base = {
    model,
    system: EXTRACT_EVENTS_PROMPT,
    prompt: extractUserPrompt(
      body.filename,
      body.today,
      body.locale,
      body.tz,
      body.text,
      typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 500) : undefined
    ),
    // The client handles errors; a retry would only spend SAIA budget.
    maxRetries: 0,
    temperature: 0
  };

  try {
    const result = await generateText({
      ...base,
      abortSignal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
      output: Output.object({ schema: jsonSchema(EXTRACT_SCHEMA) })
    });
    const events = /** @type {any} */ (result.output)?.events;
    if (Array.isArray(events)) return json({ events });
    // An object without an events array: retry in plain text like a rejection.
  } catch (err) {
    if (!isStructuredOutputRejected(err)) {
      logUpstream(err);
      return json({ error: 'termi:upstream' }, { status: 502 });
    }
  }

  // One plain retry for providers without structured output.
  try {
    const result = await generateText({
      ...base,
      abortSignal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS)
    });
    const events = parseEventsFromText(result.text);
    if (events) return json({ events });
    logUpstream({ name: 'unparseable' });
  } catch (err) {
    logUpstream(err);
  }
  return json({ error: 'termi:upstream' }, { status: 502 });
}
