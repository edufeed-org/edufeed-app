/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { adaptPoolForConcord } from '$lib/concord/pool-adapter.js';

/**
 * Build a fake 6.2.1-shaped relay (no isAuthenticated) with controllable challenge.
 * @param {string} url
 * @param {{ authenticateImpl?: (signer: any) => Promise<{ ok: boolean; from: string; message?: string }> }} [opts]
 */
function makeFakeRelay(url, { authenticateImpl } = {}) {
  return {
    url,
    challenge: /** @type {string | null} */ (null),
    authenticate: authenticateImpl ?? vi.fn(async () => ({ ok: true, from: url })),
    req: vi.fn(() => 'req-result'),
    request: vi.fn(() => 'request-result'),
    getSupported: vi.fn(() => [1, 42])
  };
}

/**
 * @param {Record<string, any>} relaysByUrl
 * @param {import('rxjs').Observable<Record<string, any>>} [statusesSubject]
 */
function makeFakePool(relaysByUrl, statusesSubject) {
  return {
    relay: vi.fn((/** @type {string} */ url) => relaysByUrl[url]),
    status$: statusesSubject ?? new BehaviorSubject({}),
    request: vi.fn(() => 'pool-request-result'),
    publish: vi.fn(() => 'pool-publish-result'),
    subscription: vi.fn(() => 'pool-subscription-result'),
    relays: new Map()
  };
}

/** @param {string} pubkey */
function fakeSigner(pubkey) {
  return { getPublicKey: vi.fn(async () => pubkey), signEvent: vi.fn() };
}

describe('adaptPoolForConcord', () => {
  it('shims isAuthenticated as false before any auth', () => {
    const relay = makeFakeRelay('wss://a.test');
    relay.challenge = 'chal-1';
    const pool = makeFakePool({ 'wss://a.test': relay });
    const adapted = adaptPoolForConcord(pool);

    const wrapped = adapted.relay('wss://a.test');
    expect(typeof wrapped.isAuthenticated).toBe('function');
    expect(wrapped.isAuthenticated('pubkey-a')).toBe(false);
  });

  it('marks a pubkey authenticated after a successful authenticate() call', async () => {
    const relay = makeFakeRelay('wss://a.test');
    relay.challenge = 'chal-1';
    const pool = makeFakePool({ 'wss://a.test': relay });
    const adapted = adaptPoolForConcord(pool);
    const wrapped = adapted.relay('wss://a.test');

    const signer = fakeSigner('pubkey-a');
    const res = await wrapped.authenticate(signer);

    expect(res.ok).toBe(true);
    expect(relay.authenticate).toHaveBeenCalledWith(signer); // real protocol call happened
    expect(wrapped.isAuthenticated('pubkey-a')).toBe(true);
    expect(wrapped.isAuthenticated('pubkey-b')).toBe(false);
  });

  it('tracks MULTIPLE simultaneously-authenticated pubkeys on one connection (no single-slot overwrite)', async () => {
    const relay = makeFakeRelay('wss://a.test');
    relay.challenge = 'chal-1';
    const pool = makeFakePool({ 'wss://a.test': relay });
    const wrapped = adaptPoolForConcord(pool).relay('wss://a.test');

    await wrapped.authenticate(fakeSigner('pubkey-a'));
    await wrapped.authenticate(fakeSigner('pubkey-b'));

    // Authenticating B must NOT un-authenticate A — this is the exact
    // ping-pong / spin scenario the adapter exists to avoid.
    expect(wrapped.isAuthenticated('pubkey-a')).toBe(true);
    expect(wrapped.isAuthenticated('pubkey-b')).toBe(true);
    expect(wrapped.isAuthenticated(['pubkey-a', 'pubkey-b'])).toBe(true);
    expect(wrapped.isAuthenticated(['pubkey-a', 'pubkey-c'])).toBe(false);
  });

  it('invalidates prior auth once the relay presents a NEW challenge (reconnect)', async () => {
    const relay = makeFakeRelay('wss://a.test');
    relay.challenge = 'chal-1';
    const pool = makeFakePool({ 'wss://a.test': relay });
    const wrapped = adaptPoolForConcord(pool).relay('wss://a.test');

    await wrapped.authenticate(fakeSigner('pubkey-a'));
    expect(wrapped.isAuthenticated('pubkey-a')).toBe(true);

    relay.challenge = 'chal-2'; // simulated reconnect
    expect(wrapped.isAuthenticated('pubkey-a')).toBe(false);

    await wrapped.authenticate(fakeSigner('pubkey-a'));
    expect(wrapped.isAuthenticated('pubkey-a')).toBe(true);
  });

  it('does not record auth when the protocol exchange fails (res.ok === false)', async () => {
    const relay = makeFakeRelay('wss://a.test', {
      authenticateImpl: vi.fn(async () => ({ ok: false, from: 'wss://a.test', message: 'denied' }))
    });
    relay.challenge = 'chal-1';
    const pool = makeFakePool({ 'wss://a.test': relay });
    const wrapped = adaptPoolForConcord(pool).relay('wss://a.test');

    const res = await wrapped.authenticate(fakeSigner('pubkey-a'));
    expect(res.ok).toBe(false);
    expect(wrapped.isAuthenticated('pubkey-a')).toBe(false);
  });

  it('degrades safely when the signer has no getPublicKey: settles authenticated instead of spinning', async () => {
    const relay = makeFakeRelay('wss://a.test');
    relay.challenge = 'chal-1';
    const pool = makeFakePool({ 'wss://a.test': relay });
    const wrapped = adaptPoolForConcord(pool).relay('wss://a.test');

    const anonymousSigner = { signEvent: vi.fn() }; // no getPublicKey
    const res = await wrapped.authenticate(anonymousSigner);

    expect(res.ok).toBe(true);
    // Can't attribute the success to a specific pubkey, so the wildcard
    // degrade reports authenticated for the current challenge generation —
    // this is what stops the retry loop from re-sending AUTH forever.
    expect(wrapped.isAuthenticated('pubkey-a')).toBe(true);
    expect(wrapped.isAuthenticated('any-other-pubkey')).toBe(true);

    relay.challenge = 'chal-2';
    expect(wrapped.isAuthenticated('pubkey-a')).toBe(false); // wildcard doesn't survive a reconnect either
  });

  it('leaves an already-auth-capable relay (concord-native build) fully untouched', () => {
    const nativeRelay = /** @type {any} */ (makeFakeRelay('wss://a.test'));
    nativeRelay.isAuthenticated = vi.fn(() => true);
    const pool = makeFakePool({ 'wss://a.test': nativeRelay });
    const wrapped = adaptPoolForConcord(pool).relay('wss://a.test');

    expect(wrapped).toBe(nativeRelay); // no wrapping at all
    expect(wrapped.isAuthenticated('anything')).toBe(true);
  });

  it('delegates unrelated relay methods through untouched', () => {
    const relay = makeFakeRelay('wss://a.test');
    const pool = makeFakePool({ 'wss://a.test': relay });
    const wrapped = adaptPoolForConcord(pool).relay('wss://a.test');

    expect(wrapped.req('filter-arg')).toBe('req-result');
    expect(relay.req).toHaveBeenCalledWith('filter-arg');
    expect(wrapped.getSupported()).toEqual([1, 42]);
  });

  it('delegates pool-level methods (request/publish/subscription) untouched', () => {
    const pool = makeFakePool({});
    const adapted = adaptPoolForConcord(pool);

    expect(adapted.request('a', 'b')).toBe('pool-request-result');
    expect(pool.request).toHaveBeenCalledWith('a', 'b');
    expect(adapted.publish('a', 'b')).toBe('pool-publish-result');
    expect(adapted.subscription('a', 'b')).toBe('pool-subscription-result');
  });

  it('status$ augments entries missing authenticatedPubkeys, and leaves fork-native entries untouched', async () => {
    const relay = makeFakeRelay('wss://a.test');
    relay.challenge = 'chal-1';
    const statuses = new BehaviorSubject({
      'wss://a.test': { url: 'wss://a.test', connected: true, challenge: 'chal-1' },
      'wss://b.test': {
        url: 'wss://b.test',
        connected: true,
        challenge: 'chal-9',
        authenticatedPubkeys: ['already-there']
      }
    });
    const pool = makeFakePool({ 'wss://a.test': relay }, statuses);
    const adapted = adaptPoolForConcord(pool);
    const wrapped = adapted.relay('wss://a.test');
    await wrapped.authenticate(fakeSigner('pubkey-a'));

    const snapshot = await new Promise((resolve) => {
      /** @type {import('rxjs').Subscription | undefined} */
      let sub;
      sub = adapted.status$.subscribe((/** @type {any} */ value) => {
        resolve(value);
        sub?.unsubscribe();
      });
    });

    expect(snapshot['wss://a.test'].authenticatedPubkeys).toEqual(['pubkey-a']);
    // Native fork status already had the field — must be passed through as-is.
    expect(snapshot['wss://b.test'].authenticatedPubkeys).toEqual(['already-there']);
  });
});
