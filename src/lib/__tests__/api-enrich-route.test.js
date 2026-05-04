/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock amb-mcp/lib BEFORE importing the route — the route imports it eagerly.
const extractMetadataMock = vi.fn();
const createAnthropicClientMock = vi.fn(
  /** @param {string | undefined} apiKey */
  (apiKey) => (apiKey ? { __mockClient: true } : undefined)
);
vi.mock('amb-mcp/lib', () => ({
  /** @param {unknown} input */
  extractMetadata: (input) => extractMetadataMock(input),
  /** @param {string | undefined} apiKey */
  createAnthropicClient: (apiKey) => createAnthropicClientMock(apiKey)
}));

// Mock $env/dynamic/private — SvelteKit's env-import path.
vi.mock('$env/dynamic/private', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-key',
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
    extractMetadataMock.mockReset();
  });

  it('returns 400 when url is missing', async () => {
    const res = await POST(ev(makeRequest({ variant: 'amb' })));
    expect(res.status).toBe(400);
    expect(extractMetadataMock).not.toHaveBeenCalled();
  });

  it('returns 400 when url is not http/https', async () => {
    const res = await POST(ev(makeRequest({ url: 'file:///etc/passwd', variant: 'amb' })));
    expect(res.status).toBe(400);
    expect(extractMetadataMock).not.toHaveBeenCalled();
  });

  it('returns 400 when variant is invalid', async () => {
    const res = await POST(ev(makeRequest({ url: 'https://example.org', variant: 'bogus' })));
    expect(res.status).toBe(400);
    expect(extractMetadataMock).not.toHaveBeenCalled();
  });

  it('defaults variant to "amb" when omitted', async () => {
    extractMetadataMock.mockResolvedValueOnce({
      source: 'opengraph-only',
      payload: {},
      evidence: {},
      baseline: {}
    });
    const res = await POST(ev(makeRequest({ url: 'https://example.org' })));
    expect(res.status).toBe(200);
    expect(extractMetadataMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'amb' }));
  });

  it('forwards the result from extractMetadata as JSON', async () => {
    const result = {
      source: 'llm-enriched',
      payload: { name: 'X', learningResourceType: [{ id: 'urn:lrt:text', prefLabel: 'Text' }] },
      evidence: { learningResourceType: 'shows worksheet' },
      baseline: { og: { title: 'X' } }
    };
    extractMetadataMock.mockResolvedValueOnce(result);
    const res = await POST(ev(makeRequest({ url: 'https://example.org/page', variant: 'amb' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
  });

  it('returns 500 when extractMetadata throws', async () => {
    extractMetadataMock.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(ev(makeRequest({ url: 'https://example.org', variant: 'amb' })));
    expect(res.status).toBe(500);
  });

  it('passes ANTHROPIC_API_KEY-backed llmClient to extractMetadata when key is set', async () => {
    extractMetadataMock.mockResolvedValueOnce({
      source: 'llm-enriched',
      payload: {},
      evidence: {},
      baseline: {}
    });
    await POST(ev(makeRequest({ url: 'https://example.org', variant: 'ekw' })));
    const call = extractMetadataMock.mock.calls[0][0];
    expect(call.llmClient).toBeDefined();
    expect(call.skosSchemes).toBeDefined();
  });
});
