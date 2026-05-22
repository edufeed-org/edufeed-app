// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

const adminSk = generateSecretKey();
const adminPk = getPublicKey(adminSk);
const strangerSk = generateSecretKey();

vi.mock('$env/dynamic/private', () => ({
  env: {
    MEMBERSHIP_ADMIN_PUBKEYS: adminPk,
    NIP05_SERVICE_URL: 'https://nip05.test',
    NIP05_SERVICE_API_KEY: 'test-bearer-token'
  }
}));

const { DELETE } = await import('../[name]/+server.js');

/**
 * Build a NIP-98 Authorization header for a body-less request (DELETE).
 */
async function buildAuthHeader(sk, url, method) {
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['u', url],
        ['method', method]
      ],
      content: ''
    },
    sk
  );
  return 'Nostr ' + btoa(JSON.stringify(event));
}

function makeRequest({ url, authHeader, name }) {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  const req = new Request(url, { method: 'DELETE', headers });
  return /** @type {any} */ ({
    request: req,
    url: new URL(url),
    params: { name }
  });
}

describe('DELETE /api/nip05/[name]', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns 401 when no Authorization header is present', async () => {
    const res = await DELETE(
      makeRequest({ url: 'http://localhost/api/nip05/maria', name: 'maria' })
    );
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 403 when NIP-98 signer is not in MEMBERSHIP_ADMIN_PUBKEYS', async () => {
    const targetUrl = 'http://localhost/api/nip05/maria';
    const auth = await buildAuthHeader(strangerSk, targetUrl, 'DELETE');
    const res = await DELETE(makeRequest({ url: targetUrl, authHeader: auth, name: 'maria' }));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('proxies a valid admin-signed DELETE to the nip-05-service with Bearer token', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    const targetUrl = 'http://localhost/api/nip05/maria';
    const auth = await buildAuthHeader(adminSk, targetUrl, 'DELETE');

    const res = await DELETE(makeRequest({ url: targetUrl, authHeader: auth, name: 'maria' }));
    expect(res.status).toBe(200);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toBe('https://nip05.test/api/nip05/maria');
    expect(calledInit.method).toBe('DELETE');
    expect(calledInit.headers.Authorization).toBe('Bearer test-bearer-token');
  });

  it('url-encodes the name when forwarding upstream', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const targetUrl = 'http://localhost/api/nip05/odd%20name';
    const auth = await buildAuthHeader(adminSk, targetUrl, 'DELETE');

    await DELETE(makeRequest({ url: targetUrl, authHeader: auth, name: 'odd name' }));
    const [calledUrl] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toBe('https://nip05.test/api/nip05/odd%20name');
  });

  it('forwards upstream 404 (unknown name) to the caller', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' }
      })
    );

    const targetUrl = 'http://localhost/api/nip05/missing';
    const auth = await buildAuthHeader(adminSk, targetUrl, 'DELETE');

    const res = await DELETE(makeRequest({ url: targetUrl, authHeader: auth, name: 'missing' }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Not found');
  });

  it('rejects when the NIP-98 method tag does not match', async () => {
    const targetUrl = 'http://localhost/api/nip05/maria';
    // Signer claims POST but we're calling DELETE
    const auth = await buildAuthHeader(adminSk, targetUrl, 'POST');

    const res = await DELETE(makeRequest({ url: targetUrl, authHeader: auth, name: 'maria' }));
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
