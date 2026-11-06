/**
 * POST /api/termi — ranks Termi skill ids against a user sentence via the
 * homelab embedding service. Flag/env off or the index not warmed up yet =
 * 503, and the client falls back to the existing keyword matcher
 * (`keywordMatch` in `$lib/helpers/termi-skills.js`). Never logs user text.
 *
 * The router index is created once at module load (= first request to this
 * route) and its warm-up kicked off immediately in the background — see
 * global-constraints.md: "warm-up starts on first module load of the route,
 * not process start".
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { TERMI_SKILLS } from '$lib/helpers/termi-skills.js';
import { embedTexts, isEmbedConfigured } from '$lib/server/termi/embed.js';
import { createRouterIndex } from '$lib/server/termi/router-index.js';
import { createRateLimiter } from '$lib/server/rate-limit.js';

const LOCALES = new Set(['de', 'en']);
const RANK_TIMEOUT_MS = 3_500;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

/** @type {ReturnType<typeof createRouterIndex> | null} */
let index = null;
if (isEmbedConfigured(env)) {
  /** @param {string[]} texts @param {'query'|'passage'} inputType */
  const embed = (texts, inputType) =>
    embedTexts(texts, inputType, {
      url: /** @type {string} */ (env.TERMI_EMBED_URL),
      apiKey: /** @type {string} */ (env.TERMI_EMBED_API_KEY),
      timeoutMs: inputType === 'query' ? 3_000 : undefined
    });
  index = createRouterIndex({ embed, skills: TERMI_SKILLS });
  index.warmUp().catch((err) => {
    console.error('[/api/termi] warm-up failed:', err?.message || 'unknown error');
  });
}

const limiter = createRateLimiter({ limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS });

/** @param {number} ms */
function timeoutAfter(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('rank timeout')), ms));
}

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function POST({ request, getClientAddress }) {
  if (!index) return json({ error: 'termi_embed_disabled' }, { status: 503 });

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

  // shortcut: this fast-path only covers "warm-up still in progress after
  // boot" (the expected case). If warm-up fails outright, index.ready()
  // stays false forever and every request 503s here without ever calling
  // rank() (which would otherwise lazily retry); the client's keyword
  // fallback keeps Termi usable meanwhile. Upgrade: if the embed service
  // flaps in practice, drop this check and let rank()'s own retry run
  // behind the 3.5s race below instead.
  if (!index.ready()) {
    return json({ error: 'not_ready' }, { status: 503 });
  }

  try {
    const matches = await Promise.race([index.rank(text, locale), timeoutAfter(RANK_TIMEOUT_MS)]);
    return json({ matches });
  } catch (err) {
    console.error('[/api/termi] rank failed:', err?.name || 'unknown error');
    return json({ error: 'rank_failed' }, { status: 503 });
  }
}
