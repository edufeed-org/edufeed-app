/**
 * Share-permission pure helpers — the rule under test: restriction marking
 * fails OPEN on every missing input (no event, no section, no gate, unloaded
 * list), and closes only on positive evidence the share would be invisible.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  sectionGateForKind,
  shareWouldBeVisible,
  sectionForKind,
  rosterGateForKind
} from '$lib/helpers/share-permission.js';

const PK = 'f'.repeat(64);
const USER = 'a'.repeat(64);

const gatedEvent = {
  pubkey: PK,
  tags: [
    ['strict', 'content'],
    ['content', 'Learning'],
    ['k', '30142'],
    ['a', `30000:${PK}:publishers`, 'wss://r.example'],
    ['content', 'Chat'],
    ['k', '9']
  ]
};

describe('sectionGateForKind', () => {
  it('finds the gate of the section covering the kind', () => {
    expect(sectionGateForKind(gatedEvent, 30142)).toEqual({
      address: `30000:${PK}:publishers`,
      relay: 'wss://r.example'
    });
  });

  it('fails open: ungated section, uncovered kind, missing event', () => {
    expect(sectionGateForKind(gatedEvent, 9)).toBeNull();
    expect(sectionGateForKind(gatedEvent, 30023)).toBeNull();
    expect(sectionGateForKind(null, 30142)).toBeNull();
    expect(sectionGateForKind(gatedEvent, undefined)).toBeNull();
  });
});

describe('shareWouldBeVisible', () => {
  const list = {
    tags: [
      ['d', 'publishers'],
      ['p', USER]
    ]
  };

  it('listed user and the community key pass', () => {
    expect(shareWouldBeVisible({ userPubkey: USER, communityPubkey: PK, listEvent: list })).toBe(
      true
    );
    expect(
      shareWouldBeVisible({ userPubkey: PK, communityPubkey: PK, listEvent: { tags: [] } })
    ).toBe(true);
  });

  it('unlisted user is invisible; unloaded list fails open', () => {
    expect(
      shareWouldBeVisible({ userPubkey: 'b'.repeat(64), communityPubkey: PK, listEvent: list })
    ).toBe(false);
    expect(
      shareWouldBeVisible({ userPubkey: 'b'.repeat(64), communityPubkey: PK, listEvent: null })
    ).toBe(true);
  });
});

// Moderated communities gate on the NIP-29 roster rather than a profile
// list, and nothing greyed those rows out — a member's share into a
// publisher-gated section published fine and then rendered for nobody, which
// is the exact failure the profile-list path already guards against.
describe('sectionForKind / rosterGateForKind', () => {
  const RELAY = 'wss://groups.example/';
  const moderatedEvent = {
    pubkey: PK,
    created_at: 1000,
    tags: [
      ['membership', 'root1', RELAY],
      ['strict', 'content'],
      ['content', 'Learning'],
      ['k', '30142'],
      ['access', 'role', 'publisher'],
      ['content', 'Calendar'],
      ['k', '31923'],
      ['access', 'members'],
      ['content', 'Chat'],
      ['k', '9']
    ]
  };

  it('sectionForKind returns the whole section, so the caller can read its tier', () => {
    expect(sectionForKind(moderatedEvent, 30142)?.name).toBe('Learning');
    expect(sectionForKind(moderatedEvent, 9)?.name).toBe('Chat');
    expect(sectionForKind(moderatedEvent, 30023)).toBeNull();
    expect(sectionForKind(null, 30142)).toBeNull();
    expect(sectionForKind(moderatedEvent, undefined)).toBeNull();
  });

  it('reports the roster gate plus the pointer needed to resolve it', () => {
    expect(rosterGateForKind(moderatedEvent, 30142)).toEqual({
      section: expect.objectContaining({ name: 'Learning' }),
      access: { tier: 'role', role: 'publisher' },
      pointer: { id: 'root1', relay: RELAY }
    });
    expect(rosterGateForKind(moderatedEvent, 31923)?.access).toEqual({ tier: 'members' });
  });

  it('fails open on an ungated section, an unknown kind, or a missing event', () => {
    expect(rosterGateForKind(moderatedEvent, 9)).toBeNull();
    expect(rosterGateForKind(moderatedEvent, 30023)).toBeNull();
    expect(rosterGateForKind(null, 30142)).toBeNull();
  });

  it('fails open on a community with no membership pointer: no roster, no gate', () => {
    // An `access` tier is moderated-only per the NIP draft. On an open
    // community there is no roster to check it against, so treating it as a
    // restriction would grey out rows for a rule nobody can evaluate.
    const openEvent = {
      pubkey: PK,
      tags: [
        ['content', 'Learning'],
        ['k', '30142'],
        ['access', 'members']
      ]
    };
    expect(rosterGateForKind(openEvent, 30142)).toBeNull();
  });
});
