/**
 * profileNameSearchLoader — the observer token. When PROFILE_SEARCH_OBSERVER
 * is set, relays that advertise the `observer` NIP-50 extension (Brainstorm
 * tags relay) get `observer:<hex>` appended so results are ranked from that
 * pubkey's web of trust; every other relay gets the plain term, because a
 * plain relay would treat the token as a search word and find nothing.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';

const OBSERVER = '1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6';

const infra = vi.hoisted(() => ({ request: vi.fn(), add: vi.fn() }));
const cfg = vi.hoisted(() => ({
  observer: /** @type {string | null} */ (null),
  extensions: /** @type {Record<string, string[]>} */ ({})
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { getByFilters: vi.fn(() => []), add: infra.add },
  pool: { request: infra.request }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getProfileSearchRelays: () => ['wss://wot.example/relay', 'wss://plain.example'],
  getProfileSearchObserver: () => cfg.observer
}));
vi.mock('$lib/helpers/relay-search-extensions.js', () => ({
  getSearchExtensions: vi.fn(async (url) => cfg.extensions[url] ?? [])
}));

const { profileNameSearchLoader } = await import('$lib/loaders/profile-search.js');

/** @param {import('rxjs').Observable<any>} obs */
const drain = (obs) =>
  new Promise((resolve, reject) => {
    /** @type {any[]} */
    const out = [];
    obs.subscribe({ next: (e) => out.push(e), error: reject, complete: () => resolve(out) });
  });

describe('profileNameSearchLoader observer token', () => {
  beforeEach(() => {
    infra.request.mockReset();
    infra.request.mockReturnValue(of());
    cfg.observer = null;
    cfg.extensions = {};
  });

  it('without an observer and no relay advertising include:spam, sends one plain request to all relays', async () => {
    await drain(profileNameSearchLoader('lohrer', 5));
    expect(infra.request).toHaveBeenCalledTimes(1);
    expect(infra.request).toHaveBeenCalledWith(
      ['wss://wot.example/relay', 'wss://plain.example'],
      { kinds: [0], search: 'lohrer', limit: 5 },
      expect.anything()
    );
  });

  it('with an observer, appends the token only for relays advertising the extension', async () => {
    cfg.observer = OBSERVER;
    cfg.extensions = { 'wss://wot.example/relay': ['observer', 'sort', 'filter'] };
    await drain(profileNameSearchLoader('lohrer', 5));
    expect(infra.request).toHaveBeenCalledTimes(2);
    expect(infra.request).toHaveBeenCalledWith(
      ['wss://wot.example/relay'],
      { kinds: [0], search: `lohrer observer:${OBSERVER}`, limit: 5 },
      expect.anything()
    );
    expect(infra.request).toHaveBeenCalledWith(
      ['wss://plain.example'],
      { kinds: [0], search: 'lohrer', limit: 5 },
      expect.anything()
    );
  });

  it('with an observer but no relay supporting it, falls back to one plain request', async () => {
    cfg.observer = OBSERVER;
    await drain(profileNameSearchLoader('lohrer', 5));
    expect(infra.request).toHaveBeenCalledTimes(1);
    expect(infra.request.mock.calls[0][1].search).toBe('lohrer');
  });

  // vespa-relay's LensRequiredPolicy refuses an anonymous REQ whose filter
  // names neither observer:<hex> nor include:spam (CLOSED auth-required).
  // With no observer, include:spam is the only way through — and a no-op
  // otherwise, since a lens-less vespa search has no spam floor to lift.
  it('without an observer, appends include:spam only for relays advertising the extension', async () => {
    cfg.extensions = { 'wss://wot.example/relay': ['observer', 'include', 'sort', 'filter'] };
    await drain(profileNameSearchLoader('lohrer', 5));
    expect(infra.request).toHaveBeenCalledTimes(2);
    expect(infra.request).toHaveBeenCalledWith(
      ['wss://wot.example/relay'],
      { kinds: [0], search: 'lohrer include:spam', limit: 5 },
      expect.anything()
    );
    expect(infra.request).toHaveBeenCalledWith(
      ['wss://plain.example'],
      { kinds: [0], search: 'lohrer', limit: 5 },
      expect.anything()
    );
  });

  it('with an observer, a relay advertising both gets the observer lens only, never include:spam too', async () => {
    cfg.observer = OBSERVER;
    cfg.extensions = { 'wss://wot.example/relay': ['observer', 'include'] };
    await drain(profileNameSearchLoader('lohrer', 5));
    const searches = infra.request.mock.calls.map((c) => c[1].search);
    expect(searches).toContain(`lohrer observer:${OBSERVER}`);
    expect(searches.some((q) => q.includes('include:spam'))).toBe(false);
  });

  it('with an observer, a relay advertising include but not observer still gets through with include:spam', async () => {
    cfg.observer = OBSERVER;
    cfg.extensions = { 'wss://plain.example': ['include'] };
    await drain(profileNameSearchLoader('lohrer', 5));
    expect(infra.request).toHaveBeenCalledWith(
      ['wss://plain.example'],
      { kinds: [0], search: 'lohrer include:spam', limit: 5 },
      expect.anything()
    );
    expect(infra.request).toHaveBeenCalledWith(
      ['wss://wot.example/relay'],
      { kinds: [0], search: 'lohrer', limit: 5 },
      expect.anything()
    );
  });

  it('merges events from both legs and still feeds the EventStore', async () => {
    cfg.observer = OBSERVER;
    cfg.extensions = { 'wss://wot.example/relay': ['observer'] };
    const a = { kind: 0, pubkey: 'a'.repeat(64), tags: [], content: '{}' };
    const b = { kind: 0, pubkey: 'b'.repeat(64), tags: [], content: '{}' };
    infra.request.mockImplementation((relays) =>
      of(relays[0] === 'wss://wot.example/relay' ? a : b)
    );
    const events = await drain(profileNameSearchLoader('x y', 5));
    expect(events).toEqual(expect.arrayContaining([a, b]));
    expect(infra.add).toHaveBeenCalledTimes(2);
  });
});
