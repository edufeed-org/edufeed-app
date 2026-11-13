/**
 * POST /api/termi/chat — the Termi assistant. Body `{ task, messages, model?, today?, tz?, lesson?, materials?, locale?, focus? }`
 * (AI SDK v6 UIMessages; today = the browser's YYYY-MM-DD, tz its IANA zone; lesson/materials/locale
 * feed the `lesson` prompt: 400 `invalid_materials` for > 3 files or a bad shape; focus = the open
 * Werkbank part `{ key, text }`, both tasks), NIP-98 signed over the raw body; answers with a UI
 * message stream. `model` is a catalog id (`saia:…` / `anthropic:…`, see `termi/models.js`; default
 * the first SAIA model): 400 `invalid_model` for an id the catalog does not know, 403
 * `model_not_allowed` for an `anthropic:` id unless the signer is on the access list — both before any
 * model call or quota step. A SAIA choice falls back to the other SAIA models (`fallback-model.js`),
 * an `anthropic:` choice never falls back. The answer's metadata names the model that answered
 * (`model`) in the last step, plus `chosen` and `reason` when that step fell back (else both null); a slow start sends a transient
 * `data-termi-wait` part `{ model, next? }`. An `anthropic:` request spends only the external quota
 * (429 `{ error: 'quota', scope: 'external' }`), a SAIA request only the SAIA quota.
 *
 * 503 flag/LLM/nope-mcp/NIP-05 domains off · 401 bad NIP-98 · 403 signer not
 * listed by a TERMI_ELIGIBLE_NIP05_DOMAINS domain (`{ error: 'not_eligible' }`)
 * · 503 `{ error: 'eligibility_unknown' }` while a directory is not loaded yet
 * · 400 bad body/task · 429 our quota (`{ error: 'quota', scope }`) · 429
 * `{ error: 'busy' }` while this pubkey already has a stream running. No per-IP
 * limit: the gate plus the per-pubkey quota bound it, so no IP is kept. Upstream failures happen inside the
 * stream and surface as the error text `termi:upstream` (`termi:unavailable` when every candidate failed). Never logs user text: an upstream failure logs
 * status and the provider's error type/code only — its message too, but only with the dev-only
 * `TERMI_TRANSCRIPT_DIR` set (never in production, where the transcript sink writes user text anyway).
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream
} from 'ai';
import { nopeMcpEnv } from '$lib/server/nopeMcpEnv.js';
import { getNopeMcpToken } from '$lib/server/nopeMcpToken.js';
import { streamErrorMessage } from '$lib/server/termi/llm.js';
import { isTermiLlmConfigured } from '$lib/server/termi/model-guard.js';
import { getCatalog } from '$lib/server/termi/models.js';
import { getExternalAccess } from '$lib/server/termi/external-access.js';
import { modelCooldown, withFallback } from '$lib/server/termi/fallback-model.js';
import { serviceOf } from '$lib/termi/model-id.js';
import {
  MAX_MATERIALS,
  TERMI_TASKS,
  composePrompt,
  stopAfterActionStep
} from '$lib/server/termi/tasks.js';
import { PART_KEY, sanitizeLessonState } from '$lib/termi/lesson-state.js';
import { buildTermiTools } from '$lib/server/termi/tools.js';
import { memMcpEnv } from '$lib/server/termi/curriculum-tools.js';
import { parseSearchRelays, zonedDayStart } from '$lib/server/termi/knowledge-tools.js';
import { compactHistory } from '$lib/server/termi/compact-history.js';
import { toolNameOf } from '$lib/termi/tool-registry.js';
import { createTranscriptSink, teeTranscript } from '$lib/server/termi/transcript.js';
import {
  acquireChatLock,
  authorizeTermiRequest,
  termiExternalQuota,
  termiQuota
} from '$lib/server/termi/authorize.js';

const MAX_BODY_CHARS = 200_000;
// How long a candidate may stay silent before the next one takes over (the
// fallback wrapper owns the wait for the first chunk). A worked-out lesson part
// is a long generation after a long silent think (Claude: reasoning-start, then
// nothing for 30 s+; q20-d 2026-11-11): the lesson task gets more silence.
const START_CUT_MS = { ask: 30_000, lesson: 90_000 };
// The last candidate has no successor: a slow start is still better than an
// error (SAIA starts took 55–88 s on the dev server, 2026-11-13).
const LAST_CUT_MS = { ask: 90_000, lesson: 150_000 };
// A stuck call must not hold the pubkey's lock forever, but a long document
// answer on a slow SAIA instance must not die mid-stream: cap the silence
// between chunks, and the whole stream only generously (every candidate's start
// cut on top of the answer time, never more than MAX_TOTAL_MS).
const CHUNK_MS = { ask: 30_000, lesson: 90_000 };
const ANSWER_MS = { ask: 180_000, lesson: 300_000 };
const MAX_TOTAL_MS = 600_000;
// Keep the model's own context sane: an inflated echoed tool input is pure waste.
const MAX_TOOL_INPUT_CHARS = 4_096;
// the open Werkbank part (`focus`) in the prompt; a lesson part is a few thousand chars
const MAX_FOCUS_TEXT = 20_000;

// No Paraglide on the server: the feedback thanks by request locale.
const FEEDBACK_THANKS = {
  de: 'Danke für dein Feedback — es ist notiert.',
  en: 'Thanks for your feedback — it has been recorded.'
};
const FEEDBACK_PREFIX = /^\s*feedback:/i;

/** The last user message's text parts, joined. @param {any[]} messages */
const lastUserText = (messages) => {
  const m = messages.findLast((x) => x?.role === 'user');
  return (Array.isArray(m?.parts) ? m.parts : [])
    .filter((/** @type {any} */ p) => p?.type === 'text' && typeof p.text === 'string')
    .map((/** @type {any} */ p) => p.text)
    .join('\n\n')
    .trim();
};

/** @param {any} part */
const isToolPart = (part) =>
  part?.type === 'dynamic-tool' ||
  (typeof part?.type === 'string' && part.type.startsWith('tool-'));

/** @param {any} part @param {Set<string>} toolNames */
const isForeignToolPart = (part, toolNames) => isToolPart(part) && !toolNames.has(toolNameOf(part));

/**
 * A tool call left at `input-available` (started, never finished — a chat
 * stopped mid-call and restored from persisted history) has no result to
 * replay; convertToModelMessages rejects an incomplete call.
 * @param {any} part
 */
function isUnfinishedToolPart(part) {
  return isToolPart(part) && part?.state === 'input-available';
}

/** @param {any} part */
function capToolInput(part) {
  if (part?.input === undefined) return part;
  const json = JSON.stringify(part.input);
  return json && json.length > MAX_TOOL_INPUT_CHARS ? { ...part, input: {} } : part;
}

/** @param {string} tz */
function isTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function POST({ request }) {
  const catalog = getCatalog();
  const mcpUrl = nopeMcpEnv(env, 'URL');
  if (!isTermiLlmConfigured(env) || !mcpUrl) {
    return json({ error: 'termi_llm_disabled' }, { status: 503 });
  }

  const rawBody = await request.text();
  // An empty body would skip verifyNip98Header's payload check.
  if (!rawBody) return json({ error: 'invalid_json' }, { status: 400 });
  if (rawBody.length > MAX_BODY_CHARS) return json({ error: 'too_large' }, { status: 413 });

  // The quota depends on the chosen model's service: checked below.
  const auth = await authorizeTermiRequest(request, rawBody, { quota: null });
  if (auth instanceof Response) return auth;
  const { pubkey } = auth;

  // Quota: one stream per pubkey (audit B3). Released in
  // `finally` (every early return below), on `request.signal` abort, and by
  // the stream's own onEnd/onError once handed off — acquireChatLock's
  // release is idempotent, so whichever fires first wins.
  const release = acquireChatLock(pubkey);
  if (!release) return json({ error: 'busy' }, { status: 429 });
  const onAbort = () => release();
  // adapter-node's request.signal typically never fires once the body has
  // been read — this listener is a guard for adapters where it does. The
  // real release path is the client disconnecting, which cancels the UI
  // message stream below and reaches onEnd/onError.
  request.signal.addEventListener('abort', onAbort, { once: true });
  let handedOff = false;

  try {
    /** @type {{ task?: unknown, messages?: unknown, model?: unknown, today?: unknown, tz?: unknown, lesson?: unknown, materials?: any, locale?: unknown, focus?: any }} */
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ error: 'invalid_json' }, { status: 400 });
    }
    if (typeof body?.task !== 'string' || !Object.hasOwn(TERMI_TASKS, body.task)) {
      return json({ error: 'unknown_task' }, { status: 400 });
    }
    const task = /** @type {keyof typeof TERMI_TASKS} */ (body.task);
    if (!Array.isArray(body.messages)) {
      return json({ error: 'invalid_messages' }, { status: 400 });
    }

    // The access list is asked only for an outside model (it may wait on a relay).
    const external = serviceOf(body.model) === 'anthropic';
    const listed = external && (await getExternalAccess().isListed(pubkey));
    const chosen = catalog.resolve(/** @type {string | undefined} */ (body.model ?? undefined), {
      listed
    });
    if (!chosen.ok) return json({ error: chosen.error }, { status: chosen.status });
    const quota = external ? termiExternalQuota : termiQuota;

    const locale = body.locale === 'en' ? 'en' : 'de';

    // Dev only (D3): "Feedback: …" is recorded next to the transcripts and thanked, with
    // no model call and no quota step (the lock is freed by the `finally` below).
    const sink = createTranscriptSink(env.TERMI_TRANSCRIPT_DIR);
    const feedback = lastUserText(body.messages);
    if (sink && FEEDBACK_PREFIX.test(feedback)) {
      await sink.record(
        {
          ts: new Date().toISOString(),
          pubkey,
          task: body.task,
          model: chosen.id,
          feedback,
          messages: body.messages
        },
        'feedback'
      );
      return createUIMessageStreamResponse({
        stream: createUIMessageStream({
          execute: ({ writer }) => {
            writer.write({ type: 'text-start', id: 'feedback' });
            writer.write({ type: 'text-delta', id: 'feedback', delta: FEEDBACK_THANKS[locale] });
            writer.write({ type: 'text-end', id: 'feedback' });
          }
        })
      });
    }

    const scope = quota.check(pubkey);
    if (scope !== 'ok') {
      return json({ error: 'quota', scope: external ? 'external' : scope }, { status: 429 });
    }

    // Optional and untrusted: a bad value is ignored, never an error.
    const tz =
      typeof body.tz === 'string' && body.tz.length <= 64 && isTimeZone(body.tz)
        ? body.tz
        : undefined;
    const today =
      tz && zonedDayStart(body.today, tz) !== undefined ? String(body.today) : undefined;
    // Lesson task only: the phase state (an invalid one is dropped, never an
    // error), the teacher's files (shape checked here, text capped in the prompt).
    const lesson = sanitizeLessonState(body.lesson);
    const materials = task === 'lesson' ? (body.materials ?? []) : [];
    if (
      !Array.isArray(materials) ||
      materials.length > MAX_MATERIALS ||
      !materials.every((m) => typeof m?.name === 'string' && typeof m?.text === 'string')
    ) {
      return json({ error: 'invalid_materials' }, { status: 400 });
    }
    // Both tasks: the part open in the Werkbank (a bad one is dropped, its text capped).
    const focus =
      typeof body.focus?.key === 'string' &&
      PART_KEY.test(body.focus.key) &&
      typeof body.focus.text === 'string'
        ? { key: body.focus.key, text: body.focus.text.slice(0, MAX_FOCUS_TEXT) }
        : undefined;

    const tools = buildTermiTools(task, {
      mcpUrl,
      getToken: getNopeMcpToken,
      memUrl: memMcpEnv(env).mcpUrl,
      relays: parseSearchRelays(env.TERMI_SEARCH_RELAYS),
      tz
    });
    const toolNames = new Set(Object.keys(tools));
    // The client owns only its own turns: a client-sent system message would
    // override the prompt, and a user file part makes the SDK fetch its URL
    // server-side — the ask task needs text only. An assistant tool part
    // naming a tool outside this task's set (a stale history from a dropped
    // task, or a forged client message), or left unfinished by a stopped
    // chat, is dropped before the model ever sees it; a surviving part's
    // `input` over 4 KB is replaced by `{}`.
    const history = body.messages
      .filter((m) => m?.role === 'user' || m?.role === 'assistant')
      .map((m) => {
        if (m.role === 'user') {
          return Array.isArray(m.parts)
            ? { ...m, parts: m.parts.filter((/** @type {any} */ p) => p?.type === 'text') }
            : m;
        }
        return Array.isArray(m.parts)
          ? {
              ...m,
              parts: m.parts
                .filter(
                  (/** @type {any} */ p) =>
                    !isForeignToolPart(p, toolNames) && !isUnfinishedToolPart(p)
                )
                .map(capToolInput)
            }
          : m;
      });
    let messages;
    try {
      messages = await convertToModelMessages(compactHistory(history), { tools });
    } catch {
      return json({ error: 'invalid_messages' }, { status: 400 });
    }

    // Who answered: `model` is the last committed try, `failed` why a candidate dropped out.
    const answer = { model: chosen.id };
    /** @type {Map<string, string>} */
    const failed = new Map();
    // The transcript row is spread when the stream ends, so it sees the final `model`.
    /** @type {Record<string, unknown>} */
    const row = {
      task,
      model: chosen.id,
      locale,
      pubkey,
      messages: history,
      lesson: lesson ?? undefined,
      materials: materials.map((m) => ({ name: m.name, chars: m.text.length }))
    };
    // The metadata describes the last step: nulls overwrite an earlier step's
    // fallback on the client (which merges metadata). A failure other than
    // capacity (network, no start) reads as "did not answer".
    const fallbackMeta = () =>
      answer.model === chosen.id
        ? { chosen: null, reason: null }
        : {
            chosen: chosen.id,
            reason: (failed.get(chosen.id) ?? 'capacity') === 'capacity' ? 'capacity' : 'no_start'
          };
    /** @type {((part: any) => void) | undefined} */
    let writeWait;

    // request.signal never fires on adapter-node once the body is read: a stop
    // (response cancelled) must still abort a candidate that is waiting to start.
    const gone = new AbortController();
    const appName = env.APP_NAME || 'Edufeed';
    const result = streamText({
      model: withFallback({
        candidates: chosen.candidates.map((id) => ({ id, model: catalog.model(id) })),
        startCutMs: START_CUT_MS[task],
        lastCutMs: LAST_CUT_MS[task],
        cooldown: modelCooldown,
        onTry: ({ id, ok, reason }) => {
          if (ok) {
            answer.model = id;
            row.model = id;
            if (id !== chosen.id) row.chosen = chosen.id;
            else delete row.chosen;
            return;
          }
          // a failed try was a real upstream call: it costs a step like any other
          quota.charge(pubkey);
          if (reason) failed.set(id, reason);
        },
        onWaiting: ({ id, next }) =>
          writeWait?.({
            type: 'data-termi-wait',
            data: next ? { model: id, next } : { model: id },
            transient: true
          })
      }),
      instructions: composePrompt(task, { appName, today, tz, lesson, materials, locale, focus }),
      messages,
      tools,
      // Each step is one SAIA call: charge it up front (failed calls count at
      // SAIA too) and stop once the quota is gone.
      prepareStep: () => {
        quota.charge(pubkey);
        return undefined;
      },
      // A task's own stop conditions (e.g. show_pages is a one-step answer:
      // the model may add a short sentence and calls it, then stops — no
      // further generation) on top of the step cap and the quota.
      stopWhen: [
        isStepCount(TERMI_TASKS[task].maxSteps),
        () => quota.check(pubkey) !== 'ok',
        stopAfterActionStep(TERMI_TASKS[task].stopWhen)
      ],
      // The client handles errors; a retry would only spend quota.
      maxRetries: 0,
      // A dead/hanging upstream must not hold the pubkey's chat lock forever;
      // the SDK ends a timed-out stream with an abort chunk, so onEnd (isAborted) releases it.
      abortSignal: AbortSignal.any([request.signal, gone.signal]),
      timeout: {
        chunkMs: CHUNK_MS[task],
        totalMs: Math.min(
          (chosen.candidates.length - 1) * START_CUT_MS[task] + LAST_CUT_MS[task] + ANSWER_MS[task],
          MAX_TOTAL_MS
        )
      },
      // The SDK default logs the whole error, whose requestBodyValues carry the
      // prompt (user text). Silenced: streamErrorMessage logs it once (status + provider type/code; the message only under TERMI_TRANSCRIPT_DIR).
      onError: () => {}
    });
    /** @param {unknown} err */
    const onStreamError = (err) => {
      request.signal.removeEventListener('abort', onAbort);
      release();
      gone.abort();
      return streamErrorMessage(err, Boolean(env.TERMI_TRANSCRIPT_DIR));
    };
    // Only mark handed off once the response object itself is built: if
    // building it throws, the lock must still be freed below. The outer stream
    // carries the wait notice; a failure inside `execute` ends in its onError.
    const res = createUIMessageStreamResponse({
      stream: createUIMessageStream({
        execute: ({ writer }) => {
          writeWait = (part) => writer.write(part);
          writer.merge(
            toUIMessageStream({
              stream: result.stream,
              tools,
              // the answer names the model that wrote it (D5): known once a step has run
              messageMetadata: ({ part }) =>
                part.type === 'finish-step' || part.type === 'finish'
                  ? { model: answer.model, ...fallbackMeta() }
                  : undefined,
              onEnd: () => {
                request.signal.removeEventListener('abort', onAbort);
                release();
                gone.abort();
              },
              onError: onStreamError
            })
          );
        },
        onError: onStreamError
      })
    });
    handedOff = true;
    // Dev-only: with TERMI_TRANSCRIPT_DIR set, the exchange is written to disk
    // (request as sent, stream as received) — see transcript.js for the rules.
    return sink ? teeTranscript(res, row, sink) : res;
  } finally {
    if (!handedOff) {
      request.signal.removeEventListener('abort', onAbort);
      release();
    }
  }
}
