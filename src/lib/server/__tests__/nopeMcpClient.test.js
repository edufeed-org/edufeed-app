/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  callExtractMetadata,
  callNopeMcpTool,
  _resetNopeMcpSessionsForTests
} from '../nopeMcpClient.js';

/**
 * Build a Response that mimics the streamable-HTTP MCP server: SSE body with a
 * single `event: message` + `data: {...}` pair, optional Mcp-Session-Id header.
 *
 * @param {object} jsonRpc
 * @param {string | undefined} sessionId
 * @param {number} status
 */
function sseResponse(jsonRpc, sessionId, status = 200) {
  const body = `event: message\ndata: ${JSON.stringify(jsonRpc)}\n\n`;
  /** @type {Record<string, string>} */
  const headers = { 'content-type': 'text/event-stream' };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return new Response(body, { status, headers });
}

describe('callExtractMetadata', () => {
  /** @type {ReturnType<typeof vi.fn>} */
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    _resetNopeMcpSessionsForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes, sends initialized notification, and calls extract_metadata', async () => {
    const payload = {
      source: 'llm-enriched',
      payload: { name: 'Pythagorean theorem' },
      evidence: { name: 'page title' },
      baseline: { og: {} }
    };

    fetchMock
      // 1. initialize → returns session id in header
      .mockResolvedValueOnce(
        sseResponse(
          { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } },
          'sess-abc'
        )
      )
      // 2. notifications/initialized → 202 no body
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      // 3. tools/call → returns JSON-stringified payload as text content
      .mockResolvedValueOnce(
        sseResponse(
          {
            jsonrpc: '2.0',
            id: 2,
            result: { content: [{ type: 'text', text: JSON.stringify(payload) }] }
          },
          'sess-abc'
        )
      );

    const result = await callExtractMetadata({
      mcpUrl: 'https://mcp.example/mcp',
      bearerToken: 'tok',
      url: 'https://en.wikipedia.org/wiki/Pythagorean_theorem',
      variant: 'amb',
      skosSchemes: { learningResourceType: 'naddr1hcrt' }
    });

    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // extract_metadata (an LLM call) gets a generous bounded deadline, not the short search one
    const signals = fetchMock.mock.calls.map(([, init]) => init.signal);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
    expect(new Set(signals).size).toBe(1);

    // Each call carries Authorization + Accept negotiation
    for (const call of fetchMock.mock.calls) {
      const [, init] = call;
      expect(init.headers.Authorization).toBe('Bearer tok');
      expect(init.headers.Accept).toContain('text/event-stream');
    }

    // 1st call: initialize, no session id header
    const initBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(initBody.method).toBe('initialize');
    expect(fetchMock.mock.calls[0][1].headers['Mcp-Session-Id']).toBeUndefined();

    // 2nd call: initialized notification with session id
    const notifBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(notifBody.method).toBe('notifications/initialized');
    expect(fetchMock.mock.calls[1][1].headers['Mcp-Session-Id']).toBe('sess-abc');

    // 3rd call: tools/call extract_metadata with our args + session id
    const callBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(callBody.method).toBe('tools/call');
    expect(callBody.params.name).toBe('extract_metadata');
    expect(callBody.params.arguments).toEqual({
      url: 'https://en.wikipedia.org/wiki/Pythagorean_theorem',
      variant: 'amb',
      skosSchemes: { learningResourceType: 'naddr1hcrt' }
    });
    expect(fetchMock.mock.calls[2][1].headers['Mcp-Session-Id']).toBe('sess-abc');
  });

  it('forwards a urls array (multi-source) in the tools/call arguments', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          {
            jsonrpc: '2.0',
            id: 2,
            result: { content: [{ type: 'text', text: '{}' }] }
          },
          'sess'
        )
      );

    await callExtractMetadata({
      mcpUrl: 'https://mcp.example/mcp',
      bearerToken: 'tok',
      urls: ['https://a.example/x.pdf', 'https://b.example/y.pdf'],
      variant: 'amb',
      skosSchemes: {}
    });

    const callBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(callBody.params.arguments).toEqual({
      urls: ['https://a.example/x.pdf', 'https://b.example/y.pdf'],
      variant: 'amb',
      skosSchemes: {}
    });
    expect(callBody.params.arguments.url).toBeUndefined();
  });

  it('omits Authorization header when no token is configured', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess-1'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          {
            jsonrpc: '2.0',
            id: 2,
            result: { content: [{ type: 'text', text: '{}' }] }
          },
          'sess-1'
        )
      );

    await callExtractMetadata({
      mcpUrl: 'https://mcp.example/mcp',
      bearerToken: undefined,
      url: 'https://example.org',
      variant: 'amb',
      skosSchemes: {}
    });

    for (const call of fetchMock.mock.calls) {
      expect(call[1].headers.Authorization).toBeUndefined();
    }
  });

  it('throws when initialize returns non-200', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"unauthorized"}', { status: 401 }));

    await expect(
      callExtractMetadata({
        mcpUrl: 'https://mcp.example/mcp',
        bearerToken: 'wrong',
        url: 'https://example.org',
        variant: 'amb',
        skosSchemes: {}
      })
    ).rejects.toThrow(/initialize/i);
  });

  it('throws with code="overloaded" when tools/call returns isError with a 529/overloaded payload', async () => {
    // Real-world failure observed against mcp.amb.edufeed.org: the MCP SDK
    // wraps Anthropic 529s into a tool-level error envelope. The previous
    // implementation only checked `callRpc.error` (JSON-RPC level) and then
    // JSON.parse'd the text content, exploding on the leading "529 ".
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          {
            jsonrpc: '2.0',
            id: 2,
            result: {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_x"}'
                }
              ]
            }
          },
          'sess'
        )
      );

    let caught;
    try {
      await callExtractMetadata({
        mcpUrl: 'https://mcp.example/mcp',
        bearerToken: 'tok',
        url: 'https://example.org',
        variant: 'amb',
        skosSchemes: {}
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(/** @type {any} */ (caught).code).toBe('overloaded');
    expect(/** @type {Error} */ (caught).message).toMatch(/overload/i);
  });

  it('throws with code="page_too_large" when tools/call returns isError flagging an oversized page', async () => {
    // nope-mcp's fetchPage throws PageTooLargeError when the body exceeds the
    // configured byte cap. The MCP SDK wraps the throw into result.isError
    // with the error message in content[0].text. We surface this distinctly
    // so the wizard can prompt the user with a useful hint instead of the
    // generic "AI enrichment failed".
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          {
            jsonrpc: '2.0',
            id: 2,
            result: {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: 'PDF body (12345678 bytes) exceeds size cap (5242880 bytes)'
                }
              ]
            }
          },
          'sess'
        )
      );

    let caught;
    try {
      await callExtractMetadata({
        mcpUrl: 'https://mcp.example/mcp',
        bearerToken: 'tok',
        url: 'https://example.org/huge.pdf',
        variant: 'amb',
        skosSchemes: {}
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(/** @type {any} */ (caught).code).toBe('page_too_large');
  });

  it('throws with code="unsupported_type" when tools/call returns isError for a non-HTML/PDF source', async () => {
    // nope-mcp ≥ 0.5.0: fetchPage rejects office documents etc. with
    // "unsupported content type application/vnd.ms-powerpoint for <url>".
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          {
            jsonrpc: '2.0',
            id: 2,
            result: {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: 'unsupported content type application/vnd.ms-powerpoint for https://example.org/M1.PPT'
                }
              ]
            }
          },
          'sess'
        )
      );

    let caught;
    try {
      await callExtractMetadata({
        mcpUrl: 'https://mcp.example/mcp',
        bearerToken: 'tok',
        url: 'https://example.org/M1.PPT',
        variant: 'ekw',
        skosSchemes: {}
      });
    } catch (err) {
      caught = err;
    }
    expect(/** @type {any} */ (caught).code).toBe('unsupported_type');
  });

  it('throws with code="tool_error" when tools/call returns isError with a generic payload', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          {
            jsonrpc: '2.0',
            id: 2,
            result: {
              isError: true,
              content: [{ type: 'text', text: 'fetch failed with status 404' }]
            }
          },
          'sess'
        )
      );

    let caught;
    try {
      await callExtractMetadata({
        mcpUrl: 'https://mcp.example/mcp',
        bearerToken: 'tok',
        url: 'https://example.org',
        variant: 'amb',
        skosSchemes: {}
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(/** @type {any} */ (caught).code).toBe('tool_error');
  });

  it('throws when tools/call returns a JSON-RPC error', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          { jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'tool blew up' } },
          'sess'
        )
      );

    await expect(
      callExtractMetadata({
        mcpUrl: 'https://mcp.example/mcp',
        bearerToken: 'tok',
        url: 'https://example.org',
        variant: 'amb',
        skosSchemes: {}
      })
    ).rejects.toThrow(/tool blew up/);
  });
});

describe('callNopeMcpTool', () => {
  /** @type {ReturnType<typeof vi.fn>} */
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    _resetNopeMcpSessionsForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the given tool name and arguments', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{}' }] } },
          'sess'
        )
      );

    await callNopeMcpTool({
      mcpUrl: 'https://mcp.example/mcp',
      bearerToken: 'tok',
      name: 'search_resources',
      args: { query: 'photosynthesis' }
    });

    const callBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(callBody.method).toBe('tools/call');
    expect(callBody.params.name).toBe('search_resources');
    expect(callBody.params.arguments).toEqual({ query: 'photosynthesis' });
    // one deadline signal shared by initialize, initialized and tools/call
    const signals = fetchMock.mock.calls.map(([, init]) => init.signal);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(new Set(signals).size).toBe(1);
  });

  it('rejects when nope-mcp hangs past the deadline', async () => {
    fetchMock.mockImplementation(
      (/** @type {string} */ _url, /** @type {RequestInit} */ init) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        )
    );
    await expect(
      callNopeMcpTool({
        mcpUrl: 'https://mcp.example/mcp',
        bearerToken: undefined,
        name: 'x',
        args: {},
        timeoutMs: 20
      })
    ).rejects.toThrow(/timed out|abort/i);
  });

  it('omits Authorization header when no bearerToken is given', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{}' }] } },
          'sess'
        )
      );

    await callNopeMcpTool({
      mcpUrl: 'https://mcp.example/mcp',
      bearerToken: undefined,
      name: 'search_resources',
      args: {}
    });

    for (const call of fetchMock.mock.calls) {
      expect(call[1].headers.Authorization).toBeUndefined();
    }
  });

  it('returns result.structuredContent when present, without parsing text content', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          {
            jsonrpc: '2.0',
            id: 2,
            result: {
              structuredContent: { items: [{ id: 'abc' }] },
              content: [{ type: 'text', text: 'not json' }]
            }
          },
          'sess'
        )
      );

    const result = await callNopeMcpTool({
      mcpUrl: 'https://mcp.example/mcp',
      bearerToken: 'tok',
      name: 'search_resources',
      args: {}
    });

    expect(result).toEqual({ items: [{ id: 'abc' }] });
  });

  it('throws with the JSON-RPC error message when tools/call returns an error', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          { jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'search blew up' } },
          'sess'
        )
      );

    await expect(
      callNopeMcpTool({
        mcpUrl: 'https://mcp.example/mcp',
        bearerToken: 'tok',
        name: 'search_resources',
        args: {}
      })
    ).rejects.toThrow(/search blew up/);
  });

  it('reuses the cached session on a second call: only tools/call, no re-handshake', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{}' }] } },
          'sess'
        )
      )
      .mockResolvedValueOnce(
        sseResponse(
          { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{}' }] } },
          'sess'
        )
      );

    await callNopeMcpTool({
      mcpUrl: 'https://mcp.example/mcp',
      bearerToken: 'tok',
      name: 'search_resources',
      args: {}
    });
    fetchMock.mockClear(); // only the second call's requests matter below
    await callNopeMcpTool({
      mcpUrl: 'https://mcp.example/mcp',
      bearerToken: 'tok',
      name: 'search_resources',
      args: {}
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(callBody.method).toBe('tools/call');
    expect(fetchMock.mock.calls[0][1].headers['Mcp-Session-Id']).toBe('sess');
  });

  it('drops the session and retries once when tools/call answers 404 (session expired)', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess-old'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess-new'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          {
            jsonrpc: '2.0',
            id: 2,
            result: { content: [{ type: 'text', text: '{"ok":true}' }] }
          },
          'sess-new'
        )
      );

    const result = await callNopeMcpTool({
      mcpUrl: 'https://mcp.example/mcp',
      bearerToken: 'tok',
      name: 'search_resources',
      args: {}
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls[5][1].headers['Mcp-Session-Id']).toBe('sess-new');
  });

  it('drops the session and retries once when tools/call answers 400 "session not found"', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess-old'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response('{"error":"Session not found"}', { status: 400 }))
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess-new'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{}' }] } },
          'sess-new'
        )
      );

    await callNopeMcpTool({
      mcpUrl: 'https://mcp.example/mcp',
      bearerToken: 'tok',
      name: 'search_resources',
      args: {}
    });

    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  /**
   * A dynamic fetch mock that behaves like nope-mcp for the pool tests below:
   * every `initialize` gets a fresh, never-reused session id; `tools/call`
   * always succeeds, echoing the `Mcp-Session-Id` it was called with; `DELETE`
   * is acknowledged and recorded.
   * @returns {{ initCount: () => number, deletedSessionIds: () => string[] }}
   */
  function mockDynamicNopeMcp() {
    let n = 0;
    /** @type {string[]} */
    const deleted = [];
    fetchMock.mockImplementation(async (/** @type {string} */ _url, /** @type {any} */ init) => {
      if (init.method === 'DELETE') {
        deleted.push(init.headers['Mcp-Session-Id']);
        return new Response(null, { status: 204 });
      }
      const body = JSON.parse(init.body);
      if (body.method === 'initialize') {
        n++;
        return sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, `sess-${n}`);
      }
      if (body.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }
      return sseResponse(
        { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{}' }] } },
        init.headers['Mcp-Session-Id']
      );
    });
    return { initCount: () => n, deletedSessionIds: () => deleted };
  }

  it('three parallel calls each get their own session; a later sequential call reuses one (no initialize)', async () => {
    const mcp = mockDynamicNopeMcp();
    const call = (/** @type {string} */ name) =>
      callNopeMcpTool({ mcpUrl: 'https://mcp.example/mcp', bearerToken: 'tok', name, args: {} });

    await Promise.all([call('a'), call('b'), call('c')]);

    expect(mcp.initCount()).toBe(3); // one handshake per concurrent call, never shared
    const toolCallSessionIds = fetchMock.mock.calls
      .map(([, init]) => ({
        method: JSON.parse(init.body).method,
        sid: init.headers['Mcp-Session-Id']
      }))
      .filter((c) => c.method === 'tools/call')
      .map((c) => c.sid);
    expect(new Set(toolCallSessionIds).size).toBe(3); // three distinct Mcp-Session-Ids

    fetchMock.mockClear();
    await call('d');
    expect(fetchMock).toHaveBeenCalledTimes(1); // reused a free pooled session: tools/call only
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).method).toBe('tools/call');
    expect(toolCallSessionIds).toContain(fetchMock.mock.calls[0][1].headers['Mcp-Session-Id']);
  });

  it('caps the pool at 8 sessions: a 9th concurrent call gets a one-off session that is not kept', async () => {
    const mcp = mockDynamicNopeMcp();
    const call = () =>
      callNopeMcpTool({
        mcpUrl: 'https://mcp.example/mcp',
        bearerToken: 'tok',
        name: 'a',
        args: {}
      });

    await Promise.all(Array.from({ length: 9 }, call));
    expect(mcp.initCount()).toBe(9); // every concurrent call needs its own handshake, cap or not

    const afterFirstBatch = mcp.initCount();
    await Promise.all(Array.from({ length: 9 }, call));
    // 8 reuse the capped pool; only the 9th (over the cap) needs a fresh one-off handshake again
    expect(mcp.initCount() - afterFirstBatch).toBe(1);
  });

  it('a different mcpUrl gets its own session', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess-a'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{}' }] } },
          'sess-a'
        )
      )
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess-b'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{}' }] } },
          'sess-b'
        )
      );

    await callNopeMcpTool({
      mcpUrl: 'https://mcp.example/mcp',
      bearerToken: 'tok',
      name: 'a',
      args: {}
    });
    await callNopeMcpTool({
      mcpUrl: 'https://other.example/mcp',
      bearerToken: 'tok',
      name: 'a',
      args: {}
    });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const initCalls = fetchMock.mock.calls.filter(
      ([, init]) => JSON.parse(init.body).method === 'initialize'
    );
    expect(initCalls).toHaveLength(2);
  });

  it('a tools/call that rejects (abort/timeout) discards its session with a DELETE; the next call never reuses it', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess-1'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'))
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // DELETE sess-1
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess-2'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse(
          { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{}' }] } },
          'sess-2'
        )
      );

    await expect(
      callNopeMcpTool({
        mcpUrl: 'https://mcp.example/mcp',
        bearerToken: 'tok',
        name: 'a',
        args: {}
      })
    ).rejects.toThrow(/abort/i);

    await callNopeMcpTool({
      mcpUrl: 'https://mcp.example/mcp',
      bearerToken: 'tok',
      name: 'a',
      args: {}
    });

    const calls = fetchMock.mock.calls.map(([, init]) => init);
    const deletes = calls.filter((init) => init.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].headers['Mcp-Session-Id']).toBe('sess-1');

    const toolCalls = calls.filter(
      (init) => init.method !== 'DELETE' && JSON.parse(init.body).method === 'tools/call'
    );
    expect(toolCalls.map((init) => init.headers['Mcp-Session-Id'])).toEqual(['sess-1', 'sess-2']);
  });

  it('404 then a failing re-handshake rolls back cleanly: no stale id, no leaked busy slot', async () => {
    const mcp = mockDynamicNopeMcp();
    fetchMock
      .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess-stale')) // init
      .mockResolvedValueOnce(new Response(null, { status: 202 })) // notified
      .mockResolvedValueOnce(new Response('', { status: 404 })) // tools/call: session expired
      .mockResolvedValueOnce(new Response('', { status: 500 })); // re-handshake's initialize fails

    await expect(
      callNopeMcpTool({
        mcpUrl: 'https://mcp.example/mcp',
        bearerToken: 'tok',
        name: 'a',
        args: {}
      })
    ).rejects.toThrow(/initialize/i);
    fetchMock.mockClear(); // only calls from here on matter: the failed attempt legitimately sent 'sess-stale' once

    const call = () =>
      callNopeMcpTool({
        mcpUrl: 'https://mcp.example/mcp',
        bearerToken: 'tok',
        name: 'a',
        args: {}
      });

    // the pool was empty before the incident and must be empty again: a full-cap
    // batch needs exactly 8 inits (no leftover busyCount blocking a slot)
    const before1 = mcp.initCount();
    await Promise.all(Array.from({ length: 8 }, call));
    expect(mcp.initCount() - before1).toBe(8);

    const toolCallSessionIds = fetchMock.mock.calls
      .map(([, init]) => init)
      .filter((init) => init.method !== 'DELETE' && JSON.parse(init.body).method === 'tools/call')
      .map((init) => init.headers['Mcp-Session-Id']);
    expect(toolCallSessionIds).not.toContain('sess-stale'); // the stale, discarded id is never sent again

    // a second full-cap batch right after needs NO new inits: every session from
    // the first batch was cleanly pooled (none leaked as an unkept one-off)
    const before2 = mcp.initCount();
    await Promise.all(Array.from({ length: 8 }, call));
    expect(mcp.initCount() - before2).toBe(0);
  });

  it('a one-off session (over the pool cap) gets exactly one DELETE after use', async () => {
    const mcp = mockDynamicNopeMcp();
    const call = () =>
      callNopeMcpTool({
        mcpUrl: 'https://mcp.example/mcp',
        bearerToken: 'tok',
        name: 'a',
        args: {}
      });

    await Promise.all(Array.from({ length: 9 }, call)); // 9th exceeds POOL_CAP(8): one-off, never pooled

    expect(mcp.deletedSessionIds()).toHaveLength(1);
  });

  it('a bearer token change starts a fresh pool; the old token session is not reused', async () => {
    const mcp = mockDynamicNopeMcp();
    const callWith = (/** @type {string} */ bearerToken) =>
      callNopeMcpTool({ mcpUrl: 'https://mcp.example/mcp', bearerToken, name: 'a', args: {} });

    await callWith('tok-a');
    expect(mcp.initCount()).toBe(1);
    await callWith('tok-a'); // same token: reuses the freed session, no new handshake
    expect(mcp.initCount()).toBe(1);

    await callWith('tok-b'); // token rotates: fresh pool, must handshake again
    expect(mcp.initCount()).toBe(2);

    const toolCallSessionIds = fetchMock.mock.calls
      .map(([, init]) => init)
      .filter((init) => init.method !== 'DELETE' && JSON.parse(init.body).method === 'tools/call')
      .map((init) => init.headers['Mcp-Session-Id']);
    expect(toolCallSessionIds[0]).toBe(toolCallSessionIds[1]); // tok-a's session reused once
    expect(toolCallSessionIds[2]).not.toBe(toolCallSessionIds[0]); // tok-b never gets tok-a's session
  });
});

describe('callNopeMcpTool HTTP errors', () => {
  beforeEach(() => _resetNopeMcpSessionsForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('carries the HTTP status on an initialize failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 401 })));
    await expect(
      callNopeMcpTool({
        mcpUrl: 'https://mcp.example/mcp',
        bearerToken: undefined,
        name: 'x',
        args: {}
      })
    ).rejects.toMatchObject({ status: 401 });
  });

  it('carries the HTTP status on a tools/call failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(sseResponse({ jsonrpc: '2.0', id: 1, result: {} }, 'sess'))
        .mockResolvedValueOnce(new Response(null, { status: 202 }))
        .mockResolvedValueOnce(new Response('', { status: 401 }))
    );
    await expect(
      callNopeMcpTool({
        mcpUrl: 'https://mcp.example/mcp',
        bearerToken: undefined,
        name: 'x',
        args: {}
      })
    ).rejects.toMatchObject({ status: 401 });
  });
});
