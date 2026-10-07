/** @vitest-environment node */
// Issue wc4x0lnp: CreateCommunityModal's moderated branch read the creator's
// cached kind 0 through applesauce's getProfileContent() without checking
// that there IS one. For a fresh key (every e2e run) or an account whose
// profile hasn't loaded, getProfileContent(undefined) throws
// "Reflect.has called on non-object" inside the provisioning try, and the
// wizard showed "The group for membership management could not be created".
import { describe, it, expect } from 'vitest';
import { getProfileContent } from 'applesauce-core/helpers';
import { rootGroupSeed } from '$lib/groups/root-group-seed.js';

const PUBKEY = 'a'.repeat(64);
/** @param {Record<string, unknown>} content */
const kind0 = (content) => ({
  id: 'k0',
  kind: 0,
  pubkey: PUBKEY,
  created_at: 1,
  tags: [],
  content: JSON.stringify(content),
  sig: ''
});

describe('rootGroupSeed', () => {
  it('documents the hazard: applesauce throws on a missing profile event', () => {
    expect(() => getProfileContent(/** @type {any} */ (undefined))).toThrow(/Reflect\.has/);
  });

  it('does not throw without a cached kind 0 and falls back to the literal name', () => {
    expect(rootGroupSeed({}, undefined)).toEqual({
      name: 'Community',
      about: undefined,
      picture: undefined
    });
    expect(rootGroupSeed(undefined, null)).toEqual({
      name: 'Community',
      about: undefined,
      picture: undefined
    });
  });

  it('seeds name, about and picture from the cached kind 0', () => {
    const seed = rootGroupSeed(
      {},
      kind0({ name: 'Lehrerzimmer', about: 'Alles rund ums Kollegium', picture: 'https://x/p.png' })
    );
    expect(seed).toEqual({
      name: 'Lehrerzimmer',
      about: 'Alles rund ums Kollegium',
      picture: 'https://x/p.png'
    });
  });

  it('prefers what the new-keypair flow collected, trimmed', () => {
    const seed = rootGroupSeed(
      { name: '  Neue Community ', about: ' Beschreibung ', picture: ' https://x/new.png ' },
      kind0({ name: 'cached', about: 'cached about', picture: 'https://x/old.png' })
    );
    expect(seed).toEqual({
      name: 'Neue Community',
      about: 'Beschreibung',
      picture: 'https://x/new.png'
    });
  });

  it('leaves about/picture undefined when the kind 0 lacks them (metadataTags emits no tag)', () => {
    expect(rootGroupSeed({ about: '' }, kind0({ name: 'n' }))).toEqual({
      name: 'n',
      about: undefined,
      picture: undefined
    });
  });
});
