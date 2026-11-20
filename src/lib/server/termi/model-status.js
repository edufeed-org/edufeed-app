/**
 * How busy each SAIA model is: one GET `<baseUrl>/models` per TTL (shared
 * promise while in flight). `{ data: [{ id, name, status, demand }] }`; a
 * failed or slow fetch keeps the last good copy (else `{}`) and never throws.
 * The key goes in the Authorization header only.
 */
export const STATUS_TTL_MS = 60_000;
/** demand >= this is "Stark genutzt". */
export const BUSY_DEMAND = 1;
const FETCH_TIMEOUT_MS = 3_000;

/**
 * @param {{ baseUrl: string, apiKey: string, fetch?: typeof fetch, now?: () => number, ttlMs?: number }} opts
 */
export function createModelStatus({
  baseUrl,
  apiKey,
  fetch: doFetch = globalThis.fetch,
  now = Date.now,
  ttlMs = STATUS_TTL_MS
}) {
  /** @type {Record<string, { name: string, state: 'ready' | 'busy' | 'down' }>} */
  let last = {};
  let fetchedAt = -Infinity;
  /** @type {Promise<typeof last> | null} */
  let inFlight = null;

  async function load() {
    try {
      const res = await doFetch(`${baseUrl.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (!res.ok) return;
      const { data } = await res.json();
      /** @type {typeof last} */
      const next = {};
      for (const m of Array.isArray(data) ? data : []) {
        if (typeof m?.id !== 'string') continue;
        next[m.id] = {
          name: typeof m.name === 'string' && m.name ? m.name : m.id,
          state: m.status !== 'ready' ? 'down' : m.demand >= BUSY_DEMAND ? 'busy' : 'ready'
        };
      }
      last = next;
    } catch {
      // keep the last good copy
    } finally {
      fetchedAt = now();
      inFlight = null;
    }
    return last;
  }

  return {
    async get() {
      if (now() - fetchedAt < ttlMs) return last;
      return (inFlight ??= /** @type {Promise<typeof last>} */ (load()));
    }
  };
}
