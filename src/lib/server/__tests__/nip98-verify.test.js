/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { verifyNip98Header } from '../nip98-verify.js';

const sk = generateSecretKey();
const URL_STR = 'http://localhost/api/nip05';

/**
 * @param {{method?: string, url?: string, createdAt?: number, kind?: number, bodyString?: string, payloadOverride?: string}} [opts]
 */
async function buildAuthHeader({
  method = 'GET',
  url = URL_STR,
  createdAt = Math.floor(Date.now() / 1000),
  kind = 27235,
  bodyString,
  payloadOverride
} = {}) {
  const tags = [
    ['u', url],
    ['method', method]
  ];
  if (bodyString !== undefined || payloadOverride !== undefined) {
    let hex = payloadOverride;
    if (hex === undefined) {
      const data = new TextEncoder().encode(bodyString);
      const hashBuf = await crypto.subtle.digest('SHA-256', data);
      hex = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
    tags.push(['payload', hex]);
  }
  const event = finalizeEvent({ kind, created_at: createdAt, tags, content: '' }, sk);
  return 'Nostr ' + btoa(JSON.stringify(event));
}

describe('verifyNip98Header', () => {
  it('returns the signer pubkey for a valid GET request', async () => {
    const auth = await buildAuthHeader({ method: 'GET' });
    const pubkey = await verifyNip98Header(auth, URL_STR, 'GET');
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns null when the u tag does not match the request URL', async () => {
    const auth = await buildAuthHeader({ url: 'http://localhost/api/other' });
    expect(await verifyNip98Header(auth, URL_STR, 'GET')).toBeNull();
  });

  it('returns null when the method tag does not match', async () => {
    const auth = await buildAuthHeader({ method: 'POST' });
    expect(await verifyNip98Header(auth, URL_STR, 'GET')).toBeNull();
  });

  it('returns null when the event is stale (61s old)', async () => {
    const auth = await buildAuthHeader({ createdAt: Math.floor(Date.now() / 1000) - 61 });
    expect(await verifyNip98Header(auth, URL_STR, 'GET')).toBeNull();
  });

  it('returns null when the event kind is not 27235', async () => {
    const auth = await buildAuthHeader({ kind: 1 });
    expect(await verifyNip98Header(auth, URL_STR, 'GET')).toBeNull();
  });

  it('returns null when a body is present but no payload tag was signed', async () => {
    const auth = await buildAuthHeader({ method: 'POST' });
    expect(await verifyNip98Header(auth, URL_STR, 'POST', '{"a":1}')).toBeNull();
  });

  it('returns the pubkey when the payload tag matches the raw body hash', async () => {
    const bodyString = '{"a":1}';
    const auth = await buildAuthHeader({ method: 'POST', bodyString });
    const pubkey = await verifyNip98Header(auth, URL_STR, 'POST', bodyString);
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns null when the payload tag does not match the raw body hash', async () => {
    const auth = await buildAuthHeader({ method: 'POST', payloadOverride: 'f'.repeat(64) });
    expect(await verifyNip98Header(auth, URL_STR, 'POST', '{"a":1}')).toBeNull();
  });

  it('returns null when the Authorization header does not start with "Nostr "', async () => {
    expect(await verifyNip98Header('Bearer xyz', URL_STR, 'GET')).toBeNull();
  });

  it('returns null when the header is missing', async () => {
    expect(await verifyNip98Header(null, URL_STR, 'GET')).toBeNull();
  });
});
