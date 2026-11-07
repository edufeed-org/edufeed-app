/**
 * POST /api/termi/search — Termi tier 1: answers a content question with
 * typed cards from nope-mcp, no LLM, open to anonymous users. Flag
 * `TERMI_AI_ENABLED` off or no nope-mcp URL = 503. Never logs user text.
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { parseBool } from '$lib/server/env-parse.js';
import { nopeMcpEnv } from '$lib/server/nopeMcpEnv.js';
import { getNopeMcpToken } from '$lib/server/nopeMcpToken.js';
import { callNopeMcpTool } from '$lib/server/nopeMcpClient.js';
import { createKnowledgeTools, nopeMcpCaller } from '$lib/server/termi/knowledge-tools.js';
import { answerQuestion, parseSearchRelays } from '$lib/server/termi/answer.js';
import { termiLimiter as limiter } from '$lib/server/termi/limiter.js';

const LOCALES = new Set(['de', 'en']);

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function POST({ request, getClientAddress }) {
  const mcpUrl = nopeMcpEnv(env, 'URL');
  if (!parseBool(env.TERMI_AI_ENABLED, false) || !mcpUrl) {
    return json({ error: 'termi_search_disabled' }, { status: 503 });
  }

  if (!limiter.take(getClientAddress())) {
    return json({ error: 'rate_limited' }, { status: 429 });
  }

  /** @type {{ text?: unknown, locale?: unknown }} */
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 });
  }

  if (typeof body.text !== 'string') {
    return json({ error: 'invalid_text' }, { status: 400 });
  }
  const text = body.text.trim();
  if (text.length === 0 || text.length > 300) {
    return json({ error: 'invalid_text' }, { status: 400 });
  }
  if (typeof body.locale !== 'string' || !LOCALES.has(body.locale)) {
    return json({ error: 'invalid_locale' }, { status: 400 });
  }
  const locale = /** @type {'de'|'en'} */ (body.locale);

  const tools = createKnowledgeTools({
    callTool: nopeMcpCaller({ mcpUrl, getToken: getNopeMcpToken, callTool: callNopeMcpTool }),
    relays: parseSearchRelays(env.TERMI_SEARCH_RELAYS)
  });
  return json(await answerQuestion(text, locale, tools));
}
