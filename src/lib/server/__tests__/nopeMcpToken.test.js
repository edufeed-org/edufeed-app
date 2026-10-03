/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTokenProvider } from '../nopeMcpToken.js';

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

describe('getNopeMcpToken (env fallback)', () => {
  /** @type {ReturnType<typeof vi.fn>} */
  let envFetchMock;

  beforeEach(() => {
    envFetchMock = vi.fn();
    vi.stubGlobal('fetch', envFetchMock);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('$env/dynamic/private');
  });

  it('uses NOPE_MCP_* env names when set', async () => {
    vi.doMock('$env/dynamic/private', () => ({
      env: {
        NOPE_MCP_TOKEN_URL: 'https://nope.example/token',
        NOPE_MCP_CLIENT_ID: 'nope-client',
        NOPE_MCP_CLIENT_SECRET: 'nope-secret'
      }
    }));
    envFetchMock.mockResolvedValueOnce(tokenResponse('tok-nope'));
    const { getNopeMcpToken } = await import('../nopeMcpToken.js');

    expect(await getNopeMcpToken()).toBe('tok-nope');
    expect(envFetchMock.mock.calls[0][0]).toBe('https://nope.example/token');
    const params = new URLSearchParams(envFetchMock.mock.calls[0][1].body);
    expect(params.get('client_id')).toBe('nope-client');
    expect(params.get('client_secret')).toBe('nope-secret');
  });

  it('falls back to legacy AMB_MCP_* names when NOPE_MCP_* is unset', async () => {
    vi.doMock('$env/dynamic/private', () => ({
      env: {
        AMB_MCP_TOKEN_URL: 'https://amb.example/token',
        AMB_MCP_CLIENT_ID: 'amb-client',
        AMB_MCP_CLIENT_SECRET: 'amb-secret'
      }
    }));
    envFetchMock.mockResolvedValueOnce(tokenResponse('tok-amb'));
    const { getNopeMcpToken } = await import('../nopeMcpToken.js');

    expect(await getNopeMcpToken()).toBe('tok-amb');
    expect(envFetchMock.mock.calls[0][0]).toBe('https://amb.example/token');
  });

  it('rejects with the client-credentials config error when neither name is set', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const { getNopeMcpToken } = await import('../nopeMcpToken.js');

    await expect(getNopeMcpToken()).rejects.toThrow(/config incomplete/);
    expect(envFetchMock).not.toHaveBeenCalled();
  });
});
