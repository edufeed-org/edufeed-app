/**
 * POST /api/termi/chat — the Termi assistant. Body `{ task, messages, today?, tz? }`
 * (AI SDK v6 UIMessages; today = the browser's YYYY-MM-DD, tz its IANA zone), NIP-98 signed over the raw body; answers with a UI
 * message stream from SAIA (open-weight model, see `termi/llm.js`).
 *
 * 503 flag/LLM/nope-mcp/NIP-05 domains off · 401 bad NIP-98 · 403 signer not
 * listed by a TERMI_ELIGIBLE_NIP05_DOMAINS domain (`{ error: 'not_eligible' }`)
 * · 503 `{ error: 'eligibility_unknown' }` while a directory is not loaded yet
 * · 400 bad body/task · 429 our quota (`{ error: 'quota', scope }`). No per-IP
 * limit: the gate plus the per-pubkey quota bound it, so no IP is kept. Upstream failures happen inside the
 * stream and surface as the error text `termi:upstream`. Never logs user text.
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { convertToModelMessages, hasToolCall, stepCountIs, streamText } from 'ai';
import { nopeMcpEnv } from '$lib/server/nopeMcpEnv.js';
import { getNopeMcpToken } from '$lib/server/nopeMcpToken.js';
import { createTermiModel, streamErrorMessage } from '$lib/server/termi/llm.js';
import { SYSTEM_PROMPTS, todayPreamble } from '$lib/server/termi/prompts.js';
import { buildTermiTools } from '$lib/server/termi/tools.js';
import { parseSearchRelays, zonedDayStart } from '$lib/server/termi/knowledge-tools.js';
import { compactHistory } from '$lib/server/termi/compact-history.js';
import { authorizeTermiRequest, termiQuota as quota } from '$lib/server/termi/authorize.js';

const MAX_BODY_CHARS = 200_000;

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

  /** @type {{ task?: unknown, messages?: unknown, today?: unknown, tz?: unknown }} */
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body?.task !== 'string' || !Object.hasOwn(SYSTEM_PROMPTS, body.task)) {
    return json({ error: 'unknown_task' }, { status: 400 });
  }
  const task = /** @type {keyof typeof SYSTEM_PROMPTS} */ (body.task);
  if (!Array.isArray(body.messages)) {
    return json({ error: 'invalid_messages' }, { status: 400 });
  }

  // Optional and untrusted: a bad value is ignored, never an error.
  const tz =
    typeof body.tz === 'string' && body.tz.length <= 64 && isTimeZone(body.tz)
      ? body.tz
      : undefined;
  const today = tz && zonedDayStart(body.today, tz) !== undefined ? String(body.today) : undefined;

  const tools = buildTermiTools(task, {
    mcpUrl,
    getToken: getNopeMcpToken,
    relays: parseSearchRelays(env.TERMI_SEARCH_RELAYS),
    tz
  });
  // The client owns only its own turns: a client-sent system message would
  // override the prompt, and a user file part makes the SDK fetch its URL
  // server-side — the ask task needs text only. Assistant tool/file parts
  // pass through: harmless while no tool has toModelOutput content — strip them if one ever does.
  const history = body.messages
    .filter((m) => m?.role === 'user' || m?.role === 'assistant')
    .map((m) =>
      m.role === 'user' && Array.isArray(m.parts)
        ? { ...m, parts: m.parts.filter((/** @type {any} */ p) => p?.type === 'text') }
        : m
    );
  let messages;
  try {
    messages = await convertToModelMessages(compactHistory(history), { tools });
  } catch {
    return json({ error: 'invalid_messages' }, { status: 400 });
  }

  const result = streamText({
    model,
    system: (today && tz ? todayPreamble(today, tz) : '') + SYSTEM_PROMPTS[task],
    messages,
    tools,
    // Each step is one SAIA call: charge it up front (failed calls count at
    // SAIA too) and stop once the quota is gone.
    prepareStep: () => {
      quota.charge(pubkey);
      return undefined;
    },
    // show_pages is a one-step answer: the model may add a short sentence
    // and calls it, then stops — no further generation.
    stopWhen: [stepCountIs(8), () => quota.check(pubkey) !== 'ok', hasToolCall('show_pages')],
    // The client handles errors; a retry would only spend quota.
    maxRetries: 0,
    // The SDK default logs the whole error, whose requestBodyValues carry the
    // prompt (user text). Silenced: streamErrorMessage logs it once, status only.
    onError: () => {}
  });
  return result.toUIMessageStreamResponse({ onError: streamErrorMessage });
}
