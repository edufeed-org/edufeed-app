// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
/**
 * Multi-admin contract for the pending-applications badge: applications are
 * fanned out as one encrypted kind 1069 copy per admin, so the count must be
 * built from the copies addressed to the *active* admin — loading with
 * adminPubkeys[0] shows the wrong queue for other admins, and counting
 * without a p-tag filter counts every application once per admin.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

const ADMIN_PUBKEY = 'a'.repeat(64);
const ADMIN2_PUBKEY = 'c'.repeat(64);
const APPLICANT_PUBKEY = 'b'.repeat(64);
const FORM_ADDRESS = `30168:${ADMIN_PUBKEY}:edufeed-membership`;

const activeState = { pubkey: ADMIN_PUBKEY };
const adminState = { pubkeys: [ADMIN_PUBKEY] };
const timelineState = { events: [] };
const formResponseLoaderMock = vi.fn(() => () => ({
  subscribe: () => ({ unsubscribe: () => {} })
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    get active() {
      return { pubkey: activeState.pubkey };
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
        adminPubkeys: adminState.pubkeys
      };
    }
  }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: () => ({
      subscribe: (cb) => {
        cb(timelineState.events);
        return { unsubscribe: () => {} };
      }
    })
  }
}));

vi.mock('$lib/loaders/community.js', () => ({
  formResponseLoader: (...args) => formResponseLoaderMock(...args)
}));

const { useMembershipPendingCount } = await import('../membership-pending.svelte.js');

function makeCopy(id, pTag) {
  return {
    id,
    kind: 1069,
    pubkey: APPLICANT_PUBKEY,
    created_at: 1_700_000_000,
    content: '<encrypted>',
    tags: [['a', FORM_ADDRESS], ['p', pTag], ['encrypted']]
  };
}

describe('useMembershipPendingCount (multi-admin)', () => {
  let originalFetch;

  beforeEach(() => {
    activeState.pubkey = ADMIN_PUBKEY;
    adminState.pubkeys = [ADMIN_PUBKEY];
    timelineState.events = [];
    formResponseLoaderMock.mockClear();
    originalFetch = globalThis.fetch;
    // Keep the upstream directory check inert so counts come from events only.
    globalThis.fetch = vi.fn(async () => ({ ok: false }));
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('loads responses addressed to the active admin, not adminPubkeys[0]', () => {
    adminState.pubkeys = [ADMIN_PUBKEY, ADMIN2_PUBKEY];
    activeState.pubkey = ADMIN2_PUBKEY;

    const cleanup = $effect.root(() => {
      useMembershipPendingCount();
    });
    flushSync();

    expect(formResponseLoaderMock).toHaveBeenCalledWith(FORM_ADDRESS, ADMIN2_PUBKEY);
    cleanup();
  });

  it('counts one application once, ignoring copies addressed to other admins', () => {
    adminState.pubkeys = [ADMIN_PUBKEY, ADMIN2_PUBKEY];
    activeState.pubkey = ADMIN_PUBKEY;
    // One application, fanned out to both admins.
    timelineState.events = [
      makeCopy('copy-for-admin1', ADMIN_PUBKEY),
      makeCopy('copy-for-admin2', ADMIN2_PUBKEY)
    ];

    let getCount;
    const cleanup = $effect.root(() => {
      getCount = useMembershipPendingCount();
    });
    flushSync();

    expect(getCount()).toBe(1);
    cleanup();
  });
});
