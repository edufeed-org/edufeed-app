/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the MCP client BEFORE importing the route — the route imports it eagerly.
const callExtractMetadataMock = vi.fn();
vi.mock('$lib/server/ambMcpClient.js', () => ({
  /** @param {unknown} input */
  callExtractMetadata: (input) => callExtractMetadataMock(input)
}));

// Mock $env/dynamic/private — SvelteKit's env-import path.
vi.mock('$env/dynamic/private', () => ({
  env: {
    AMB_MCP_URL: 'https://mcp.example/mcp',
    AMB_MCP_BEARER_TOKEN: 'test-token',
    SCHEME_NADDR_HCRT: 'naddr1hcrt',
    SCHEME_NADDR_KLASSENSTUFEN: 'naddr1klassen'
  }
}));

const { POST } = await import('../../routes/api/enrich/+server.js');

/** @param {Record<string, unknown>} body */
function makeRequest(body) {
  return new Request('http://localhost/api/enrich', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/**
 * Cast a partial RequestEvent for tests. SvelteKit's full type has many
 * runtime-only fields the route doesn't touch.
 * @param {Request} request
 * @returns {any}
 */
function ev(request) {
  return { request };
}

describe('POST /api/enrich', () => {
  beforeEach(() => {
    callExtractMetadataMock.mockReset();
  });

  it('returns 400 when url is missing', async () => {
    const res = await POST(ev(makeRequest({ variant: 'amb' })));
    expect(res.status).toBe(400);
    expect(callExtractMetadataMock).not.toHaveBeenCalled();
  });

  it('returns 400 when url is not http/https', async () => {
    const res = await POST(ev(makeRequest({ url: 'file:///etc/passwd', variant: 'amb' })));
    expect(res.status).toBe(400);
    expect(callExtractMetadataMock).not.toHaveBeenCalled();
  });

  it('returns 400 when variant is invalid', async () => {
    const res = await POST(ev(makeRequest({ url: 'https://example.org', variant: 'bogus' })));
    expect(res.status).toBe(400);
    expect(callExtractMetadataMock).not.toHaveBeenCalled();
  });

  it('defaults variant to "amb" when omitted', async () => {
    callExtractMetadataMock.mockResolvedValueOnce({
      source: 'opengraph-only',
      payload: {},
      evidence: {},
      baseline: {}
    });
    const res = await POST(ev(makeRequest({ url: 'https://example.org' })));
    expect(res.status).toBe(200);
    expect(callExtractMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'amb' })
    );
  });

  it('forwards the result from callExtractMetadata as JSON', async () => {
    const result = {
      source: 'llm-enriched',
      payload: { name: 'X', learningResourceType: [{ id: 'urn:lrt:text', prefLabel: 'Text' }] },
      evidence: { learningResourceType: 'shows worksheet' },
      baseline: { og: { title: 'X' } }
    };
    callExtractMetadataMock.mockResolvedValueOnce(result);
    const res = await POST(ev(makeRequest({ url: 'https://example.org/page', variant: 'amb' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
  });

  // The route streams whitespace heartbeats while the upstream MCP call is in
  // flight, so headers commit (status 200) before we know if extraction
  // succeeded. On failure we write `null` JSON — the client already maps any
  // non-success to `null`, so a `null` body is semantically equivalent.
  it('returns 200 with null body when callExtractMetadata throws', async () => {
    callExtractMetadataMock.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(ev(makeRequest({ url: 'https://example.org', variant: 'amb' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it('emits heartbeat whitespace while upstream is pending, then the JSON result', async () => {
    vi.useFakeTimers();
    /** @type {(value: any) => void} */
    let resolveUpstream = () => {};
    callExtractMetadataMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpstream = resolve;
        })
    );
    const res = await POST(ev(makeRequest({ url: 'https://example.org', variant: 'amb' })));
    expect(res.status).toBe(200);

    const reader = /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader();
    const dec = new TextDecoder();

    // Advance past two heartbeat ticks (5s each); each tick should enqueue one space.
    await vi.advanceTimersByTimeAsync(5_000);
    let chunk = await reader.read();
    expect(chunk.done).toBe(false);
    expect(dec.decode(chunk.value)).toBe(' ');

    await vi.advanceTimersByTimeAsync(5_000);
    chunk = await reader.read();
    expect(chunk.done).toBe(false);
    expect(dec.decode(chunk.value)).toBe(' ');

    // Resolve the upstream call — final chunk should be the JSON payload.
    const result = { source: 'llm-enriched', payload: { name: 'X' }, evidence: {}, baseline: {} };
    resolveUpstream(result);
    // Drain remaining chunks (could be JSON in one or split across reads).
    let body = '';
    // Microtask flush so the start() promise can advance to the JSON write.
    await Promise.resolve();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      body += dec.decode(value);
    }
    expect(JSON.parse(body)).toEqual(result);
    vi.useRealTimers();
  });

  it('passes mcpUrl, bearerToken, and skosSchemes to the client', async () => {
    callExtractMetadataMock.mockResolvedValueOnce({
      source: 'llm-enriched',
      payload: {},
      evidence: {},
      baseline: {}
    });
    await POST(ev(makeRequest({ url: 'https://example.org', variant: 'ekw' })));
    const call = callExtractMetadataMock.mock.calls[0][0];
    expect(call.mcpUrl).toBe('https://mcp.example/mcp');
    expect(call.bearerToken).toBe('test-token');
    expect(call.skosSchemes).toEqual({
      learningResourceType: 'naddr1hcrt',
      gradeLevels: 'naddr1klassen'
    });
  });
});

describe('POST /api/enrich without AMB_MCP_URL configured', () => {
  beforeEach(() => {
    callExtractMetadataMock.mockReset();
    vi.resetModules();
  });

  it('returns 503 when AMB_MCP_URL env is not set', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    vi.doMock('$lib/server/ambMcpClient.js', () => ({
      callExtractMetadata: callExtractMetadataMock
    }));
    const { POST: PostNoEnv } = await import('../../routes/api/enrich/+server.js');
    const res = await PostNoEnv(ev(makeRequest({ url: 'https://example.org' })));
    expect(res.status).toBe(503);
    expect(callExtractMetadataMock).not.toHaveBeenCalled();
  });
});
