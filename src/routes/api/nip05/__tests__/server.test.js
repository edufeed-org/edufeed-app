// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';

// Generate two test keypairs at module load — one will be allowlisted, the other not.
const adminSk = generateSecretKey();
const adminPk = getPublicKey(adminSk);
const strangerSk = generateSecretKey();

// Mock $env BEFORE importing the route — the route reads env at module load.
vi.mock('$env/dynamic/private', () => ({
  env: {
    MEMBERSHIP_ADMIN_PUBKEYS: adminPk,
    NIP05_SERVICE_URL: 'https://nip05.test',
    NIP05_SERVICE_API_KEY: 'test-bearer-token'
  }
}));

const { POST } = await import('../+server.js');

/**
 * Build a NIP-98 Authorization header from a secret key.
 * Mirrors `src/lib/helpers/nip98.js` exactly so payload hashes line up.
 */
async function buildAuthHeader(sk, url, method, bodyString) {
  const tags = [
    ['u', url],
    ['method', method]
  ];
  if (bodyString) {
    const data = new TextEncoder().encode(bodyString);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    const hex = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    tags.push(['payload', hex]);
  }
  const event = finalizeEvent(
    { kind: 27235, created_at: Math.floor(Date.now() / 1000), tags, content: '' },
    sk
  );
  return 'Nostr ' + btoa(JSON.stringify(event));
}

function makeRequest({ url, body, authHeader }) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (authHeader) headers.set('authorization', authHeader);
  const req = new Request(url, { method: 'POST', headers, body });
  return /** @type {any} */ ({ request: req, url: new URL(url) });
}

describe('POST /api/nip05', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns 401 when no Authorization header is present', async () => {
    const body = JSON.stringify({ name: 'maria', pubkey: bytesToHex(adminSk) });
    const res = await POST(makeRequest({ url: 'http://localhost/api/nip05', body }));
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 403 when NIP-98 signer is not in MEMBERSHIP_ADMIN_PUBKEYS', async () => {
    const targetUrl = 'http://localhost/api/nip05';
    const body = JSON.stringify({ name: 'maria', pubkey: bytesToHex(strangerSk) });
    const auth = await buildAuthHeader(strangerSk, targetUrl, 'POST', body);
    const res = await POST(makeRequest({ url: targetUrl, body, authHeader: auth }));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('proxies a valid admin-signed request to the nip-05-service with Bearer token', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'maria', pubkey: 'a'.repeat(64) }), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      })
    );

    const targetUrl = 'http://localhost/api/nip05';
    const body = JSON.stringify({ name: 'maria', pubkey: 'a'.repeat(64) });
    const auth = await buildAuthHeader(adminSk, targetUrl, 'POST', body);

    const res = await POST(makeRequest({ url: targetUrl, body, authHeader: auth }));
    expect(res.status).toBe(201);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toBe('https://nip05.test/api/nip05');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers.Authorization).toBe('Bearer test-bearer-token');
    expect(calledInit.headers['Content-Type']).toBe('application/json');
    expect(calledInit.body).toBe(body);
  });

  it('forwards upstream 409 (name taken) to the caller', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Entry already exists' }), {
        status: 409,
        headers: { 'content-type': 'application/json' }
      })
    );

    const targetUrl = 'http://localhost/api/nip05';
    const body = JSON.stringify({ name: 'taken', pubkey: 'b'.repeat(64) });
    const auth = await buildAuthHeader(adminSk, targetUrl, 'POST', body);

    const res = await POST(makeRequest({ url: targetUrl, body, authHeader: auth }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('Entry already exists');
  });

  it('rejects when the NIP-98 payload hash does not match the request body', async () => {
    const targetUrl = 'http://localhost/api/nip05';
    const auth = await buildAuthHeader(
      adminSk,
      targetUrl,
      'POST',
      JSON.stringify({ name: 'different' })
    );
    const actualBody = JSON.stringify({ name: 'maria', pubkey: 'a'.repeat(64) });

    const res = await POST(makeRequest({ url: targetUrl, body: actualBody, authHeader: auth }));
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
