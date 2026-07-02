/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTokenProvider } from '../ambMcpToken.js';

/**
 * Build a Keycloak-shaped token response.
 * @param {string} accessToken
 * @param {number} [expiresIn]
 * @param {number} [status]
 */
function tokenResponse(accessToken, expiresIn = 3600, status = 200) {
  return new Response(JSON.stringify({ access_token: accessToken, expires_in: expiresIn }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const CONFIG = {
  tokenUrl: 'https://auth.test/realms/edufeed/protocol/openid-connect/token',
  clientId: 'edufeed-app',
  clientSecret: 's3cret'
};

describe('createTokenProvider', () => {
  /** @type {ReturnType<typeof vi.fn>} */
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fetches a token with a form-encoded client_credentials body', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-1'));
    const getToken = createTokenProvider(CONFIG);

    const token = await getToken();

    expect(token).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CONFIG.tokenUrl);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(init.body);
    expect(params.get('grant_type')).toBe('client_credentials');
    expect(params.get('client_id')).toBe('edufeed-app');
    expect(params.get('client_secret')).toBe('s3cret');
    expect(params.get('scope')).toBeNull();
  });

  it('caches the token across calls within its lifetime (one network call)', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-1', 3600));
    const getToken = createTokenProvider(CONFIG);

    expect(await getToken()).toBe('tok-1');
    expect(await getToken()).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes after the token expires (minus skew)', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse('tok-1', 3600))
      .mockResolvedValueOnce(tokenResponse('tok-2', 3600));
    const getToken = createTokenProvider(CONFIG);

    expect(await getToken()).toBe('tok-1');
    // Advance past expiry (3600s) so the 60s-skew cache is stale.
    vi.advanceTimersByTime(3600_000);
    expect(await getToken()).toBe('tok-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares a single in-flight fetch under concurrent callers', async () => {
    /** @type {() => void} */
    let resolveFetch = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = () => resolve(tokenResponse('tok-1'));
      })
    );
    const getToken = createTokenProvider(CONFIG);

    const p1 = getToken();
    const p2 = getToken();
    resolveFetch();

    expect(await p1).toBe('tok-1');
    expect(await p2).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('includes scope when configured', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-1'));
    const getToken = createTokenProvider({ ...CONFIG, scope: 'mcp:read mcp:extract' });

    await getToken();

    const params = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(params.get('scope')).toBe('mcp:read mcp:extract');
  });

  it('throws with the HTTP status on a non-2xx token response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"invalid_client"}', { status: 401 }));
    const getToken = createTokenProvider(CONFIG);

    await expect(getToken()).rejects.toThrow(/HTTP 401/);
  });
});
