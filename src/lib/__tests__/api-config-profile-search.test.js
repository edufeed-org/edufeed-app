/**
 * GET /api/config — profile search + NIP-85 trust assertion defaults.
 *
 * The defaults point at Brainstorm (brainstorm.world): its NIP-50 relay
 * ranks kind-0 hits by web of trust instead of returning the first
 * substring match, and its public scores relay serves kind 30382 trusted
 * assertions any client may read. Both are plain env overrides; an empty
 * value switches the feature off, never breaks the picker.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const HOUSE_PROVIDER = 'a64c7b8d9d89b9b399191c398002514c53cadf0712397a8ca0c36162813f4775';

describe('GET /api/config — profile search + trust assertions', () => {
  beforeEach(() => vi.resetModules());

  it('defaults PROFILE_SEARCH_RELAYS to the Brainstorm WoT search relay only', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.profileSearchRelays).toEqual(['wss://tags.brainstorm.world/relay']);
    expect(body.profileSearchObserver).toBeNull();
  });

  it('passes PROFILE_SEARCH_OBSERVER through verbatim (npub or hex, normalised client-side)', async () => {
    vi.doMock('$env/dynamic/private', () => ({
      env: {
        PROFILE_SEARCH_OBSERVER: ' npub1r30l8j4vmppvq8w23umcyvd3vct4zmfpfkn4c7h2h057rmlfcrmq9xt9ma '
      }
    }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.profileSearchObserver).toBe(
      'npub1r30l8j4vmppvq8w23umcyvd3vct4zmfpfkn4c7h2h057rmlfcrmq9xt9ma'
    );
  });

  it('defaults trustAssertions to the Brainstorm scores relay + house provider key', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.trustAssertions).toEqual({
      relays: ['wss://scores.brainstorm.world'],
      providers: [HOUSE_PROVIDER]
    });
  });

  it('`none` switches a defaulted list off; an empty value keeps the default', async () => {
    vi.doMock('$env/dynamic/private', () => ({
      env: {
        TRUST_ASSERTION_RELAYS: 'none',
        TRUST_ASSERTION_PROVIDERS: 'abc',
        PROFILE_SEARCH_RELAYS: ''
      }
    }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.trustAssertions).toEqual({ relays: [], providers: ['abc'] });
    expect(body.profileSearchRelays).toEqual(['wss://tags.brainstorm.world/relay']);
  });

  it('PROFILE_SEARCH_RELAYS=none disables the remote search leg', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: { PROFILE_SEARCH_RELAYS: 'None' } }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.profileSearchRelays).toEqual([]);
  });
});
