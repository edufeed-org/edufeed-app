/**
 * Tests that the [naddr] route load function redirects calendar event kinds
 * to their dedicated detail pages.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { naddrEncode } from 'nostr-tools/nip19';

// Mock $lib/helpers/nostrUtils — must be before import
vi.mock('$lib/helpers/nostrUtils', () => ({
  fetchEventById: vi.fn()
}));

// Mock config store — initializeConfig is called by the load function
vi.mock('$lib/stores/config.svelte.js', () => ({
  initializeConfig: vi.fn()
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

const FAKE_PUBKEY = 'a'.repeat(64);
const fakeParent = () => Promise.resolve({ config: {} });

describe('[naddr] route redirect', () => {
  it('redirects kind 31922 (date-based calendar event) to /calendar/event/', async () => {
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
    const naddr = naddrEncode({ kind: 31923, pubkey: FAKE_PUBKEY, identifier: 'test-event' });
    try {
      await load({ params: { naddr }, parent: fakeParent });
      expect.unreachable('should have thrown redirect');
    } catch (/** @type {any} */ err) {
      expect(err.status).toBe(307);
      expect(err.location).toBe(`/calendar/event/${naddr}`);
    }
  });

  it('redirects kind 31924 (calendar collection) to /calendar/', async () => {
    const naddr = naddrEncode({ kind: 31924, pubkey: FAKE_PUBKEY, identifier: 'test-cal' });
    try {
      await load({ params: { naddr }, parent: fakeParent });
      expect.unreachable('should have thrown redirect');
    } catch (/** @type {any} */ err) {
      expect(err.status).toBe(307);
      expect(err.location).toBe(`/calendar/${naddr}`);
    }
  });

  it('does not redirect kind 30023 (article)', async () => {
    const { fetchEventById } = await import('$lib/helpers/nostrUtils');
    /** @type {any} */ (fetchEventById).mockResolvedValueOnce({
      id: 'fake',
      kind: 30023,
      pubkey: FAKE_PUBKEY,
      tags: [['d', 'test']],
      content: '',
      created_at: 0,
      sig: 'fake'
    });

    const naddr = naddrEncode({ kind: 30023, pubkey: FAKE_PUBKEY, identifier: 'test' });
    const result = await load({ params: { naddr }, parent: fakeParent });
    expect(result.kind).toBe(30023);
    expect(result.naddr).toBe(naddr);
  });
});
