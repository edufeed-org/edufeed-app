/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { callExtractMetadata } from '$lib/server/nopeMcpClient.js';

afterEach(() => vi.unstubAllGlobals());

describe('callExtractMetadata', () => {
  it('aborts the upstream fetch when the caller signal aborts (client gone)', async () => {
    /** @type {AbortSignal | undefined} */
    let fetchSignal;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init) => {
        fetchSignal = init.signal;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason));
        });
      })
    );
    const caller = new AbortController();
    const promise = callExtractMetadata({
      mcpUrl: 'https://mcp.example/mcp',
      bearerToken: undefined,
      url: 'https://example.org',
      variant: 'amb',
      skosSchemes: {},
      signal: caller.signal
    });
    caller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchSignal?.aborted).toBe(true);
  });
});
