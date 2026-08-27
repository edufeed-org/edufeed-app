/** @vitest-environment jsdom */
/**
 * Rail layout sync — the behaviour that matters is what this refuses to do.
 *
 * A real NIP-44 signer is used throughout rather than a fake that returns a
 * marker string, because two of the assertions here are about actual
 * ciphertext: that the published content is not readable, and that a layout
 * survives a genuine decrypt. Every event is put through
 * `JSON.parse(JSON.stringify(...))` before being read back — applesauce caches
 * the plaintext on the encrypted object under a symbol, so reading the same
 * object it just encrypted returns the plaintext without decrypting anything
 * and would pass against a broken cipher. Symbols do not survive JSON, which
 * is also exactly what a round trip through a relay does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, nip44, finalizeEvent } from 'nostr-tools';

const state = vi.hoisted(() => ({
  /** @type {any} */ signer: null,
  /** @type {any[]} */ published: [],
  /** @type {any} */ publishResult: { success: true },
  /** @type {any} */ replaceableSubscriber: null,
  /** @type {any} */ loaderObserver: null,
  /** @type {string[]} */ lookupRelays: ['wss://relay.test'],
  /** @type {any[]} */ added: []
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    get active() {
      return state.signer ? { signer: state.signer } : null;
    }
  }
}));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (/** @type {any} */ event) => {
    state.published.push(event);
    return Promise.resolve(state.publishResult);
  }
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: (/** @type {any} */ e) => state.added.push(e),
    replaceable: () => ({
      subscribe: (/** @type {any} */ fn) => {
        state.replaceableSubscriber = fn;
        return { unsubscribe: () => {} };
      }
    })
  }
}));
vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({
    subscribe: (/** @type {any} */ observer) => {
      state.loaderObserver = observer;
      return { unsubscribe: () => {} };
    }
  })
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => state.lookupRelays
}));
vi.mock('$lib/helpers/event-factory.js', () => ({
  finalizeDraft: (/** @type {any} */ d) => Promise.resolve(d)
}));

const {
  initializeRailLayoutSync,
  cleanupRailLayoutSync,
  publishRailLayout,
  getRailSyncStatus,
  getRemoteRailLayout,
  isRailSyncBlocked
} = await import('$lib/rail/rail-layout-sync.svelte.js');
const { RAIL_SYNC_STATUS } = await import('$lib/rail/rail-layout-gate.js');
const { encodeRailLayout, RAIL_LAYOUT_D_TAG, RAIL_LAYOUT_KIND } = await import(
  '$lib/rail/rail-layout-event.js'
);
const { unlockAppData } = await import('applesauce-common/helpers/app-data');

const SECRET = generateSecretKey();
const ME = getPublicKey(SECRET);

/** @type {import('$lib/rail/rail-layout.js').RailNode[]} */
const LAYOUT = [
  { type: 'item', key: 'community:aaa' },
  { type: 'folder', id: 'f1', name: 'Privat', keys: ['area:secret-room'] }
];

/** A signer that really does NIP-44, so ciphertext in the test is ciphertext. */
function realSigner() {
  const ck = nip44.v2.utils.getConversationKey(SECRET, ME);
  return {
    getPublicKey: () => Promise.resolve(ME),
    signEvent: (/** @type {any} */ d) => Promise.resolve(finalizeEvent(d, SECRET)),
    nip44: {
      encrypt: (/** @type {string} */ _p, /** @type {string} */ t) =>
        Promise.resolve(nip44.v2.encrypt(t, ck)),
      decrypt: (/** @type {string} */ _p, /** @type {string} */ c) =>
        Promise.resolve(nip44.v2.decrypt(c, ck))
    }
  };
}

/** A signer with no NIP-44 at all. */
function plainSigner() {
  return {
    getPublicKey: () => Promise.resolve(ME),
    signEvent: (/** @type {any} */ d) => Promise.resolve(finalizeEvent(d, SECRET))
  };
}

/** Build a real, encrypted layout event as it would arrive from a relay. */
async function remoteEvent(/** @type {any} */ layout, createdAt = 1000) {
  const ck = nip44.v2.utils.getConversationKey(SECRET, ME);
  return finalizeEvent(
    {
      kind: RAIL_LAYOUT_KIND,
      created_at: createdAt,
      tags: [['d', RAIL_LAYOUT_D_TAG]],
      content: nip44.v2.encrypt(JSON.stringify(encodeRailLayout(layout)), ck)
    },
    SECRET
  );
}

/** Deliver an event the way a relay would: no cached symbols on it. */
async function deliver(/** @type {any} */ event) {
  await state.replaceableSubscriber(JSON.parse(JSON.stringify(event)));
}

beforeEach(() => {
  cleanupRailLayoutSync();
  state.signer = realSigner();
  state.published = [];
  state.added = [];
  state.publishResult = { success: true };
  state.replaceableSubscriber = null;
  state.loaderObserver = null;
  state.lookupRelays = ['wss://relay.test'];
});

describe('the write path never opens on incomplete knowledge', () => {
  // The brief's first trap, at the point where it would cost real data.
  it('refuses to publish while the relay has not answered', async () => {
    initializeRailLayoutSync(ME);
    expect(getRailSyncStatus()).toBe(RAIL_SYNC_STATUS.loading);

    const result = await publishRailLayout(ME, []);

    expect(result.published).toBe(false);
    expect(result.reason).toBe(RAIL_SYNC_STATUS.loading);
    expect(state.published).toEqual([]);
  });

  // Reading, repeatedly, must never produce a write. This is the failure that
  // turns "the relay has not answered yet" into "the user deleted everything".
  it('publishes nothing at all merely from being read', async () => {
    initializeRailLayoutSync(ME);
    for (let i = 0; i < 10; i++) {
      getRailSyncStatus();
      getRemoteRailLayout();
      isRailSyncBlocked();
    }
    await deliver(await remoteEvent(LAYOUT));
    for (let i = 0; i < 10; i++) getRemoteRailLayout();

    expect(state.published).toEqual([]);
    expect(state.added).toEqual([]);
  });

  it('refuses when an event arrived but could not be decrypted', async () => {
    initializeRailLayoutSync(ME);
    const broken = await remoteEvent(LAYOUT);
    broken.content = 'not-decryptable-by-anyone';
    await deliver(broken);

    expect(getRailSyncStatus()).toBe(RAIL_SYNC_STATUS.locked);
    // The whole point: locked is not empty.
    expect(getRemoteRailLayout()).toBeNull();

    const result = await publishRailLayout(ME, []);
    expect(result.published).toBe(false);
    expect(state.published).toEqual([]);
  });

  it('allows the first publish once relays confirm nothing is stored', async () => {
    initializeRailLayoutSync(ME);
    state.loaderObserver.complete();

    expect(getRailSyncStatus()).toBe(RAIL_SYNC_STATUS.absent);
    const result = await publishRailLayout(ME, LAYOUT);
    expect(result.published).toBe(true);
    expect(state.published).toHaveLength(1);
  });

  // Found by TestOER, 2026-08-07. `absent` means "the relays answered and hold
  // nothing", which is what makes it safe to publish over. With no lookup
  // relays NOTHING WAS ASKED — and publishEvent builds its own relay set from
  // the outbox model, so such a user can still write to relays that hold their
  // real arrangement. Calling that absent let the first edit overwrite a
  // layout nobody had read. The `else` branch had no test; the whole suite
  // ran with one lookup relay configured.
  it('refuses to publish when there were no lookup relays to ask', async () => {
    state.lookupRelays = [];
    initializeRailLayoutSync(ME);

    expect(getRailSyncStatus()).not.toBe(RAIL_SYNC_STATUS.absent);
    const result = await publishRailLayout(ME, LAYOUT);

    expect(result.published).toBe(false);
    expect(state.published).toEqual([]);
  });

  it('stays unknown, and closed, when the lookup errors', async () => {
    initializeRailLayoutSync(ME);
    state.loaderObserver.error(new Error('relays unreachable'));

    expect(getRailSyncStatus()).toBe(RAIL_SYNC_STATUS.loading);
    expect((await publishRailLayout(ME, LAYOUT)).published).toBe(false);
  });
});

describe('encryption is not best-effort', () => {
  it('does not sync at all when the signer cannot NIP-44', async () => {
    state.signer = plainSigner();
    initializeRailLayoutSync(ME);

    expect(getRailSyncStatus()).toBe(RAIL_SYNC_STATUS.unavailable);
    const result = await publishRailLayout(ME, LAYOUT);

    expect(result.published).toBe(false);
    expect(result.reason).toBe(RAIL_SYNC_STATUS.unavailable);
    // The disclosure this whole feature exists to prevent.
    expect(state.published).toEqual([]);
  });

  // The precedent's bare catch reaches a plaintext branch when the SIGNER
  // hiccups mid-publish — a declined permission prompt, a bunker timeout.
  it('publishes nothing when the signer fails after the gate is open', async () => {
    initializeRailLayoutSync(ME);
    state.loaderObserver.complete();
    state.signer = {
      ...realSigner(),
      nip44: {
        encrypt: () => Promise.reject(new Error('user declined')),
        decrypt: () => Promise.reject(new Error('user declined'))
      }
    };

    const result = await publishRailLayout(ME, LAYOUT);

    expect(result.published).toBe(false);
    expect(state.published).toEqual([]);
  });

  // My own mutation battery exposed this gap: disabling the
  // getAppDataEncryption guard entirely SURVIVED, because every test until now
  // encrypted successfully, so the guard never had a chance to fire. That is
  // precisely the defence-in-depth case — a signer that reports success and
  // hands back something readable. The applesauce factory's encryption flag
  // silently produces no encryption at all, so this is not hypothetical.
  it('refuses to publish when the signer returns readable content', async () => {
    initializeRailLayoutSync(ME);
    state.loaderObserver.complete();
    state.signer = {
      ...realSigner(),
      nip44: {
        // Reports success, encrypts nothing.
        encrypt: (/** @type {string} */ _p, /** @type {string} */ t) => Promise.resolve(t),
        decrypt: (/** @type {string} */ _p, /** @type {string} */ c) => Promise.resolve(c)
      }
    };

    const result = await publishRailLayout(ME, LAYOUT);

    expect(result.published).toBe(false);
    expect(result.reason).toBe('not-encrypted');
    expect(state.published).toEqual([]);
  });

  // Second survivor from the battery. The gate blocks `unavailable` up front,
  // so the per-publish capability check only matters when the signer changes
  // AFTER the gate opened — an account switch mid-flight. Publishing is
  // refused either way; what the check buys is the accurate reason, and the
  // reason is what the user gets told.
  it('names the signer, not the signature, when NIP-44 disappears mid-flight', async () => {
    initializeRailLayoutSync(ME);
    state.loaderObserver.complete();
    state.signer = plainSigner();

    const result = await publishRailLayout(ME, LAYOUT);

    expect(result.published).toBe(false);
    expect(result.reason).toBe(RAIL_SYNC_STATUS.unavailable);
    expect(state.published).toEqual([]);
  });

  it('publishes content that is genuinely unreadable without the key', async () => {
    initializeRailLayoutSync(ME);
    state.loaderObserver.complete();
    await publishRailLayout(ME, LAYOUT);

    const sent = state.published[0];
    expect(sent.content).not.toContain('area:secret-room');
    expect(sent.content).not.toContain('Privat');
    expect(() => JSON.parse(sent.content)).toThrow();

    // ...and is the real layout to someone who does hold the key. Read from a
    // structurally fresh copy so no cached plaintext can answer for it.
    const fromRelay = JSON.parse(JSON.stringify(sent));
    const payload = await unlockAppData(fromRelay, /** @type {any} */ (realSigner()));
    expect(payload).toEqual(encodeRailLayout(LAYOUT));
  });
});

describe('a rejected publish is not a save', () => {
  // publishEvent resolves on rejection and contains no throw, so its return
  // value is the only evidence. Discarding it makes "every relay refused"
  // indistinguishable from "saved".
  it('reports failure when every relay refuses', async () => {
    initializeRailLayoutSync(ME);
    state.loaderObserver.complete();
    state.publishResult = { success: false, successCount: 0 };

    const result = await publishRailLayout(ME, LAYOUT);

    expect(result.published).toBe(false);
    expect(result.reason).toBe('rejected');
    expect(isRailSyncBlocked()).toBe(true);
    // Nothing may claim locally to be saved that no relay accepted.
    expect(state.added).toEqual([]);
  });

  it('clears the blocked flag once a publish lands', async () => {
    initializeRailLayoutSync(ME);
    state.loaderObserver.complete();
    state.publishResult = { success: false };
    await publishRailLayout(ME, LAYOUT);
    expect(isRailSyncBlocked()).toBe(true);

    state.publishResult = { success: true };
    await publishRailLayout(ME, LAYOUT);
    expect(isRailSyncBlocked()).toBe(false);
  });
});

describe('reading a remote layout', () => {
  it('adopts a decrypted layout, folder intact', async () => {
    initializeRailLayoutSync(ME);
    await deliver(await remoteEvent(LAYOUT));

    expect(getRailSyncStatus()).toBe(RAIL_SYNC_STATUS.loaded);
    expect(getRemoteRailLayout()).toEqual(LAYOUT);
  });

  // NIP-01's replaceable rule, so this client and the relay never disagree
  // about which arrangement is current.
  it('ignores an event older than the one already held', async () => {
    initializeRailLayoutSync(ME);
    await deliver(await remoteEvent(LAYOUT, 2000));
    const older = /** @type {any} */ ([{ type: 'item', key: 'community:zzz' }]);
    await deliver(await remoteEvent(older, 1000));

    expect(getRemoteRailLayout()).toEqual(LAYOUT);
  });

  it('takes a newer event', async () => {
    initializeRailLayoutSync(ME);
    await deliver(await remoteEvent(LAYOUT, 1000));
    const newer = /** @type {any} */ ([{ type: 'item', key: 'community:zzz' }]);
    await deliver(await remoteEvent(newer, 3000));

    expect(getRemoteRailLayout()).toEqual(newer);
  });

  it('treats a readable event carrying junk as locked, not as an empty rail', async () => {
    initializeRailLayoutSync(ME);
    const ck = nip44.v2.utils.getConversationKey(SECRET, ME);
    const event = finalizeEvent(
      {
        kind: RAIL_LAYOUT_KIND,
        created_at: 1000,
        tags: [['d', RAIL_LAYOUT_D_TAG]],
        content: nip44.v2.encrypt(JSON.stringify({ v: 99, layout: [] }), ck)
      },
      SECRET
    );
    await deliver(event);

    expect(getRailSyncStatus()).toBe(RAIL_SYNC_STATUS.locked);
    expect(getRemoteRailLayout()).toBeNull();
  });
});

describe('account switching', () => {
  it('forgets the previous account entirely', async () => {
    initializeRailLayoutSync(ME);
    await deliver(await remoteEvent(LAYOUT));
    expect(getRemoteRailLayout()).toEqual(LAYOUT);

    cleanupRailLayoutSync();

    expect(getRemoteRailLayout()).toBeNull();
    expect(getRailSyncStatus()).toBe(RAIL_SYNC_STATUS.idle);
  });

  it('will not publish for an account that is not the active one', async () => {
    initializeRailLayoutSync(ME);
    state.loaderObserver.complete();

    const result = await publishRailLayout('f'.repeat(64), LAYOUT);

    expect(result.published).toBe(false);
    expect(state.published).toEqual([]);
  });
});
