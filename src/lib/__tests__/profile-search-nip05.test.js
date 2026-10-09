/**
 * profileNameSearchLoader with a NIP-05 address as the term: instead of a
 * NIP-50 name search, the address is resolved via the domain's
 * /.well-known/nostr.json and that pubkey's kind 0 is loaded — so typing
 * `alpika-grundschule@edufeed.org` into any people search lands on the
 * profile, like in Amethyst, Damus or Primal (issue "Erklärung/Anleitung
 * Verifizierung", "Auffindbar").
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, lastValueFrom, toArray } from 'rxjs';

const ALPIKA = 'a'.repeat(64);
const kind0 = { kind: 0, pubkey: ALPIKA, tags: [], content: '{"name":"ALPIKA"}' };

const infra = vi.hoisted(() => ({
  request: vi.fn(),
  add: vi.fn(),
  getReplaceable: vi.fn(() => undefined)
}));
const lookup = vi.hoisted(() => ({ resolveNip05: vi.fn(), profileLoader: vi.fn() }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    getByFilters: vi.fn(() => []),
    add: infra.add,
    getReplaceable: infra.getReplaceable
  },
  pool: { request: infra.request }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getProfileLookupRelays: () => ['wss://lookup.example.com'],
  getProfileSearchRelays: () => ['wss://search.example.com'],
  getProfileSearchObserver: () => null
}));
vi.mock('$lib/helpers/relay-search-extensions.js', () => ({
  getSearchExtensions: async () => []
}));
vi.mock('$lib/helpers/nip05-verify.js', async (importOriginal) => {
  const original = /** @type {any} */ (await importOriginal());
  return { ...original, resolveNip05: lookup.resolveNip05 };
});
vi.mock('$lib/loaders/profile.js', () => ({ profileLoader: lookup.profileLoader }));

const { profileNameSearchLoader, profileToContact, profileMatches } = await import(
  '$lib/loaders/profile-search.js'
);

describe('profileNameSearchLoader with a NIP-05 address', () => {
  beforeEach(() => {
    infra.request.mockReset();
    infra.getReplaceable.mockReset();
    infra.getReplaceable.mockReturnValue(undefined);
    lookup.resolveNip05.mockReset();
    lookup.profileLoader.mockReset();
    lookup.profileLoader.mockReturnValue(of(kind0));
  });

  it("resolves the address and emits that pubkey's kind 0 instead of searching", async () => {
    lookup.resolveNip05.mockResolvedValue(ALPIKA);
    const events = await lastValueFrom(
      profileNameSearchLoader('alpika-grundschule@edufeed.org', 10).pipe(toArray())
    );
    expect(events).toEqual([kind0]);
    expect(lookup.resolveNip05).toHaveBeenCalledWith('alpika-grundschule@edufeed.org');
    expect(lookup.profileLoader).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 0, pubkey: ALPIKA, relays: ['wss://lookup.example.com'] })
    );
    expect(infra.request).not.toHaveBeenCalled();
  });

  it('completes empty when the domain does not know the name', async () => {
    lookup.resolveNip05.mockResolvedValue(null);
    const events = await lastValueFrom(
      profileNameSearchLoader('nobody@edufeed.org', 10).pipe(toArray())
    );
    expect(events).toEqual([]);
    expect(lookup.profileLoader).not.toHaveBeenCalled();
    expect(infra.request).not.toHaveBeenCalled();
  });

  it('prefers a kind 0 already in the EventStore', async () => {
    lookup.resolveNip05.mockResolvedValue(ALPIKA);
    infra.getReplaceable.mockReturnValue(kind0);
    const events = await lastValueFrom(
      profileNameSearchLoader('alpika-grundschule@edufeed.org', 10).pipe(toArray())
    );
    expect(events).toEqual([kind0]);
    expect(lookup.profileLoader).not.toHaveBeenCalled();
  });

  it('still runs the NIP-50 search for a plain name', async () => {
    infra.request.mockReturnValue(of());
    await lastValueFrom(profileNameSearchLoader('alpika', 10).pipe(toArray()));
    expect(lookup.resolveNip05).not.toHaveBeenCalled();
    expect(infra.request).toHaveBeenCalled();
  });
});

describe('profileMatches with a NIP-05 address', () => {
  it('matches an address kept only in a nip05 tag', () => {
    const contact = profileToContact({
      kind: 0,
      pubkey: ALPIKA,
      content: '{"name":"ALPIKA","nip05":"alpika@edufeed.org"}',
      tags: [['nip05', 'alpika-grundschule@edufeed.org']]
    });
    expect(profileMatches(contact, 'alpika-grundschule@edufeed.org')).toBe(true);
    expect(profileMatches(contact, 'ALPIKA@edufeed.org')).toBe(true);
    expect(profileMatches(contact, 'someone@edufeed.org')).toBe(false);
  });
});
