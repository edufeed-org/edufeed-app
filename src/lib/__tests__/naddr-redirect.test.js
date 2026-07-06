/**
 * Tests that the [naddr] route load function redirects calendar event kinds
 * and community-targeted addressables to their dedicated detail pages.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { naddrEncode, npubEncode } from 'nostr-tools/nip19';

// Mock $lib/helpers/nostrUtils — must be before import
vi.mock('$lib/helpers/nostrUtils', () => ({
  fetchEventById: vi.fn()
}));

// Mock config store — initializeConfig is called by the load function
vi.mock('$lib/stores/config.svelte.js', () => ({
  initializeConfig: vi.fn(),
  runtimeConfig: {},
  configReady: { subscribe: vi.fn(() => vi.fn()) }
}));

// Mock @sveltejs/kit — redirect throws, error throws
vi.mock('@sveltejs/kit', () => ({
  redirect: (/** @type {number} */ status, /** @type {string} */ location) => {
    const err = /** @type {any} */ (new Error('Redirect'));
    err.status = status;
    err.location = location;
    throw err;
  },
  error: (/** @type {number} */ status, /** @type {string} */ message) => {
    const err = /** @type {any} */ (new Error(message));
    err.status = status;
    throw err;
  }
}));

const { load } = await import('../../routes/[naddr=naddr]/+page.js');
const { fetchEventById } = await import('$lib/helpers/nostrUtils');

const FAKE_PUBKEY = 'a'.repeat(64);
const COMMUNITY_HEX = 'b'.repeat(64);
const COMMUNITY_NPUB = npubEncode(COMMUNITY_HEX);
const fakeParent = () => Promise.resolve({ config: {} });

/**
 * Build a fake event the load function can route on.
 * @param {{ kind: number, identifier: string, hTag?: string }} opts
 */
function fakeEvent({ kind, identifier, hTag }) {
  const tags = [['d', identifier]];
  if (hTag) tags.push(['h', hTag]);
  return {
    id: 'fake',
    kind,
    pubkey: FAKE_PUBKEY,
    tags,
    content: '',
    created_at: 0,
    sig: 'fake'
  };
}

describe('[naddr] route redirect', () => {
  it('redirects kind 31922 (date-based calendar event) to /calendar/event/', async () => {
    /** @type {any} */ (fetchEventById).mockResolvedValueOnce(
      fakeEvent({ kind: 31922, identifier: 'test-event' })
    );
    const naddr = naddrEncode({ kind: 31922, pubkey: FAKE_PUBKEY, identifier: 'test-event' });
    try {
      await load({ params: { naddr }, parent: fakeParent });
      expect.unreachable('should have thrown redirect');
    } catch (/** @type {any} */ err) {
      expect(err.status).toBe(307);
      expect(err.location).toBe(`/calendar/event/${naddr}`);
    }
  });

  it('redirects kind 31923 (time-based calendar event) to /calendar/event/', async () => {
    /** @type {any} */ (fetchEventById).mockResolvedValueOnce(
      fakeEvent({ kind: 31923, identifier: 'test-event' })
    );
    const naddr = naddrEncode({ kind: 31923, pubkey: FAKE_PUBKEY, identifier: 'test-event' });
    try {
      await load({ params: { naddr }, parent: fakeParent });
      expect.unreachable('should have thrown redirect');
    } catch (/** @type {any} */ err) {
      expect(err.status).toBe(307);
      expect(err.location).toBe(`/calendar/event/${naddr}`);
    }
  });

  it('redirects h-tagged calendar event to /c/<npub>/event/', async () => {
    /** @type {any} */ (fetchEventById).mockResolvedValueOnce(
      fakeEvent({ kind: 31923, identifier: 'community-event', hTag: COMMUNITY_HEX })
    );
    const naddr = naddrEncode({ kind: 31923, pubkey: FAKE_PUBKEY, identifier: 'community-event' });
    try {
      await load({ params: { naddr }, parent: fakeParent });
      expect.unreachable('should have thrown redirect');
    } catch (/** @type {any} */ err) {
      expect(err.status).toBe(307);
      expect(err.location).toBe(`/c/${COMMUNITY_NPUB}/event/${naddr}`);
    }
  });

  it('redirects kind 31924 (calendar collection) to /calendar/', async () => {
    /** @type {any} */ (fetchEventById).mockResolvedValueOnce(
      fakeEvent({ kind: 31924, identifier: 'test-cal' })
    );
    const naddr = naddrEncode({ kind: 31924, pubkey: FAKE_PUBKEY, identifier: 'test-cal' });
    try {
      await load({ params: { naddr }, parent: fakeParent });
      expect.unreachable('should have thrown redirect');
    } catch (/** @type {any} */ err) {
      expect(err.status).toBe(307);
      expect(err.location).toBe(`/calendar/${naddr}`);
    }
  });

  it('redirects h-tagged article (30023) to /c/<npub>/article/', async () => {
    /** @type {any} */ (fetchEventById).mockResolvedValueOnce(
      fakeEvent({ kind: 30023, identifier: 'community-article', hTag: COMMUNITY_HEX })
    );
    const naddr = naddrEncode({
      kind: 30023,
      pubkey: FAKE_PUBKEY,
      identifier: 'community-article'
    });
    try {
      await load({ params: { naddr }, parent: fakeParent });
      expect.unreachable('should have thrown redirect');
    } catch (/** @type {any} */ err) {
      expect(err.status).toBe(307);
      expect(err.location).toBe(`/c/${COMMUNITY_NPUB}/article/${naddr}`);
    }
  });

  it('does not redirect non-h-tagged kind 30023 (article)', async () => {
    /** @type {any} */ (fetchEventById).mockResolvedValueOnce(
      fakeEvent({ kind: 30023, identifier: 'test' })
    );
    const naddr = naddrEncode({ kind: 30023, pubkey: FAKE_PUBKEY, identifier: 'test' });
    const result = await load({ params: { naddr }, parent: fakeParent });
    expect(result.kind).toBe(30023);
    expect(result.naddr).toBe(naddr);
  });
});
