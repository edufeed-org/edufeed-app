/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  COMMUNITY_EVENT_KINDS,
  selectEventsForDeletion,
  buildCommunityBackup
} from '$lib/helpers/communityDeletion.js';

const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

/**
 * @param {Partial<import('nostr-tools').NostrEvent>} overrides
 * @returns {any}
 */
function ev(overrides) {
  return {
    id: Math.random().toString(36).slice(2),
    pubkey: OWNER,
    kind: 1,
    created_at: 1000,
    tags: [],
    content: '',
    sig: 'x',
    ...overrides
  };
}

describe('selectEventsForDeletion', () => {
  it('community scope keeps only community identity/ACL kinds authored by the community', () => {
    const events = [
      ev({ kind: 10222 }), // definition
      ev({ kind: 0 }), // profile metadata
      ev({ kind: 30000 }), // ACL profile list
      ev({ kind: 30009 }), // legacy access badge
      ev({ kind: 30222 }), // legacy targeted publication
      ev({ kind: 1 }), // a note — NOT a community event
      ev({ kind: 31923 }) // a calendar event — NOT a community event
    ];

    const selected = selectEventsForDeletion(events, OWNER, 'community');
    const kinds = selected.map((e) => e.kind).sort((a, b) => a - b);
    expect(kinds).toEqual([0, 10222, 30000, 30009, 30222]);
  });

  it('all scope keeps every kind authored by the community', () => {
    const events = [ev({ kind: 10222 }), ev({ kind: 1 }), ev({ kind: 31923 }), ev({ kind: 7 })];
    const selected = selectEventsForDeletion(events, OWNER, 'all');
    expect(selected).toHaveLength(4);
  });

  it('never selects events authored by someone other than the community', () => {
    const events = [
      ev({ kind: 10222, pubkey: OTHER }),
      ev({ kind: 1, pubkey: OTHER }),
      ev({ kind: 10222, pubkey: OWNER })
    ];
    expect(selectEventsForDeletion(events, OWNER, 'all')).toHaveLength(1);
    expect(selectEventsForDeletion(events, OWNER, 'community')).toHaveLength(1);
  });

  it('never selects kind 5 deletion events (avoids deleting deletions)', () => {
    const events = [ev({ kind: 5 }), ev({ kind: 10222 })];
    expect(selectEventsForDeletion(events, OWNER, 'all').map((e) => e.kind)).toEqual([10222]);
    expect(selectEventsForDeletion(events, OWNER, 'community').map((e) => e.kind)).toEqual([10222]);
  });

  it('deduplicates events by id', () => {
    const shared = ev({ kind: 10222, id: 'dup' });
    const selected = selectEventsForDeletion([shared, { ...shared }], OWNER, 'community');
    expect(selected).toHaveLength(1);
  });

  it('COMMUNITY_EVENT_KINDS contains the documented identity/ACL kinds', () => {
    expect(COMMUNITY_EVENT_KINDS).toContain(10222);
    expect(COMMUNITY_EVENT_KINDS).toContain(30000);
    expect(COMMUNITY_EVENT_KINDS).toContain(0);
    expect(COMMUNITY_EVENT_KINDS).not.toContain(5);
  });
});

describe('buildCommunityBackup', () => {
  it('produces a JSON file containing the events and the community pubkey', () => {
    const events = [ev({ kind: 10222 }), ev({ kind: 0 })];
    const { content, filename } = buildCommunityBackup(events, { pubkey: OWNER });

    const parsed = JSON.parse(content);
    expect(parsed.pubkey).toBe(OWNER);
    expect(parsed.events).toHaveLength(2);
    expect(typeof parsed.exportedAt).toBe('string');
    expect(filename).toMatch(/\.json$/);
    expect(filename).toContain(OWNER.slice(0, 12));
  });

  it('handles an empty event list', () => {
    const { content } = buildCommunityBackup([], { pubkey: OWNER });
    expect(JSON.parse(content).events).toEqual([]);
  });
});
