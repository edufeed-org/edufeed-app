/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callExtractMetadata } from '../ambMcpClient.js';

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
