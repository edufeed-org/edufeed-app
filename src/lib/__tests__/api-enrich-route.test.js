/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { postJson, ev } from './apiRoute.fixtures.js';

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
    SCHEME_NADDR_EKW_LRT: 'naddr1ekwlrt',
    SCHEME_NADDR_KLASSENSTUFEN: 'naddr1klassen',
    SCHEME_NADDR_LANDESKIRCHEN: 'naddr1landes',
    SCHEME_NADDR_KONFI_ZIELGRUPPEN: 'naddr1kziel',
    SCHEME_NADDR_KONFI_LERNFORMAT: 'naddr1klernf',
    SCHEME_NADDR_KONFI_ZEITSTRUKTUR: 'naddr1kzeit',
    SCHEME_NADDR_KONFI_BETEILIGTE: 'naddr1kbet',
    SCHEME_NADDR_KONFI_THEMEN: 'naddr1kthemen',
    SCHEME_NADDR_KONFI_DIMENSIONEN: 'naddr1kdim',
    SCHEME_NADDR_KONFI_METHODE: 'naddr1kmeth',
    SCHEME_NADDR_KONFI_MATERIALAUFWAND: 'naddr1kmat',
    SCHEME_NADDR_KONFI_TECHNIKBEDARF: 'naddr1ktech',
    SCHEME_NADDR_KONFI_LERNORTE: 'naddr1klernorte'
  }
}));

const { POST } = await import('../../routes/api/enrich/+server.js');

/** @param {Record<string, unknown>} body */
const makeRequest = (body) => postJson('/api/enrich', body);

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

  it('accepts a urls array of valid http(s) URLs and forwards it', async () => {
    callExtractMetadataMock.mockResolvedValueOnce({
      source: 'llm-enriched',
      payload: {},
      evidence: {},
      baseline: {}
    });
    const res = await POST(
      ev(
        makeRequest({
          urls: ['https://a.example/x.pdf', 'https://b.example/y.pdf'],
          variant: 'amb'
        })
      )
    );
    expect(res.status).toBe(200);
    expect(callExtractMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({ urls: ['https://a.example/x.pdf', 'https://b.example/y.pdf'] })
    );
  });

  it('rejects a urls array containing an invalid URL', async () => {
    const res = await POST(
      ev(makeRequest({ urls: ['https://a.example/x.pdf', 'javascript:alert(1)'], variant: 'amb' }))
    );
    expect(res.status).toBe(400);
    expect(callExtractMetadataMock).not.toHaveBeenCalled();
  });

  it('rejects an empty urls array', async () => {
    const res = await POST(ev(makeRequest({ urls: [], variant: 'amb' })));
    expect(res.status).toBe(400);
    expect(callExtractMetadataMock).not.toHaveBeenCalled();
  });

  it('rejects a urls array exceeding the source cap', async () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `https://e.example/${i}.pdf`);
    const res = await POST(ev(makeRequest({ urls: tooMany, variant: 'amb' })));
    expect(res.status).toBe(400);
    expect(callExtractMetadataMock).not.toHaveBeenCalled();
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
  // succeeded. On failure we write {error: "ai_unavailable", code} JSON so
  // the client can distinguish "extractor down" from "extracted nothing"
  // and show a useful hint to the user.
  it('returns {error, code} body when callExtractMetadata throws a generic error', async () => {
    callExtractMetadataMock.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(ev(makeRequest({ url: 'https://example.org', variant: 'amb' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ error: 'ai_unavailable', code: 'unknown' });
  });

  it('preserves the upstream error code (e.g. "overloaded") in the response body', async () => {
    const upstreamErr = /** @type {Error & { code?: string }} */ (new Error('Overloaded'));
    upstreamErr.code = 'overloaded';
    callExtractMetadataMock.mockRejectedValueOnce(upstreamErr);
    const res = await POST(ev(makeRequest({ url: 'https://example.org', variant: 'amb' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ error: 'ai_unavailable', code: 'overloaded' });
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
      learningResourceType: 'naddr1ekwlrt',
      gradeLevels: 'naddr1klassen'
    });
  });

  it('uses HCRT learningResourceType vocab for AMB variant', async () => {
    callExtractMetadataMock.mockResolvedValueOnce({
      source: 'llm-enriched',
      payload: {},
      evidence: {},
      baseline: {}
    });
    await POST(ev(makeRequest({ url: 'https://example.org', variant: 'amb' })));
    const call = callExtractMetadataMock.mock.calls[0][0];
    expect(call.skosSchemes.learningResourceType).toBe('naddr1hcrt');
  });

  it('accepts variant=konfi and forwards konfi skosSchemes (no EKW school schemes)', async () => {
    callExtractMetadataMock.mockResolvedValueOnce({
      source: 'llm-enriched',
      payload: {},
      evidence: {},
      baseline: {}
    });
    const res = await POST(ev(makeRequest({ url: 'https://example.org', variant: 'konfi' })));
    expect(res.status).toBe(200);
    const call = callExtractMetadataMock.mock.calls[0][0];
    expect(call.variant).toBe('konfi');
    // Konfi reuses EKW LRT vocab (Stationenlernen etc.), not HCRT.
    expect(call.skosSchemes.learningResourceType).toBe('naddr1ekwlrt');
    expect(call.skosSchemes).toMatchObject({
      learningResourceType: 'naddr1ekwlrt',
      landeskirchen: 'naddr1landes',
      konfiZielgruppen: 'naddr1kziel',
      konfiLernformat: 'naddr1klernf',
      konfiZeitstruktur: 'naddr1kzeit',
      konfiBeteiligte: 'naddr1kbet',
      konfiThemen: 'naddr1kthemen',
      konfiDimensionen: 'naddr1kdim',
      konfiMethode: 'naddr1kmeth',
      konfiMaterialaufwand: 'naddr1kmat',
      konfiTechnikbedarf: 'naddr1ktech',
      konfiLernorte: 'naddr1klernorte'
    });
    // School-context schemes must not leak in — those would mis-steer the LLM
    // toward EKW form fields the konfi schema rejects.
    expect(call.skosSchemes).not.toHaveProperty('gradeLevels');
    expect(call.skosSchemes).not.toHaveProperty('schoolTypes');
    expect(call.skosSchemes).not.toHaveProperty('ekwFachrichtung');
    expect(call.skosSchemes).not.toHaveProperty('methods');
    expect(call.skosSchemes).not.toHaveProperty('didacticConcepts');
    expect(call.skosSchemes).not.toHaveProperty('about');
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
