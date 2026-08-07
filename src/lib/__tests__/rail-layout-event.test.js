/** @vitest-environment node */
/**
 * The rail layout as an encrypted app-data event.
 *
 * Two properties carry the feature. First, the payload must survive a real
 * encrypt/decrypt round-trip WITH A FOLDER IN IT — a scheme that quietly drops
 * a folder is invisible until someone loses their arrangement. Second, an
 * unreadable payload must decode to null and never to `[]`: `[]` is a real
 * layout meaning "default order", so returning it for junk hands the user an
 * empty-looking rail and, worse, invites a write that overwrites the good copy.
 */
import { describe, it, expect } from 'vitest';
import { nip44, generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  RAIL_LAYOUT_D_TAG,
  RAIL_LAYOUT_KIND,
  RAIL_LAYOUT_VERSION,
  MAX_FUTURE_SKEW,
  encodeRailLayout,
  decodeRailLayout,
  isNewerLayoutEvent,
  nextLayoutCreatedAt
} from '$lib/rail/rail-layout-event.js';

/** @type {import('$lib/rail/rail-layout.js').RailNode[]} A layout with every node kind the model has. */
const LAYOUT = [
  { type: 'item', key: 'community:aaa' },
  { type: 'folder', id: 'f1', name: 'Schule', keys: ['area:bbb', 'relay:wss://r.example'] },
  { type: 'item', key: 'relay:wss://s.example' }
];

describe('addressing', () => {
  // NIP-78 app data, the kind this app already uses for encrypted per-user
  // state (inbox read markers). Not a new kind: a new one would need its own
  // relay support for no gain.
  it('is NIP-78 app data under an edufeed-namespaced d tag', () => {
    expect(RAIL_LAYOUT_KIND).toBe(30078);
    expect(RAIL_LAYOUT_D_TAG).toBe('edufeed:rail-layout');
  });
});

describe('encodeRailLayout / decodeRailLayout', () => {
  it('round-trips a layout through NIP-44 self-encryption with the folder intact', () => {
    const secret = generateSecretKey();
    const conversationKey = nip44.v2.utils.getConversationKey(secret, getPublicKey(secret));

    const ciphertext = nip44.v2.encrypt(JSON.stringify(encodeRailLayout(LAYOUT)), conversationKey);
    const decoded = decodeRailLayout(JSON.parse(nip44.v2.decrypt(ciphertext, conversationKey)));

    expect(decoded).toEqual(LAYOUT);
    // Named separately: `toEqual` on the whole array would still pass if the
    // folder survived as an empty husk, which is the failure being guarded.
    const folder = /** @type {any} */ (decoded)?.[1];
    expect(folder.keys).toEqual(['area:bbb', 'relay:wss://r.example']);
    expect(folder.name).toBe('Schule');
  });

  // The falsifier for the test above. An encrypt/decrypt round-trip is worth
  // nothing unless corrupting the ciphertext makes it fail — and applesauce's
  // own encrypt caches the plaintext on the draft under a symbol, so
  // encrypt-then-unlock-the-same-object compares plaintext to itself and would
  // pass against a broken cipher. Nothing here touches those helpers: raw
  // nip44 both ways, so a bad ciphertext genuinely cannot survive.
  it('fails loudly when the ciphertext is corrupted', () => {
    const secret = generateSecretKey();
    const conversationKey = nip44.v2.utils.getConversationKey(secret, getPublicKey(secret));
    const ciphertext = nip44.v2.encrypt(JSON.stringify(encodeRailLayout(LAYOUT)), conversationKey);

    const flipped =
      ciphertext.slice(0, 20) + (ciphertext[20] === 'A' ? 'B' : 'A') + ciphertext.slice(21);
    expect(() => nip44.v2.decrypt(flipped, conversationKey)).toThrow();
  });

  it('stamps a schema version so a later format can tell itself apart', () => {
    expect(encodeRailLayout(LAYOUT).v).toBe(RAIL_LAYOUT_VERSION);
  });

  it('decodes an empty layout as an empty layout, not as absent', () => {
    expect(decodeRailLayout(encodeRailLayout([]))).toEqual([]);
  });

  // Everything below is the "null, never []" contract.
  it('returns null for a payload that is not a rail layout', () => {
    expect(decodeRailLayout(null)).toBeNull();
    expect(decodeRailLayout(undefined)).toBeNull();
    expect(decodeRailLayout('nonsense')).toBeNull();
    expect(decodeRailLayout({})).toBeNull();
    expect(decodeRailLayout({ v: RAIL_LAYOUT_VERSION })).toBeNull();
  });

  it('returns null when the layout field is not an array', () => {
    expect(decodeRailLayout({ v: RAIL_LAYOUT_VERSION, layout: 'x' })).toBeNull();
    expect(decodeRailLayout({ v: RAIL_LAYOUT_VERSION, layout: { 0: 'x' } })).toBeNull();
  });

  it('returns null for a schema version it does not know', () => {
    expect(decodeRailLayout({ v: RAIL_LAYOUT_VERSION + 1, layout: [] })).toBeNull();
    expect(decodeRailLayout({ layout: [] })).toBeNull();
  });
});

describe('isNewerLayoutEvent', () => {
  const at = (/** @type {number} */ created_at, /** @type {string} */ id) => ({ created_at, id });

  it('prefers the later created_at', () => {
    expect(isNewerLayoutEvent(at(200, 'ff'), at(100, 'aa'))).toBe(true);
    expect(isNewerLayoutEvent(at(100, 'aa'), at(200, 'ff'))).toBe(false);
  });

  // NIP-01's own tie-break for replaceables. Matching it is the point: if the
  // client picked the other one, two devices would each believe a different
  // event is current while the relay served only one of them.
  it('breaks a created_at tie on the lower id, the way a relay does', () => {
    expect(isNewerLayoutEvent(at(100, 'aa'), at(100, 'ff'))).toBe(true);
    expect(isNewerLayoutEvent(at(100, 'ff'), at(100, 'aa'))).toBe(false);
  });

  it('is false for the very same event, so a re-delivery changes nothing', () => {
    expect(isNewerLayoutEvent(at(100, 'aa'), at(100, 'aa'))).toBe(false);
  });

  it('accepts anything when nothing is held yet, and nothing when there is no candidate', () => {
    expect(isNewerLayoutEvent(at(100, 'aa'), null)).toBe(true);
    expect(isNewerLayoutEvent(null, at(100, 'aa'))).toBe(false);
    expect(isNewerLayoutEvent(null, null)).toBe(false);
  });
});

describe('nextLayoutCreatedAt', () => {
  it('uses the clock when there is nothing to beat', () => {
    expect(nextLayoutCreatedAt(1000, null)).toBe(1000);
    expect(nextLayoutCreatedAt(1000, undefined)).toBe(1000);
  });

  it('uses the clock when it is already ahead of the remote', () => {
    expect(nextLayoutCreatedAt(1000, 900)).toBe(1000);
  });

  // The one that would otherwise be silent: a device whose clock trails the
  // other device writes an event the relay treats as older and drops, so the
  // user's drag reverts a second later with no error anywhere.
  it('steps past the remote when this clock is behind or equal', () => {
    expect(nextLayoutCreatedAt(1000, 1000)).toBe(1001);
    expect(nextLayoutCreatedAt(1000, 1030)).toBe(1031);
  });

  it('may step up to the full skew allowance', () => {
    expect(nextLayoutCreatedAt(1000, 1000 + MAX_FUTURE_SKEW - 1)).toBe(1000 + MAX_FUTURE_SKEW);
  });

  // The bump is what makes a skewed clock survivable, but an UNBOUNDED bump
  // mints an event far enough in the future that a relay with a
  // timestamp-delta policy drops it — and publishEvent resolves rather than
  // throwing on rejection, so that drop is silent. Refusing is the honest
  // move: the caller keeps the edit locally and reports sync as blocked,
  // instead of believing it saved something no relay accepted.
  it('refuses rather than minting an event beyond the skew allowance', () => {
    expect(nextLayoutCreatedAt(1000, 1000 + MAX_FUTURE_SKEW)).toBeNull();
    expect(nextLayoutCreatedAt(1000, 99999)).toBeNull();
  });

  it('allows at most a minute of future-dating', () => {
    expect(MAX_FUTURE_SKEW).toBe(60);
  });

  it('ignores a remote created_at that is not a number', () => {
    expect(nextLayoutCreatedAt(1000, /** @type {any} */ ('later'))).toBe(1000);
    expect(nextLayoutCreatedAt(1000, /** @type {any} */ (NaN))).toBe(1000);
  });
});
