// @ts-nocheck
/**
 * One AUTH per challenge, per relay — across every component.
 *
 * laoc's channel switching broke intermittently on the real Buzz relay while
 * my local fixture (no NIP-42) passed 15/15. Read live out of his tab:
 *
 *   connected: true, challenge: present,
 *   lastAuthResponse: {ok:false, "auth-required: already authenticated"},
 *   authenticated: FALSE
 *
 * applesauce derives `authenticated$` from the LAST auth response
 * (relay.js:245) and `waitForAuth` gates every read on it
 * (relay.js:450-454). So a SECOND, redundant AUTH on a healthy authenticated
 * connection gets refused, and that refusal marks the connection
 * unauthenticated app-wide — every later request blocks forever. The channel
 * list empties, metadata never resolves, the chat stays blank.
 *
 * `challenge$` is a BehaviorSubject (relay.js:89), so it REPLAYS the last
 * challenge to every new subscriber. Any effect that re-subscribes and
 * authenticates on what it receives will re-authenticate a connection that is
 * already fine.
 *
 * Three components authenticate independently (relay-directory, GroupChat,
 * dm-service) and each kept its own `authAttempted` flag, so a per-component
 * guard cannot prevent the second AUTH. The guard has to be shared, keyed on
 * the relay AND the challenge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticateOnce, __resetAuthAttempts } from '$lib/groups/relay-auth.js';

const SIGNER = { signEvent: () => ({}) };

/** A stand-in for applesauce's Relay, with the fields the guard reads. */
function fakeRelay({ authenticated = false, challenge = 'chal-1', response } = {}) {
  const relay = {
    url: 'wss://relay.example/',
    authenticated,
    challenge,
    calls: 0,
    authenticate: vi.fn(async () => {
      relay.calls++;
      // The real relay flips `authenticated` from the response it gets back.
      const res = response ?? { ok: true };
      relay.authenticated = res.ok === true;
      return res;
    })
  };
  return relay;
}

describe('authenticateOnce', () => {
  beforeEach(() => __resetAuthAttempts());

  it('does NOT re-authenticate a connection that is already authenticated', async () => {
    // The exact live state read out of laoc's tab, minus the damage.
    const relay = fakeRelay({ authenticated: true, challenge: 'stale-replayed-challenge' });
    const res = await authenticateOnce(relay, SIGNER);
    expect(relay.authenticate).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });

  it('authenticates when the relay is not yet authenticated', async () => {
    const relay = fakeRelay({ authenticated: false });
    const res = await authenticateOnce(relay, SIGNER);
    expect(relay.authenticate).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
  });

  it('sends exactly one AUTH when two components race on the same challenge', async () => {
    // relay-directory and GroupChat both mount on a channel route.
    const relay = fakeRelay({ authenticated: false });
    const [a, b] = await Promise.all([
      authenticateOnce(relay, SIGNER),
      authenticateOnce(relay, SIGNER)
    ]);
    expect(relay.authenticate).toHaveBeenCalledTimes(1);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it('does not re-send for a challenge already attempted, even after the effect re-runs', async () => {
    const relay = fakeRelay({ authenticated: false });
    await authenticateOnce(relay, SIGNER);
    relay.authenticated = false; // pretend the flag lags; the challenge has not changed
    await authenticateOnce(relay, SIGNER);
    expect(relay.authenticate).toHaveBeenCalledTimes(1);
  });

  it('authenticates again for a NEW challenge, as after a reconnect', async () => {
    const relay = fakeRelay({ authenticated: false, challenge: 'chal-1' });
    await authenticateOnce(relay, SIGNER);
    relay.challenge = 'chal-2';
    relay.authenticated = false;
    await authenticateOnce(relay, SIGNER);
    expect(relay.authenticate).toHaveBeenCalledTimes(2);
  });

  it('reports a refusal as ok:false rather than resolving as success', async () => {
    const relay = fakeRelay({ response: { ok: false, message: 'restricted: not a member' } });
    const res = await authenticateOnce(relay, SIGNER);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('restricted');
  });

  it('does not attempt without a challenge, which the real authenticate() throws on', async () => {
    const relay = fakeRelay({ challenge: null });
    const res = await authenticateOnce(relay, SIGNER);
    expect(relay.authenticate).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });

  // The CLOSED auth-required error can arrive BEFORE the relay's AUTH frame —
  // giving up on "no challenge" left the chat permanently blank until some
  // other flow (the join button) happened to authenticate (laoc, 2026-08-19).
  it('waits for a late challenge instead of giving up', async () => {
    const { BehaviorSubject } = await import('rxjs');
    const relay = fakeRelay({ challenge: null });
    relay.challenge$ = new BehaviorSubject(null);
    setTimeout(() => {
      relay.challenge = 'late-chal';
      relay.challenge$.next('late-chal');
    }, 30);
    const res = await authenticateOnce(relay, SIGNER);
    expect(relay.authenticate).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
  });

  it('still gives up when no challenge ever arrives (bounded wait)', async () => {
    const { BehaviorSubject } = await import('rxjs');
    const relay = fakeRelay({ challenge: null });
    relay.challenge$ = new BehaviorSubject(null);
    const res = await authenticateOnce(relay, SIGNER, { challengeTimeoutMs: 50 });
    expect(relay.authenticate).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });

  it('reports a thrown error as ok:false instead of rejecting', async () => {
    const relay = fakeRelay();
    relay.authenticate = vi.fn(async () => {
      throw new Error('signer refused');
    });
    const res = await authenticateOnce(relay, SIGNER);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('signer refused');
  });

  it('does not treat two different relays as one', async () => {
    const a = fakeRelay();
    const b = { ...fakeRelay(), url: 'wss://other.example/' };
    b.authenticate = vi.fn(async () => ({ ok: true }));
    await authenticateOnce(a, SIGNER);
    await authenticateOnce(b, SIGNER);
    expect(a.authenticate).toHaveBeenCalledTimes(1);
    expect(b.authenticate).toHaveBeenCalledTimes(1);
  });
});
