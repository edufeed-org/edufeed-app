/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { enrichFromUrl } from '$lib/helpers/educational/enrichFromUrl.js';

describe('enrichFromUrl', () => {
  it('POSTs {url, variant} as JSON to /api/enrich', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ source: 'opengraph-only', payload: {}, evidence: {}, baseline: {} }),
          { status: 200 }
        )
      );
    await enrichFromUrl('https://example.org/x', 'ekw', { fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchFn.mock.calls[0];
    expect(endpoint).toBe('/api/enrich');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ url: 'https://example.org/x', variant: 'ekw' });
  });

  it('forwards bildungsbereich when provided so the API can pick the subject vocab', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ source: 'opengraph-only', payload: {}, evidence: {}, baseline: {} }),
          { status: 200 }
        )
      );
    await enrichFromUrl('https://example.org/x', 'amb', { fetchFn, bildungsbereich: 'schule' });

    const [, init] = fetchFn.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      url: 'https://example.org/x',
      variant: 'amb',
      bildungsbereich: 'schule'
    });
  });

  it('returns the parsed result on 200', async () => {
    const result = {
      source: 'llm-enriched',
      payload: { name: 'X' },
      evidence: { name: 'quote' },
      baseline: {}
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));
    expect(await enrichFromUrl('https://example.org', 'amb', { fetchFn })).toEqual(result);
  });

  it('returns {error: "ai_unavailable", code: "network"} on non-200', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 500 }));
    expect(await enrichFromUrl('https://example.org', 'amb', { fetchFn })).toEqual({
      error: 'ai_unavailable',
      code: 'network'
    });
  });

  it('returns {error: "ai_unavailable", code: "network"} on network error (does not throw)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await enrichFromUrl('https://example.org', 'amb', { fetchFn })).toEqual({
      error: 'ai_unavailable',
      code: 'network'
    });
  });

  it('returns {error: "ai_unavailable", code: "network"} on malformed JSON', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('not json{', { status: 200 }));
    expect(await enrichFromUrl('https://example.org', 'amb', { fetchFn })).toEqual({
      error: 'ai_unavailable',
      code: 'network'
    });
  });

  it("passes through the server's {error, code} envelope when /api/enrich reports upstream failure", async () => {
    // /api/enrich commits headers (status 200) before knowing whether the
    // upstream extract_metadata succeeded, so it signals failure via a JSON
    // body {error: "ai_unavailable", code}. Make sure the client surfaces
    // that envelope verbatim instead of flattening to null.
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'ai_unavailable', code: 'overloaded' }), {
        status: 200
      })
    );
    expect(await enrichFromUrl('https://example.org', 'amb', { fetchFn })).toEqual({
      error: 'ai_unavailable',
      code: 'overloaded'
    });
  });

  it('aborts after the configured timeout (default 60s, override accepted)', async () => {
    /** @type {AbortSignal | undefined} */
    let abortSignal;
    const fetchFn = vi.fn((_endpoint, init) => {
      abortSignal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const promise = enrichFromUrl('https://example.org', 'amb', { fetchFn, timeoutMs: 10 });
    const result = await promise;
    expect(result).toEqual({ error: 'ai_unavailable', code: 'network' });
    expect(abortSignal?.aborted).toBe(true);
  });
});
