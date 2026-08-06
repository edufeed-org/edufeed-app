/** @vitest-environment node */
/**
 * The small labels on a group's home: what the RELAY says about itself
 * (NIP-11) and what the group's own kind:39000 says about access.
 *
 * Armada shows the same two families (ServerPage.tsx:88-97 and :181-183) and
 * they are what laoc asked for in round 1 — "ein kleines Tag oder Label, um
 * die unterscheiden zu können".
 */
import { describe, it, expect } from 'vitest';
import { relayBadges, channelBadges } from '$lib/groups/group-badges.js';

describe('relayBadges', () => {
  it('says nothing when there is no NIP-11 document', () => {
    expect(relayBadges(null)).toEqual([]);
    expect(relayBadges(undefined)).toEqual([]);
  });

  it('reports that the relay demands authentication', () => {
    const badges = relayBadges({ limitation: { auth_required: true } });
    expect(badges.map((b) => b.id)).toContain('auth');
  });

  // auth_required: false is a statement, not a missing field — and it is the
  // one case where a badge would say the opposite of the truth.
  it('stays silent when the relay says it does NOT demand authentication', () => {
    expect(relayBadges({ limitation: { auth_required: false } }).map((b) => b.id)).not.toContain(
      'auth'
    );
  });

  it('reports NIP-29 support from supported_nips', () => {
    expect(relayBadges({ supported_nips: [1, 11, 29, 42] }).map((b) => b.id)).toContain('nip29');
  });

  it('does not claim NIP-29 for a relay that never listed it', () => {
    expect(relayBadges({ supported_nips: [1, 11] }).map((b) => b.id)).not.toContain('nip29');
  });

  // A NIP-11 document is untrusted network input; a relay may send anything.
  it('survives a supported_nips that is not a list', () => {
    expect(() => relayBadges({ supported_nips: 'twentynine' })).not.toThrow();
    expect(relayBadges({ supported_nips: 'twentynine' }).map((b) => b.id)).not.toContain('nip29');
  });

  it('shows the software and version as free text, not a translated label', () => {
    const badge = relayBadges({
      software: 'git+https://github.com/fiatjaf/pyramid',
      version: '1.2'
    }).find((b) => b.id === 'software');
    expect(badge?.text).toBe('pyramid 1.2');
  });

  it('shows the software alone when no version is given', () => {
    const badge = relayBadges({ software: 'strfry' }).find((b) => b.id === 'software');
    expect(badge?.text).toBe('strfry');
  });

  it('omits the software badge entirely when the relay names none', () => {
    expect(relayBadges({ version: '1.2' }).map((b) => b.id)).not.toContain('software');
  });
});

describe('channelBadges', () => {
  const meta = (/** @type {string[]} */ flags) => ({
    kind: 39000,
    tags: flags.map((f) => [f])
  });

  it('says nothing while the metadata has not arrived', () => {
    expect(channelBadges(null)).toEqual([]);
  });

  it('marks a private group as members-only', () => {
    expect(channelBadges(meta(['private'])).map((b) => b.id)).toEqual(['members']);
  });

  it('says nothing about a group the relay leaves open', () => {
    expect(channelBadges(meta(['restricted']))).toEqual([]);
  });

  // `closed` on top of `private` adds nothing a reader can act on — they
  // cannot read it either way. Armada suppresses the same badge, but keys
  // that on a hostname; this keys on whether the badge carries information.
  it('does not repeat invite-only on a group that is already members-only', () => {
    expect(channelBadges(meta(['private', 'closed'])).map((b) => b.id)).toEqual(['members']);
  });

  // Readable by anyone, joinable only by invitation — that IS worth saying,
  // because it is the difference between "read along" and "take part".
  it('marks a readable group that you cannot simply join', () => {
    expect(channelBadges(meta(['closed'])).map((b) => b.id)).toEqual(['invite']);
  });

  it('ignores anything that is not a group metadata event', () => {
    expect(channelBadges({ kind: 9, tags: [['private']] })).toEqual([]);
  });
});
