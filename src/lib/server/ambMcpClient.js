/**
 * Minimal streamable-HTTP MCP client for the deployed AMB MCP server.
 *
 * Each `callExtractMetadata` performs:
 *   1. POST initialize          → captures `Mcp-Session-Id` from the response
 *   2. POST notifications/initialized
 *   3. POST tools/call extract_metadata
 *
 * The session is short-lived (no DELETE — the server gc's on transport close).
 * Re-using a session across calls is a future optimization; per-request init
 * is two extra small roundtrips and keeps the client stateless.
 */

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_NAME = 'edufeed-app';
const CLIENT_VERSION = '0.1.0';

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
 * Call the `extract_metadata` tool on a streamable-HTTP MCP server.
 *
 * @param {object} params
 * @param {string} params.mcpUrl - Full `/mcp` endpoint URL.
 * @param {string | undefined} params.bearerToken - If set, sent as `Authorization: Bearer <token>`.
 * @param {string} params.url - Public http(s) page to extract.
 * @param {'amb' | 'ekw'} params.variant
 * @param {Record<string, string>} params.skosSchemes - form-field → scheme naddr.
 * @returns {Promise<{ source: string, payload: object, evidence: object, baseline: object }>}
 */
export async function callExtractMetadata({ mcpUrl, bearerToken, url, variant, skosSchemes }) {
  // 1. initialize — capture session id from response header
  const initRes = await fetch(mcpUrl, {
    method: 'POST',
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
    throw new Error(`MCP initialize failed: HTTP ${initRes.status}`);
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

  // 2. initialized notification (no response payload)
  await fetch(mcpUrl, {
    method: 'POST',
    headers: buildHeaders(bearerToken, sessionId),
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    })
  });

  // 3. tools/call extract_metadata
  const callRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: buildHeaders(bearerToken, sessionId),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'extract_metadata',
        arguments: { url, variant, skosSchemes }
      }
    })
  });
  if (!callRes.ok) {
    throw new Error(`MCP tools/call failed: HTTP ${callRes.status}`);
  }
  const callBody = await callRes.text();
  const callRpc = parseSseJsonRpc(callBody);
  if (callRpc.error) {
    throw new Error(`MCP tool error: ${callRpc.error.message}`);
  }

  // Tool-level errors (the MCP SDK catches throws inside the tool handler and
  // wraps them in `result.isError: true`). We surface these with a typed
  // `code` so /api/enrich can return a meaningful hint to the client instead
  // of silently swallowing the failure. Common shape we see in production:
  //   text: '529 {"type":"error","error":{"type":"overloaded_error",...}}'
  if (callRpc.result?.isError) {
    const errText = callRpc.result.content?.[0]?.text;
    const errStr = typeof errText === 'string' ? errText : JSON.stringify(errText ?? '');
    const isOverloaded = /\boverloaded/i.test(errStr) || /^\s*529\b/.test(errStr);
    // amb-mcp's PageTooLargeError stringifies as
    //   "PDF body (… bytes) exceeds size cap (… bytes)"
    //   "HTML body (… bytes) exceeds size cap (… bytes)"
    // We match on "exceeds size cap" so the wizard can show "page too big"
    // copy instead of the generic AI-failure message.
    const isPageTooLarge = /exceeds size cap/i.test(errStr);
    const err = /** @type {Error & { code?: string }} */ (
      new Error(`MCP extract_metadata tool error: ${errStr.slice(0, 200)}`)
    );
    err.code = isOverloaded ? 'overloaded' : isPageTooLarge ? 'page_too_large' : 'tool_error';
    throw err;
  }

  // The tool wraps its JSON result in content[0].text per MCP convention.
  const text = callRpc.result?.content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error('MCP extract_metadata returned no text content');
  }
  return JSON.parse(text);
}
