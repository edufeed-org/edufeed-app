/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callExtractMetadata, callNopeMcpTool } from '../nopeMcpClient.js';

const URL_ = 'https://mcp.example/mcp';

/** A plain JSON answer, as a 2026-07-28 server sends it. @param {object} result @param {number} [status] */
const jsonResponse = (result, status = 200) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
/** @param {unknown} value */
const textResult = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  resultType: 'complete'
});
/** @param {string} text */
const toolError = (text) => jsonResponse({ isError: true, content: [{ type: 'text', text }] });

/** @type {ReturnType<typeof vi.fn>} */
let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callNopeMcpTool', () => {
  it('sends ONE standalone 2026-07-28 request: no handshake, no session, headers agree with the body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textResult({ ok: 1 })));

    const out = await callNopeMcpTool({
      mcpUrl: URL_,
      bearerToken: 'tok',
      name: 'search_resources',
      args: { query: 'photosynthesis' }
    });

    expect(out).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL_);
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2026-07-28',
      'Mcp-Method': 'tools/call',
      'Mcp-Name': 'search_resources',
      Authorization: 'Bearer tok'
    });
    expect(init.headers).not.toHaveProperty('Mcp-Session-Id');
    const body = JSON.parse(init.body);
    expect(body.method).toBe('tools/call');
    expect(body.params.name).toBe('search_resources');
    expect(body.params.arguments).toEqual({ query: 'photosynthesis' });
    expect(body.params._meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');
    expect(body.params._meta['io.modelcontextprotocol/clientInfo'].name).toBe('edufeed-app');
    expect(body.params._meta['io.modelcontextprotocol/clientCapabilities']).toEqual({});
  });

  it('parallel calls are independent requests', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(textResult({})));
    await Promise.all(
      [1, 2, 3].map((i) =>
        callNopeMcpTool({ mcpUrl: URL_, bearerToken: undefined, name: 't', args: { i } })
      )
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('omits Authorization when no bearerToken is given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textResult({})));
    await callNopeMcpTool({ mcpUrl: URL_, bearerToken: undefined, name: 't', args: {} });
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it('timeoutMs: null sends no deadline signal', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textResult({})));
    await callNopeMcpTool({
      mcpUrl: URL_,
      bearerToken: undefined,
      name: 't',
      args: {},
      timeoutMs: null
    });
    expect(fetchMock.mock.calls[0][1].signal).toBeUndefined();
  });

  it('rejects when the server hangs past the deadline', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason));
        })
    );
    await expect(
      callNopeMcpTool({ mcpUrl: URL_, bearerToken: undefined, name: 't', args: {}, timeoutMs: 20 })
    ).rejects.toThrow();
  });

  it('returns result.structuredContent when present, without parsing text content', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ structuredContent: { a: 1 }, content: [{ type: 'text', text: 'not json' }] })
    );
    expect(
      await callNopeMcpTool({ mcpUrl: URL_, bearerToken: undefined, name: 't', args: {} })
    ).toEqual({ a: 1 });
  });

  it('raw: true returns the text content untouched', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textResult('uri | label\n---\nx | y')));
    expect(
      await callNopeMcpTool({
        mcpUrl: URL_,
        bearerToken: undefined,
        name: 't',
        args: {},
        raw: true
      })
    ).toBe('uri | label\n---\nx | y');
  });

  it('reads an SSE answer and takes the response, not a progress notification before it', async () => {
    const sse =
      `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })}\n\n` +
      `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: textResult({ done: true }) })}\n\n`;
    fetchMock.mockResolvedValueOnce(
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    );
    expect(
      await callNopeMcpTool({ mcpUrl: URL_, bearerToken: undefined, name: 't', args: {} })
    ).toEqual({ done: true });
  });

  it('a tool-level failure throws its text with isToolError', async () => {
    fetchMock.mockResolvedValueOnce(toolError('Invalid naddr'));
    await expect(
      callNopeMcpTool({ mcpUrl: URL_, bearerToken: undefined, name: 't', args: {} })
    ).rejects.toMatchObject({ message: 'Invalid naddr', isToolError: true });
  });

  it('a JSON-RPC error throws its message, not as a tool error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'nope' } }),
        {
          status: 200
        }
      )
    );
    const err = await callNopeMcpTool({
      mcpUrl: URL_,
      bearerToken: undefined,
      name: 't',
      args: {}
    }).catch((e) => e);
    expect(err.message).toBe('MCP tool error: nope');
    expect(err.isToolError).toBeUndefined();
  });

  it('carries the HTTP status on a failure (e.g. 401, or 404 from a server that still needs sessions)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 401 }));
    await expect(
      callNopeMcpTool({ mcpUrl: URL_, bearerToken: 'bad', name: 't', args: {} })
    ).rejects.toMatchObject({ status: 401, message: 'MCP tools/call failed: HTTP 401' });
  });

  it('throws when the result has no text content', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [] }));
    await expect(
      callNopeMcpTool({ mcpUrl: URL_, bearerToken: undefined, name: 't', args: {} })
    ).rejects.toThrow('MCP tool returned no text content');
  });
});

describe('callExtractMetadata', () => {
  const base = {
    mcpUrl: URL_,
    bearerToken: 'tok',
    variant: /** @type {const} */ ('amb'),
    skosSchemes: { about: 'naddr1x' }
  };

  it('calls extract_metadata with the single-url shape and a 5-minute deadline', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textResult({ source: 'llm', payload: {} })));
    const out = await callExtractMetadata({ ...base, url: 'https://example.org/a' });
    expect(out).toEqual({ source: 'llm', payload: {} });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params.name).toBe('extract_metadata');
    expect(body.params.arguments).toEqual({
      url: 'https://example.org/a',
      variant: 'amb',
      skosSchemes: { about: 'naddr1x' }
    });
    expect(fetchMock.mock.calls[0][1].headers['Mcp-Name']).toBe('extract_metadata');
  });

  it('forwards a urls array (multi-source)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textResult({})));
    await callExtractMetadata({ ...base, urls: ['https://a.example', 'https://b.example'] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).params.arguments.urls).toEqual([
      'https://a.example',
      'https://b.example'
    ]);
  });

  it('requires a url', async () => {
    await expect(callExtractMetadata({ ...base })).rejects.toThrow(/requires `url`/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['529 {"type":"error","error":{"type":"overloaded_error"}}', 'overloaded'],
    ['PDF body (9 bytes) exceeds size cap (1 bytes)', 'page_too_large'],
    ['unsupported content type application/zip for https://x', 'unsupported_type'],
    ['something else', 'tool_error']
  ])('maps the tool error %j to code %s', async (text, code) => {
    fetchMock.mockResolvedValueOnce(toolError(text));
    await expect(
      callExtractMetadata({ ...base, url: 'https://example.org/a' })
    ).rejects.toMatchObject({ code });
  });

  it('passes a non-tool failure through unchanged', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 503 }));
    await expect(
      callExtractMetadata({ ...base, url: 'https://example.org/a' })
    ).rejects.toMatchObject({ status: 503 });
  });
});
