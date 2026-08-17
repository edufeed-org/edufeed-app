/**
 * Share-permission pure helpers — the rule under test: restriction marking
 * fails OPEN on every missing input (no event, no section, no gate, unloaded
 * list), and closes only on positive evidence the share would be invisible.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { sectionGateForKind, shareWouldBeVisible } from '$lib/helpers/share-permission.js';

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
