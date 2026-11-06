/**
 * Minimal streamable-HTTP MCP client for the deployed nope-mcp server
 * (formerly amb-mcp).
 *
 * Each `callNopeMcpTool` performs:
 *   1. POST initialize          → captures `Mcp-Session-Id` from the response
 *   2. POST notifications/initialized
 *   3. POST tools/call <name>
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
 * Run the `initialize` → `notifications/initialized` handshake and return
 * the session id to use for the following `tools/call`.
 *
 * @param {string} mcpUrl
 * @param {string | undefined} bearerToken
 * @returns {Promise<string>}
 */
async function mcpHandshake(mcpUrl, bearerToken) {
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

  await fetch(mcpUrl, {
    method: 'POST',
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
 * @returns {Promise<any>}
 */
export async function callNopeMcpTool({ mcpUrl, bearerToken, name, args }) {
  const sessionId = await mcpHandshake(mcpUrl, bearerToken);

  const callRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: buildHeaders(bearerToken, sessionId),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name, arguments: args }
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

  const result = callRpc.result;
  if (result?.isError) {
    const err = /** @type {Error & { isToolError?: boolean }} */ (new Error(toolErrorText(result)));
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
      args: toolArguments
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
