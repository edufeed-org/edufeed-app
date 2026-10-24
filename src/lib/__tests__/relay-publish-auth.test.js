// @ts-nocheck
/**
 * NIP-42 AUTH on the publish path (issue 10fc9681, NIP-70 protected events).
 *
 * Measured against strfry 1.1.0 with `auth.enabled = true` (the image
 * relay.edufeed.org runs), 2026-10-24:
 *
 *   - no AUTH challenge on connect — strfry sends `["AUTH", <challenge>]`
 *     only when it refuses something, right BEFORE the OK;
 *   - a protected event from an unauthenticated connection is answered
 *     `OK false "auth-required: event marked as protected"`;
 *   - after AUTH the SAME event is accepted;
 *   - a second AUTH on the connection is refused ("error: already
 *     authenticated") — the trap `authenticateOnce` guards against.
 *
 * applesauce-relay 6.2.1 turns an `auth-required:` OK into a thrown
 * AuthRequiredError and its default retry re-sends through `waitForAuth`,
 * which blocks until somebody authenticates — nobody did, so the publish hung
 * until its timeout and every later EVENT on that connection waited too.
 * `publishWithAuth` answers the challenge with the active account and
 * re-sends once.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  publishWithAuth,
  setRelayAuthSigner,
  isAuthRequiredResponse
} from '$lib/services/relay-publish-auth.js';
import { __resetAuthAttempts } from '$lib/groups/relay-auth.js';

const EVENT = { id: 'e'.repeat(64), pubkey: 'a'.repeat(64), kind: 1, tags: [['-']], content: '' };
const SIGNER = { signEvent: vi.fn(async (t) => ({ ...t, id: 'auth', sig: 's' })) };

class AuthRequiredError extends Error {}

/**
 * A stand-in for applesauce's Relay: the first publish is refused with
 * auth-required (thrown, as 6.2.1 does), later ones succeed once authenticated.
 */
function strfryLikeRelay({ authOk = true, throwsAuthRequired = true } = {}) {
  const relay = {
    url: 'wss://relay.example/',
    challenge: null,
    authenticated: false,
    receivedAuthRequiredForEvent: {
      value: false,
      next: vi.fn((v) => (relay.receivedAuthRequiredForEvent.value = v))
    },
    publish: vi.fn(async () => {
      if (!relay.authenticated) {
        relay.challenge = 'chal-1';
        relay.receivedAuthRequiredForEvent.value = true;
        if (throwsAuthRequired)
          throw new AuthRequiredError('auth-required: event marked as protected');
        return { ok: false, message: 'auth-required: event marked as protected', from: relay.url };
      }
      return { ok: true, message: '', from: relay.url };
    }),
    authenticate: vi.fn(async () => {
      relay.authenticated = authOk;
      return authOk ? { ok: true } : { ok: false, message: 'restricted: nope' };
    })
  };
  return relay;
}

describe('publishWithAuth', () => {
  beforeEach(() => {
    __resetAuthAttempts();
    setRelayAuthSigner(() => SIGNER);
  });

  it('answers the auth-required refusal with the active signer and re-sends once', async () => {
    const relay = strfryLikeRelay();
    const res = await publishWithAuth(relay, EVENT, { timeout: 1000 });

    expect(relay.authenticate).toHaveBeenCalledTimes(1);
    expect(relay.authenticate).toHaveBeenCalledWith(SIGNER);
    expect(relay.publish).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
  });

  it('handles a relay that answers OK:false instead of throwing', async () => {
    const relay = strfryLikeRelay({ throwsAuthRequired: false });
    const res = await publishWithAuth(relay, EVENT, { timeout: 1000 });
    expect(relay.authenticate).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
  });

  it('never retries auth-required inside applesauce (no waitForAuth hang)', async () => {
    const relay = strfryLikeRelay();
    await publishWithAuth(relay, EVENT, { timeout: 1000 });
    const opts = relay.publish.mock.calls[0][1];
    expect(opts.timeout).toBe(1000);
    // The retry config must stop on auth-required: its delay errors out.
    const { firstValueFrom } = await import('rxjs');
    const authErr = new AuthRequiredError('auth-required: x');
    await expect(firstValueFrom(opts.retries.delay(authErr, 1))).rejects.toBe(authErr);
  });

  it('without a logged-in account it does not authenticate and reports the refusal', async () => {
    setRelayAuthSigner(() => null);
    const relay = strfryLikeRelay();
    const res = await publishWithAuth(relay, EVENT, { timeout: 1000 });
    expect(relay.authenticate).not.toHaveBeenCalled();
    expect(relay.publish).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false);
    expect(isAuthRequiredResponse(res)).toBe(true);
  });

  it('a refused AUTH un-sticks the connection so later EVENTs do not wait for auth', async () => {
    const relay = strfryLikeRelay({ authOk: false });
    const res = await publishWithAuth(relay, EVENT, { timeout: 1000 });
    expect(res.ok).toBe(false);
    expect(relay.publish).toHaveBeenCalledTimes(1);
    expect(relay.receivedAuthRequiredForEvent.value).toBe(false);
  });

  it('a signer that throws (bunker declined / timed out) is a refusal, not a crash', async () => {
    setRelayAuthSigner(() => SIGNER);
    const relay = strfryLikeRelay();
    relay.authenticate = vi.fn(async () => {
      throw new Error('Signing the event timed out');
    });
    const res = await publishWithAuth(relay, EVENT, { timeout: 1000 });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/auth-required/);
  });

  it('passes ordinary relay answers through untouched', async () => {
    const relay = {
      url: 'wss://plain/',
      publish: vi.fn(async () => ({ ok: false, message: 'blocked: spam', from: 'wss://plain/' })),
      authenticate: vi.fn()
    };
    const res = await publishWithAuth(relay, EVENT, { timeout: 1000 });
    expect(res).toEqual({ ok: false, message: 'blocked: spam', from: 'wss://plain/' });
    expect(relay.authenticate).not.toHaveBeenCalled();
  });

  it('rethrows transport errors so the outbox keeps the relay pending', async () => {
    const relay = {
      url: 'wss://dead/',
      publish: vi.fn(async () => {
        throw new Error('Timeout has occurred');
      }),
      authenticate: vi.fn()
    };
    await expect(publishWithAuth(relay, EVENT, { timeout: 1000 })).rejects.toThrow('Timeout');
  });
});
