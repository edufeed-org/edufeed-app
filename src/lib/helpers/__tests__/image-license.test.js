/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject } from 'rxjs';

// app-settings touches window.matchMedia at module load through transitive
// imports; stub before importing.
if (typeof window !== 'undefined' && !window.matchMedia) {
  // @ts-expect-error minimal shim for module-load-time calls
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  });
}

// Hoisted shared mock state — vi.mock factories run before normal imports,
// so use vi.hoisted() to share a mutable container between test bodies and
// the factory.
const mocks = vi.hoisted(() => ({
  captured: /** @type {any[]} */ ([]),
  events: /** @type {any[]} */ ([]),
  /** @type {((relays: string[], filter: any) => any) | null} */
  requestImpl: null
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { from } = await import('rxjs');
  return {
    pool: {
      request: (/** @type {string[]} */ relays, /** @type {any} */ filter) => {
        if (mocks.requestImpl) return mocks.requestImpl(relays, filter);
        mocks.captured.push({ relays, filter });
        return from(mocks.events);
      }
    },
    eventStore: { add: () => {} }
  };
});

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://relay.example', 'wss://relay.other']
}));

const { findExistingLicense } = await import('../image-license.js');

beforeEach(() => {
  mocks.captured.length = 0;
  mocks.events.length = 0;
  mocks.requestImpl = null;
});

describe('findExistingLicense', () => {
  it('returns null when no events arrive', async () => {
    const result = await findExistingLicense('a'.repeat(64));
    expect(result).toBeNull();
  });

  it('queries the full lookup-relay set with the correct filter', async () => {
    await findExistingLicense('a'.repeat(64));
    expect(mocks.captured).toHaveLength(1);
    expect(mocks.captured[0].relays).toEqual(['wss://relay.example', 'wss://relay.other']);
    expect(mocks.captured[0].filter).toEqual([{ kinds: [1063], '#x': ['a'.repeat(64)] }]);
  });

  it('returns the first event emitted by the upstream (take-1 semantics)', async () => {
    // With take(1), the first-emitted event wins regardless of created_at order.
    // The newest-wins guarantee is intentionally dropped for speed; the user can
    // click Replace if they disagree with the picked attestation.
    mocks.events.push(
      { id: 'first', kind: 1063, created_at: 100, tags: [['x', 'a'.repeat(64)]] },
      { id: 'second', kind: 1063, created_at: 200, tags: [['x', 'a'.repeat(64)]] }
    );
    const result = await findExistingLicense('a'.repeat(64));
    expect(result?.id).toBe('first');
  });

  it('returns null and does not throw on empty hash', async () => {
    const result = await findExistingLicense('');
    expect(result).toBeNull();
  });

  it('returns the first emitted event when upstream never completes within the timeout', async () => {
    // Mock returns a Subject that emits events but never completes — simulating
    // a relay that streams data without sending EOSE. take(1) should still resolve.
    const subject = new Subject();

    mocks.requestImpl = (relays, filter) => {
      mocks.captured.push({ relays, filter });
      queueMicrotask(() => {
        subject.next({ id: 'a', kind: 1063, created_at: 100, tags: [['x', 'a'.repeat(64)]] });
        // Deliberately do NOT call subject.complete() — simulates hanging relay.
        // take(1) completes after the first emission regardless.
      });
      return subject.asObservable();
    };

    const result = await findExistingLicense('a'.repeat(64));
    expect(result?.id).toBe('a');
  });

  it('returns null when the upstream emits nothing within 2 seconds', async () => {
    // Mock returns a Subject that never emits and never completes.
    const subject = new Subject();

    mocks.requestImpl = (relays, filter) => {
      mocks.captured.push({ relays, filter });
      return subject.asObservable();
    };

    vi.useFakeTimers();
    try {
      const promise = findExistingLicense('a'.repeat(64));
      await vi.advanceTimersByTimeAsync(2100);
      const result = await promise;
      expect(result).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
