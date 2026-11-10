/**
 * POST /api/termi/chat — the Termi assistant. Body `{ task, messages, today?, tz? }`
 * (AI SDK v6 UIMessages; today = the browser's YYYY-MM-DD, tz its IANA zone), NIP-98 signed over the raw body; answers with a UI
 * message stream from SAIA (open-weight model, see `termi/llm.js`).
 *
 * 503 flag/LLM/nope-mcp/NIP-05 domains off · 401 bad NIP-98 · 403 signer not
 * listed by a TERMI_ELIGIBLE_NIP05_DOMAINS domain (`{ error: 'not_eligible' }`)
 * · 503 `{ error: 'eligibility_unknown' }` while a directory is not loaded yet
 * · 400 bad body/task · 429 our quota (`{ error: 'quota', scope }`) · 429
 * `{ error: 'busy' }` while this pubkey already has a stream running. No per-IP
 * limit: the gate plus the per-pubkey quota bound it, so no IP is kept. Upstream failures happen inside the
 * stream and surface as the error text `termi:upstream`. Never logs user text.
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { convertToModelMessages, stepCountIs, streamText } from 'ai';
import { nopeMcpEnv } from '$lib/server/nopeMcpEnv.js';
import { getNopeMcpToken } from '$lib/server/nopeMcpToken.js';
import { createTermiModel, streamErrorMessage } from '$lib/server/termi/llm.js';
import { TERMI_TASKS, composePrompt, stopAfterActionStep } from '$lib/server/termi/tasks.js';
import { buildTermiTools } from '$lib/server/termi/tools.js';
import { memMcpEnv } from '$lib/server/termi/curriculum-tools.js';
import { parseSearchRelays, zonedDayStart } from '$lib/server/termi/knowledge-tools.js';
import { compactHistory } from '$lib/server/termi/compact-history.js';
import { toolNameOf } from '$lib/termi/tool-registry.js';
import {
  acquireChatLock,
  authorizeTermiRequest,
  termiQuota as quota
} from '$lib/server/termi/authorize.js';

const MAX_BODY_CHARS = 200_000;
// A stuck call must not hold the pubkey's lock forever, but a long document
// answer on a slow SAIA instance must not die mid-stream: cap the silence
// between chunks, and the whole stream only generously.
const STREAM_TIMEOUT = { chunkMs: 30_000, totalMs: 180_000 };
// Keep the model's own context sane: an inflated echoed tool input is pure waste.
const MAX_TOOL_INPUT_CHARS = 4_096;

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
  const model = createTermiModel(env);
  const mcpUrl = nopeMcpEnv(env, 'URL');
  if (!model || !mcpUrl) return json({ error: 'termi_llm_disabled' }, { status: 503 });

  const rawBody = await request.text();
  // An empty body would skip verifyNip98Header's payload check.
  if (!rawBody) return json({ error: 'invalid_json' }, { status: 400 });
  if (rawBody.length > MAX_BODY_CHARS) return json({ error: 'too_large' }, { status: 413 });

  const auth = await authorizeTermiRequest(request, rawBody);
  if (auth instanceof Response) return auth;
  const { pubkey } = auth;

  // Quota: one stream per pubkey (audit B3). Released in
  // `finally` (every early return below), on `request.signal` abort, and by
  // the stream's own onFinish/onError once handed off — acquireChatLock's
  // release is idempotent, so whichever fires first wins.
  const release = acquireChatLock(pubkey);
  if (!release) return json({ error: 'busy' }, { status: 429 });
  const onAbort = () => release();
  // adapter-node's request.signal typically never fires once the body has
  // been read — this listener is a guard for adapters where it does. The
  // real release path is the client disconnecting, which cancels the UI
  // message stream below and reaches onFinish/onError.
  request.signal.addEventListener('abort', onAbort, { once: true });
  let handedOff = false;

  try {
    /** @type {{ task?: unknown, messages?: unknown, today?: unknown, tz?: unknown }} */
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

    // Optional and untrusted: a bad value is ignored, never an error.
    const tz =
      typeof body.tz === 'string' && body.tz.length <= 64 && isTimeZone(body.tz)
        ? body.tz
        : undefined;
    const today =
      tz && zonedDayStart(body.today, tz) !== undefined ? String(body.today) : undefined;

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

    const appName = env.APP_NAME || 'Edufeed';
    const result = streamText({
      model,
      system: composePrompt(task, { appName, today, tz }),
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
        stepCountIs(TERMI_TASKS[task].maxSteps),
        () => quota.check(pubkey) !== 'ok',
        stopAfterActionStep(TERMI_TASKS[task].stopWhen)
      ],
      // The client handles errors; a retry would only spend quota.
      maxRetries: 0,
      // A dead/hanging upstream must not hold the pubkey's chat lock forever;
      // the SDK ends a timed-out stream with an abort chunk, so onFinish (isAborted) releases it.
      abortSignal: request.signal,
      timeout: STREAM_TIMEOUT,
      // The SDK default logs the whole error, whose requestBodyValues carry the
      // prompt (user text). Silenced: streamErrorMessage logs it once, status only.
      onError: () => {}
    });
    // Only mark handed off once the response object itself is built: if
    // `toUIMessageStreamResponse` throws, the lock must still be freed below.
    const res = result.toUIMessageStreamResponse({
      onFinish: () => {
        request.signal.removeEventListener('abort', onAbort);
        release();
      },
      onError: (err) => {
        request.signal.removeEventListener('abort', onAbort);
        release();
        return streamErrorMessage(err);
      }
    });
    handedOff = true;
    return res;
  } finally {
    if (!handedOff) {
      request.signal.removeEventListener('abort', onAbort);
      release();
    }
  }
}
