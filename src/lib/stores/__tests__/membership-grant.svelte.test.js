// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
/**
 * Shared grant-detection for the membership handle: 'none' (never applied),
 * 'pending' (application exists, upstream directory has no entry yet),
 * 'granted' (wished handle resolves to the user's pubkey upstream). Used by
 * the settings MembershipCard and the Termi assistant's nip05 hint.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

const ADMIN_PUBKEY = 'a'.repeat(64);
const ADMIN2_PUBKEY = 'c'.repeat(64);
const USER_PUBKEY = 'user-pub';
const FORM_ADDRESS = `30168:${ADMIN_PUBKEY}:edufeed-membership`;

const timelineState = { events: [], subscribers: [] };
/** Push a new timeline snapshot to every live subscriber (mirrors eventStore.add). */
function emitTimeline(events) {
  timelineState.events = events;
  for (const cb of timelineState.subscribers) cb(events);
}
const decryptMock = vi.fn();

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    get active() {
      return {
        pubkey: USER_PUBKEY,
        signer: { nip44: { decrypt: (...args) => decryptMock(...args) } }
      };
    }
  }
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return {
        enabled: true,
        handleDomain: 'edufeed.org',
        formAddress: FORM_ADDRESS,
        adminPubkeys: [ADMIN_PUBKEY, ADMIN2_PUBKEY]
      };
    }
  }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    timeline: () => ({
      subscribe: (cb) => {
        timelineState.subscribers.push(cb);
        cb(timelineState.events);
        return {
          unsubscribe: () => {
            timelineState.subscribers = timelineState.subscribers.filter((s) => s !== cb);
          }
        };
      }
    })
  }
}));

vi.mock('$lib/loaders/base.js', () => ({
  timedPool: () => ({})
}));

vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => []
}));

const { useMembershipGrantState } = await import('../membership-grant.svelte.js');

function makeResponse(pTag = ADMIN2_PUBKEY) {
  return {
    id: 'resp-1',
    kind: 1069,
    pubkey: USER_PUBKEY,
    created_at: 1_700_000_000,
    content: '<ciphertext>',
    tags: [['a', FORM_ADDRESS], ['p', pTag], ['encrypted']]
  };
}

/**
 * A plaintext application — the shape every real application on
 * relay.edufeed.org currently has (no `encrypted` tag, answers in `response`
 * tags). Detection must not depend on decryption succeeding.
 */
function makePlaintextResponse() {
  return {
    id: 'resp-plain',
    kind: 1069,
    pubkey: USER_PUBKEY,
    created_at: 1_700_000_000,
    content: '',
    tags: [
      ['a', FORM_ADDRESS],
      ['p', ADMIN_PUBKEY],
      ['response', 'wished_handle', 'maria'],
      ['response', 'full_name', 'Maria M']
    ]
  };
}

/** Flush pending microtask chains (decrypt → fetch) plus rune effects. */
async function settle() {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    flushSync();
  }
}

describe('useMembershipGrantState', () => {
  let originalFetch;

  beforeEach(() => {
    timelineState.events = [];
    decryptMock.mockReset();
    decryptMock.mockResolvedValue(JSON.stringify([['response', 'wished_handle', 'maria']]));
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ ok: false }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("is 'none' without an application", async () => {
    let grant;
    const cleanup = $effect.root(() => {
      grant = useMembershipGrantState();
    });
    await settle();

    expect(grant.getState()).toBe('none');
    expect(grant.getAddress()).toBe('');
    cleanup();
  });

  it("is 'pending' while the handle is not in the upstream directory", async () => {
    timelineState.events = [makeResponse()];
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ names: {} })
    }));

    let grant;
    const cleanup = $effect.root(() => {
      grant = useMembershipGrantState();
    });
    await settle();

    expect(grant.getState()).toBe('pending');
    cleanup();
  });

  it("is 'granted' with the full address when upstream maps the handle to the user", async () => {
    timelineState.events = [makeResponse()];
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ names: { maria: USER_PUBKEY } })
    }));

    let grant;
    const cleanup = $effect.root(() => {
      grant = useMembershipGrantState();
    });
    await settle();

    expect(grant.getState()).toBe('granted');
    expect(grant.getWishedHandle()).toBe('maria');
    expect(grant.getAddress()).toBe('maria@edufeed.org');
    // Fan-out copy addressed to the second admin decrypts against that admin.
    expect(decryptMock).toHaveBeenCalledWith(ADMIN2_PUBKEY, '<ciphertext>');
    cleanup();
  });

  it("stays 'pending' when the handle maps to a different pubkey", async () => {
    timelineState.events = [makeResponse()];
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ names: { maria: 'f'.repeat(64) } })
    }));

    let grant;
    const cleanup = $effect.root(() => {
      grant = useMembershipGrantState();
    });
    await settle();

    expect(grant.getState()).toBe('pending');
    cleanup();
  });

  it("flips from 'none' to 'pending' when an application lands after subscribing", async () => {
    // The submit path mirrors the published copies into the eventStore, so the
    // surface the user is looking at (Termi hint / settings card) must switch
    // to "waiting for review" without a reload — otherwise people re-apply.
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ names: {} })
    }));

    let grant;
    const cleanup = $effect.root(() => {
      grant = useMembershipGrantState();
    });
    await settle();
    expect(grant.getState()).toBe('none');

    emitTimeline([makeResponse()]);
    await settle();

    expect(grant.getState()).toBe('pending');
    cleanup();
  });

  it('reads the wished handle from a plaintext application', async () => {
    // Applications published before the encryption fix carry their answers in
    // `response` tags; detection must not depend on decryption running.
    timelineState.events = [makePlaintextResponse()];
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ names: { maria: USER_PUBKEY } })
    }));

    let grant;
    const cleanup = $effect.root(() => {
      grant = useMembershipGrantState();
    });
    await settle();

    expect(grant.getState()).toBe('granted');
    expect(grant.getAddress()).toBe('maria@edufeed.org');
    expect(decryptMock).not.toHaveBeenCalled();
    cleanup();
  });
});
