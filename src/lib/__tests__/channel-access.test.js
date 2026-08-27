/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { channelAccessLevel, channelGlyph } from '$lib/groups/channel-access.js';

const R = 'wss://groups.example';

/** kind:39000 as a spec-current relay emits it. */
const meta = (/** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', 'allgemein'], ...extra]
});

const ptr = (/** @type {string} */ access) => ({ id: 'allgemein', relay: R, access });

describe('channelAccessLevel', () => {
  it('is "world" when the group carries no private tag', () => {
    expect(channelAccessLevel(meta([['restricted']]), ptr('members'))).toBe('world');
  });

  // The old NIP-29 draft had inverse tags `public`/`open`; the current spec
  // dropped them and states openness by OMITTING `private`. applesauce's
  // getGroupMetadata still reads the dead tags into isPublic/isOpen, so a
  // genuinely world-open group has isPublic === false. Deriving "world" from
  // isPublic would call every open channel closed.
  it('is "world" for a spec-current open group, which carries no public tag', () => {
    const event = meta();
    expect(event.tags.some((t) => t[0] === 'public')).toBe(false);
    expect(channelAccessLevel(event, ptr('members'))).toBe('world');
  });

  // The pointer's members/invited marker is retired (the kind-10222 `group`
  // pointer it rode on is dropped): every private channel is now "invited".
  // "All community members, privately" lives in Concord instead.
  it('is "invited" for any private group, whatever the (ignored) pointer marker says', () => {
    expect(channelAccessLevel(meta([['private'], ['closed']]), ptr('members'))).toBe('invited');
    expect(channelAccessLevel(meta([['private'], ['closed']]), ptr('invited'))).toBe('invited');
  });

  // Fail closed: a lock on something open understates it and misleads nobody;
  // a # on something locked tells people colleagues are reading when they are not.
  it('is "invited" for a private group even with no pointer at all', () => {
    const unmarked = /** @type {any} */ ({ id: 'allgemein', relay: R });
    expect(channelAccessLevel(meta([['private']]), unmarked)).toBe('invited');
    expect(channelAccessLevel(meta([['private']]), ptr('nonsense'))).toBe('invited');
  });

  it('is "unknown" while the metadata event has not arrived', () => {
    for (const missing of [null, undefined]) {
      expect(channelAccessLevel(missing, ptr('members'))).toBe('unknown');
    }
  });

  it('is "unknown" for an event that is not group metadata', () => {
    expect(channelAccessLevel({ kind: 9, tags: [['h', 'allgemein']] }, ptr('members'))).toBe(
      'unknown'
    );
  });

  // Same hazard as the pointer parser: community/channel events live in Svelte
  // state, and applesauce's getGroupMetadata memoises onto a Symbol (061c05c9).
  it('does not write a cache symbol onto the metadata event', () => {
    const event = meta([['private']]);
    channelAccessLevel(event, ptr('members'));
    expect(Object.getOwnPropertySymbols(event)).toEqual([]);
  });
});

describe('channelGlyph', () => {
  it('leads every level with # — the lock is a trailing badge, not the glyph', () => {
    expect(channelGlyph('world').symbol).toBe('#');
    expect(channelGlyph('members').symbol).toBe('#');
    expect(channelGlyph('invited').symbol).toBe('#');
  });

  it('adds the globe only for world-readable channels', () => {
    expect(channelGlyph('world').worldReadable).toBe(true);
    expect(channelGlyph('members').worldReadable).toBe(false);
    expect(channelGlyph('invited').worldReadable).toBe(false);
  });

  it('marks only invited channels locked', () => {
    expect(channelGlyph('world').locked).toBe(false);
    expect(channelGlyph('members').locked).toBe(false);
    expect(channelGlyph('invited').locked).toBe(true);
  });

  it('shows the lock while the level is unknown, never the open badge', () => {
    expect(channelGlyph('unknown').locked).toBe(true);
    expect(channelGlyph('unknown').worldReadable).toBe(false);
  });
});

// A relay that requires NIP-42 AUTH gates every read: nothing on it is
// world-readable, whatever the group's own tags omit. Live case: the buzz
// community relays (auth_required: true) publish 39000s with no `private`
// tag, and the globe overstated openness — the one direction the glyph must
// never err in.
describe('channelAccessLevel on an auth-required host', () => {
  it('caps "world" down to "members" when the relay requires auth', () => {
    expect(channelAccessLevel(meta(), ptr('members'), true)).toBe('members');
  });

  it('leaves private groups "invited", whatever the auth flag', () => {
    expect(channelAccessLevel(meta([['private']]), ptr('members'), true)).toBe('invited');
    expect(channelAccessLevel(meta([['private']]), ptr('invited'), true)).toBe('invited');
  });

  it('leaves "unknown" untouched while metadata has not loaded', () => {
    expect(channelAccessLevel(null, ptr('members'), true)).toBe('unknown');
  });

  it('changes nothing when the flag is absent (default open relay)', () => {
    expect(channelAccessLevel(meta(), ptr('members'))).toBe('world');
  });
});
