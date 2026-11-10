/**
 * Minimal streamable-HTTP MCP client for the deployed nope-mcp server
 * (formerly amb-mcp).
 *
 * A pool of sessions per (mcpUrl, bearerToken) is kept in module scope.
 * nope-mcp sessions are stateful on the server and only answer ONE in-flight
 * `tools/call` at a time — sharing one session across parallel calls makes
 * all but one hang until the transport-level timeout (measured live: 2/3
 * parallel calls on a shared session hung for 30 s). So each call gets its
 * own session for the duration of the call:
 *   1. acquire a free session from the pool, or handshake a new one
 *      (POST initialize → capture `Mcp-Session-Id` → POST notifications/initialized)
 *   2. POST tools/call <name> on that session
 *   3. release the session back to the pool (or discard it on failure)
 *
 * The pool caps at `POOL_CAP` sessions per key; calls beyond the cap get a
 * one-off session that is used once and never kept. A `tools/call` that
 * answers 404 or a 400 "no session"/"session not found" (the session expired
 * or nope-mcp restarted) discards that session and retries once on a freshly
 * handshaked one. No DELETE is sent — nope-mcp's own idle timeout gc's
 * abandoned sessions.
 */

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_NAME = 'edufeed-app';
const CLIENT_VERSION = '0.1.0';

/** Whole-call deadline (handshake + tools/call). process.env, not $env: the eval script imports this module from plain node. */
const DEFAULT_TIMEOUT_MS = Number(process.env.NOPE_MCP_TIMEOUT_MS) || 10000;

/** Max sessions kept per (mcpUrl, bearerToken); more concurrent calls get one-off, unkept sessions. */
const POOL_CAP = 8;

/** @typedef {{ key: string, sessionId: string, pooled: boolean }} Session */

/** @typedef {{ free: string[], busyCount: number }} Pool */
/** @type {Map<string, Pool>} key → pool of session ids, one per (mcpUrl, bearerToken). */
const pools = new Map();

/** @param {string} mcpUrl @param {string | undefined} bearerToken */
function sessionKey(mcpUrl, bearerToken) {
  return `${mcpUrl}\u0000${bearerToken ?? ''}`;
}

/** @param {string} key @returns {Pool} */
function getPool(key) {
  let pool = pools.get(key);
  if (!pool) {
    pool = { free: [], busyCount: 0 };
    pools.set(key, pool);
  }
  return pool;
}

/**
 * A brand-new, never-reused session: pooled (counted against the cap, and
 * returned to the pool on release) when there is room, otherwise a one-off.
 * @param {string} mcpUrl
 * @param {string | undefined} bearerToken
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<Session>}
 */
async function freshSession(mcpUrl, bearerToken, signal) {
  const key = sessionKey(mcpUrl, bearerToken);
  const pool = getPool(key);
  if (pool.busyCount >= POOL_CAP) {
    const sessionId = await mcpHandshake(mcpUrl, bearerToken, signal);
    return { key, sessionId, pooled: false };
  }
  pool.busyCount++; // reserve the slot before awaiting so concurrent callers see it
  try {
    const sessionId = await mcpHandshake(mcpUrl, bearerToken, signal);
    return { key, sessionId, pooled: true };
  } catch (err) {
    pool.busyCount--;
    throw err;
  }
}

/**
 * A free pooled session if one is idle, otherwise a fresh one.
 * @param {string} mcpUrl
 * @param {string | undefined} bearerToken
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<Session>}
 */
function acquireSession(mcpUrl, bearerToken, signal) {
  const key = sessionKey(mcpUrl, bearerToken);
  const pool = getPool(key);
  const sessionId = pool.free.pop();
  if (sessionId !== undefined) {
    pool.busyCount++;
    return Promise.resolve({ key, sessionId, pooled: true });
  }
  return freshSession(mcpUrl, bearerToken, signal);
}

/**
 * @param {Session} session
 * @param {{ discard?: boolean }} [opts] discard = the session is dead (404/expired), drop it instead of freeing it
 */
function releaseSession(session, { discard = false } = {}) {
  if (!session.pooled) return;
  const pool = pools.get(session.key);
  if (!pool) return;
  pool.busyCount = Math.max(0, pool.busyCount - 1);
  if (!discard) pool.free.push(session.sessionId);
}

/** Test seam: clears every pooled session so tests don't leak state into each other. */
export function _resetNopeMcpSessionsForTests() {
  pools.clear();
}

/**
 * @param {string | undefined} bearerToken
 * @param {string | undefined} sessionId
 * @returns {Record<string, string>}
 */
function buildHeaders(bearerToken, sessionId) {
  /** @type {Record<string, string>} */
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  return headers;
}

/**
 * An HTTP-level failure; `status` lets callers detect e.g. a 401 cleanly.
 * @param {string} message
 * @param {number} status
 */
function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

/**
 * Parse a streamable-HTTP SSE body and return the inlined JSON-RPC payload.
 * Server returns one `event: message` + one `data: {...}` line.
 *
 * @param {string} body
 * @returns {any}
 */
function parseSseJsonRpc(body) {
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      const json = line.slice(5).trim();
      if (json) return JSON.parse(json);
    }
  }
  throw new Error('MCP response missing data line');
}

/**
 * Run the `initialize` → `notifications/initialized` handshake and return
 * the session id to use for the following `tools/call`.
 *
 * @param {string} mcpUrl
 * @param {string | undefined} bearerToken
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<string>}
 */
async function mcpHandshake(mcpUrl, bearerToken, signal) {
  const initRes = await fetch(mcpUrl, {
    method: 'POST',
    signal,
    headers: buildHeaders(bearerToken, undefined),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION }
      }
    })
  });
  if (!initRes.ok) {
    throw httpError(`MCP initialize failed: HTTP ${initRes.status}`, initRes.status);
  }
  const sessionId = initRes.headers.get('mcp-session-id') ?? undefined;
  if (!sessionId) {
    throw new Error('MCP initialize returned no session id');
  }
  // Drain body so the connection can close; also surfaces JSON-RPC errors.
  const initBody = await initRes.text();
  const initRpc = parseSseJsonRpc(initBody);
  if (initRpc.error) {
    throw new Error(`MCP initialize error: ${initRpc.error.message}`);
  }

  await fetch(mcpUrl, {
    method: 'POST',
    signal,
    headers: buildHeaders(bearerToken, sessionId),
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    })
  });

  return sessionId;
}

/**
 * The MCP SDK catches throws inside a tool handler and wraps them in
 * `result.isError: true`, with the error text in `content[0].text`.
 *
 * @param {any} result
 * @returns {string}
 */
function toolErrorText(result) {
  const errText = result.content?.[0]?.text;
  return typeof errText === 'string' ? errText : JSON.stringify(errText ?? '');
}

/**
 * @param {string} mcpUrl
 * @param {string | undefined} bearerToken
 * @param {string} sessionId
 * @param {string} name
 * @param {object} args
 * @param {AbortSignal | undefined} signal
 */
function postToolsCall(mcpUrl, bearerToken, sessionId, name, args, signal) {
  return fetch(mcpUrl, {
    method: 'POST',
    signal,
    headers: buildHeaders(bearerToken, sessionId),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name, arguments: args }
    })
  });
}

/**
 * A `tools/call` 404, or a 400 whose body names a missing session, means the
 * cached session expired (nope-mcp's idle timeout or a restart) rather than
 * a real tool failure.
 * @param {Response} res
 */
async function isExpiredSession(res) {
  if (res.status === 404) return true;
  if (res.status !== 400) return false;
  const body = await res.text().catch(() => '');
  return /session/i.test(body) && /(not found|no session)/i.test(body);
}

/**
 * Call any tool on a streamable-HTTP nope-mcp server and return its parsed
 * result: `result.structuredContent` when present, otherwise `JSON.parse`
 * of the first text content block.
 *
 * A tool-level failure (`result.isError`) is thrown as a plain `Error`
 * carrying the raw tool error text as its message and `isToolError: true`,
 * so callers that need to classify specific failures (e.g.
 * `callExtractMetadata`) can do so without this generic helper guessing at
 * domain-specific error shapes.
 *
 * @param {object} params
 * @param {string} params.mcpUrl - Full `/mcp` endpoint URL.
 * @param {string | undefined} params.bearerToken - If set, sent as `Authorization: Bearer <token>`.
 * @param {string} params.name - MCP tool name.
 * @param {object} params.args - Tool arguments.
 * @param {number | null} [params.timeoutMs] - Whole-call deadline; default `NOPE_MCP_TIMEOUT_MS` or 10000, `null` = none.
 * @returns {Promise<any>}
 */
export async function callNopeMcpTool({
  mcpUrl,
  bearerToken,
  name,
  args,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const signal = timeoutMs === null ? undefined : AbortSignal.timeout(timeoutMs);
  let session = await acquireSession(mcpUrl, bearerToken, signal);
  // Set once we know the session must not go back into the pool (a dead or
  // possibly-broken session), so the single `finally` below never double-frees it.
  let discardOnRelease = false;
  try {
    let callRes = await postToolsCall(mcpUrl, bearerToken, session.sessionId, name, args, signal);

    if (!callRes.ok && (await isExpiredSession(callRes))) {
      releaseSession(session, { discard: true });
      session = await freshSession(mcpUrl, bearerToken, signal);
      callRes = await postToolsCall(mcpUrl, bearerToken, session.sessionId, name, args, signal);
    }
    if (!callRes.ok) {
      discardOnRelease = true; // unknown HTTP failure: don't recycle a possibly-broken session
      throw httpError(`MCP tools/call failed: HTTP ${callRes.status}`, callRes.status);
    }

    const callBody = await callRes.text();
    const callRpc = parseSseJsonRpc(callBody);
    if (callRpc.error) {
      throw new Error(`MCP tool error: ${callRpc.error.message}`);
    }

    const result = callRpc.result;
    if (result?.isError) {
      const err = /** @type {Error & { isToolError?: boolean }} */ (
        new Error(toolErrorText(result))
      );
      err.isToolError = true;
      throw err;
    }

    if (result?.structuredContent !== undefined) {
      return result.structuredContent;
    }
    const text = result?.content?.[0]?.text;
    if (typeof text !== 'string') {
      throw new Error('MCP tool returned no text content');
    }
    return JSON.parse(text);
  } finally {
    releaseSession(session, { discard: discardOnRelease });
  }
}

/**
 * Call the `extract_metadata` tool on a streamable-HTTP MCP server.
 *
 * @param {object} params
 * @param {string} params.mcpUrl - Full `/mcp` endpoint URL.
 * @param {string | undefined} params.bearerToken - If set, sent as `Authorization: Bearer <token>`.
 * @param {string} [params.url] - Single public http(s) page to extract.
 * @param {string[]} [params.urls] - Multiple http(s) pages to extract together (multi-source).
 * @param {'amb' | 'ekw' | 'konfi'} params.variant
 * @param {Record<string, string>} params.skosSchemes - form-field → scheme naddr.
 * @returns {Promise<{ source: string, payload: object, evidence: object, baseline: object }>}
 */
export async function callExtractMetadata({
  mcpUrl,
  bearerToken,
  url,
  urls,
  variant,
  skosSchemes
}) {
  const sourceUrls = urls ?? (url ? [url] : []);
  if (sourceUrls.length === 0) {
    throw new Error('callExtractMetadata requires `url` or a non-empty `urls` array.');
  }
  // Send the single-URL shape when there is exactly one source so the call
  // still works against a nope-mcp server that predates the `urls` array.
  // Multi-source extractions require the newer server (deploy it first).
  const toolArguments =
    sourceUrls.length === 1
      ? { url: sourceUrls[0], variant, skosSchemes }
      : { urls: sourceUrls, variant, skosSchemes };

  try {
    return await callNopeMcpTool({
      mcpUrl,
      bearerToken,
      name: 'extract_metadata',
      args: toolArguments,
      // An LLM extraction runs far past the search deadline; /api/enrich has always waited for it.
      timeoutMs: null
    });
  } catch (err) {
    if (!(err instanceof Error) || !(/** @type {any} */ (err).isToolError)) {
      throw err;
    }
    // Tool-level errors: surface these with a typed `code` so /api/enrich
    // can return a meaningful hint to the client instead of silently
    // swallowing the failure. Common shape we see in production:
    //   text: '529 {"type":"error","error":{"type":"overloaded_error",...}}'
    const errStr = err.message;
    const isOverloaded = /\boverloaded/i.test(errStr) || /^\s*529\b/.test(errStr);
    // nope-mcp's PageTooLargeError stringifies as
    //   "PDF body (… bytes) exceeds size cap (… bytes)"
    //   "HTML body (… bytes) exceeds size cap (… bytes)"
    // We match on "exceeds size cap" so the wizard can show "page too big"
    // copy instead of the generic AI-failure message.
    const isPageTooLarge = /exceeds size cap/i.test(errStr);
    // nope-mcp ≥ 0.5.0 rejects office documents and other non-HTML/PDF
    // bodies with "unsupported content type <mime> for <url>".
    const isUnsupportedType = /unsupported content type/i.test(errStr);
    const mapped = /** @type {Error & { code?: string }} */ (
      new Error(`MCP extract_metadata tool error: ${errStr.slice(0, 200)}`)
    );
    mapped.code = isOverloaded
      ? 'overloaded'
      : isPageTooLarge
        ? 'page_too_large'
        : isUnsupportedType
          ? 'unsupported_type'
          : 'tool_error';
    throw mapped;
  }
}
