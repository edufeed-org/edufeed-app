/**
 * Minimal MCP client for the deployed nope-mcp and MEM-MCP servers, speaking
 * spec revision 2026-07-28: no handshake, no session. Every tool call is ONE
 * standalone POST that carries its protocol version and client info in
 * `params._meta` (the `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name`
 * headers must agree with the body, the server answers 400 otherwise), so any
 * number of calls can run in parallel and nothing has to be cleaned up.
 *
 * Needs servers on the MCP v2 packages (nope-mcp ≥ 0.8.0, mem-mcp ≥ 3.0.0);
 * an older server answers the standalone call with 404 or 400. Tokens are
 * never logged.
 */

const PROTOCOL_VERSION = '2026-07-28';
const META = {
  'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'edufeed-app', version: '0.2.0' },
  'io.modelcontextprotocol/clientCapabilities': {}
};

/** Whole-call deadline. process.env, not $env: the eval script imports this module from plain node. */
const DEFAULT_TIMEOUT_MS = Number(process.env.NOPE_MCP_TIMEOUT_MS) || 10000;

/**
 * Budget for one extract_metadata call. The wizard (enrichFromUrl.js) gives up
 * after 60 s, so work past that is paid for and thrown away; undici's own
 * defaults would wait 300 s.
 */
export const EXTRACT_TIMEOUT_MS = 60_000;

/**
 * An HTTP-level failure; `status` lets callers detect e.g. a 401 cleanly.
 * @param {string} message
 * @param {number} status
 */
function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

/**
 * The JSON-RPC response of a tool call: a plain JSON body, or — when the tool
 * reported progress first (`extract_metadata`) — an SSE body whose `data:`
 * lines are notifications followed by the response (the one with an `id`).
 * @param {string} body
 * @returns {any}
 */
function parseJsonRpc(body) {
  if (body.trimStart().startsWith('{')) return JSON.parse(body);
  let last;
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const json = line.slice(5).trim();
    if (!json) continue;
    last = JSON.parse(json);
    if (last.id !== undefined && (last.result !== undefined || last.error !== undefined)) {
      return last;
    }
  }
  if (last) return last;
  throw new Error('MCP response missing data line');
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
 * Call any tool on an MCP server and return its parsed result:
 * `result.structuredContent` when present, otherwise `JSON.parse` of the
 * first text content block — unless `raw: true`, which returns that text
 * content untouched instead of `JSON.parse`-ing it (for an MCP server like
 * MEM-MCP whose tools answer in plain text/a pipe table, never JSON).
 *
 * A tool-level failure (`result.isError`) is thrown as a plain `Error`
 * carrying the raw tool error text as its message and `isToolError: true`,
 * so callers that need to classify specific failures (e.g.
 * `callExtractMetadata`) can do so without this generic helper guessing at
 * domain-specific error shapes. This happens before the `raw` branch, so
 * `raw: true` doesn't change `isError` handling at all.
 *
 * @param {object} params
 * @param {string} params.mcpUrl - Full `/mcp` endpoint URL.
 * @param {string | undefined} params.bearerToken - If set, sent as `Authorization: Bearer <token>`.
 * @param {string} params.name - MCP tool name.
 * @param {object} params.args - Tool arguments.
 * @param {number | null} [params.timeoutMs] - Whole-call deadline; default `NOPE_MCP_TIMEOUT_MS` or 10000, `null` = none.
 * @param {AbortSignal} [params.signal] - Aborts the call early (e.g. the browser disconnected).
 * @param {boolean} [params.raw] - Return the text content as-is instead of `JSON.parse`-ing it.
 * @returns {Promise<any>}
 */
export async function callNopeMcpTool({
  mcpUrl,
  bearerToken,
  name,
  args,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
  raw = false
}) {
  /** @type {Record<string, string>} */
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
    'Mcp-Method': 'tools/call',
    'Mcp-Name': name
  };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  const deadline = timeoutMs === null ? undefined : AbortSignal.timeout(timeoutMs);
  const res = await fetch(mcpUrl, {
    method: 'POST',
    signal: deadline && signal ? AbortSignal.any([deadline, signal]) : (deadline ?? signal),
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args, _meta: META }
    })
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw httpError(`MCP tools/call failed: HTTP ${res.status}`, res.status);
  }

  const rpc = parseJsonRpc(await res.text());
  if (rpc.error) {
    throw new Error(`MCP tool error: ${rpc.error.message}`);
  }

  const result = rpc.result;
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
  return raw ? text : JSON.parse(text);
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
 * @param {AbortSignal} [params.signal] - Aborts the call early (e.g. the browser disconnected).
 * @returns {Promise<{ source: string, payload: object, evidence: object, baseline: object }>}
 */
export async function callExtractMetadata({
  mcpUrl,
  bearerToken,
  url,
  urls,
  variant,
  skosSchemes,
  signal
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
      // An LLM extraction runs far past the search deadline.
      timeoutMs: EXTRACT_TIMEOUT_MS,
      signal
    });
  } catch (err) {
    if (/** @type {any} */ (err)?.name === 'TimeoutError') {
      const timeout = /** @type {Error & { code?: string }} */ (
        new Error(`MCP extract_metadata timed out after ${EXTRACT_TIMEOUT_MS} ms`)
      );
      timeout.code = 'timeout';
      throw timeout;
    }
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
