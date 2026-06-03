// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: vi.fn(() => ({}))
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => []
}));

import {
  getNotificationType,
  isUnread,
  filterSelfNotifications,
  isMembershipApplication,
  getNotificationUrl,
  extractMentionPubkeys
} from '$lib/helpers/inbox.js';

describe('getNotificationType', () => {
  it('returns "formRequest" for kind 1070', () => {
    expect(getNotificationType({ kind: 1070 })).toBe('formRequest');
  });
  it('returns "reaction" for kind 7 without k=0 tag', () => {
    expect(getNotificationType({ kind: 7, tags: [['k', '1']] })).toBe('reaction');
  });
  it('returns "wave" for kind 7 with k=0 tag', () => {
    expect(
      getNotificationType({
        kind: 7,
        tags: [
          ['e', 'abc'],
          ['p', 'def'],
          ['k', '0']
        ]
      })
    ).toBe('wave');
  });
  it('returns "comment" for kind 1111', () => {
    expect(getNotificationType({ kind: 1111 })).toBe('comment');
  });
  it('returns "mention" for kind 9', () => {
    expect(getNotificationType({ kind: 9 })).toBe('mention');
  });
  it('returns "rsvp" for kind 31925', () => {
    expect(getNotificationType({ kind: 31925 })).toBe('rsvp');
  });
  it('returns "formResponse" for kind 1069', () => {
    expect(getNotificationType({ kind: 1069 })).toBe('formResponse');
  });
  it('returns "pollVote" for kind 1018', () => {
    expect(getNotificationType({ kind: 1018 })).toBe('pollVote');
  });
  it('returns null for unknown kind', () => {
    expect(getNotificationType({ kind: 1 })).toBe(null);
  });
});

describe('isUnread', () => {
  const readMarkers = { global: 1000, formRequest: 1100, reaction: 900 };

  it('returns true when event is newer than type-specific marker', () => {
    expect(isUnread({ kind: 7, created_at: 950 }, readMarkers)).toBe(true);
  });
  it('returns false when event is older than type-specific marker', () => {
    expect(isUnread({ kind: 1070, created_at: 1050 }, readMarkers)).toBe(false);
  });
  it('falls back to global marker when type has no specific marker', () => {
    expect(isUnread({ kind: 1111, created_at: 1050 }, readMarkers)).toBe(true);
    expect(isUnread({ kind: 1111, created_at: 950 }, readMarkers)).toBe(false);
  });
  it('uses formResponse marker for kind 1069', () => {
    const markers = { global: 1000, formResponse: 1200 };
    expect(isUnread({ kind: 1069, created_at: 1100 }, markers)).toBe(false);
    expect(isUnread({ kind: 1069, created_at: 1300 }, markers)).toBe(true);
  });
  it('returns true when readMarkers is null (first login)', () => {
    expect(isUnread({ kind: 7, created_at: 500 }, null)).toBe(true);
  });
});

describe('filterSelfNotifications', () => {
  it('removes events authored by the user', () => {
    const events = [
      { pubkey: 'aaa', kind: 7 },
      { pubkey: 'bbb', kind: 7 },
      { pubkey: 'aaa', kind: 1111 }
    ];
    expect(filterSelfNotifications(events, 'aaa')).toEqual([{ pubkey: 'bbb', kind: 7 }]);
  });
  it('returns empty array when all events are self', () => {
    expect(filterSelfNotifications([{ pubkey: 'aaa', kind: 7 }], 'aaa')).toEqual([]);
  });
});

describe('isMembershipApplication', () => {
  const formAddress = '30168:admin:edufeed-membership';
  const makeResponse = (/** @type {string[][]} */ tags, /** @type {number} */ kind = 1069) => ({
    kind,
    tags
  });

  it('is true for a kind 1069 with matching `a` tag', () => {
    expect(isMembershipApplication(makeResponse([['a', formAddress]]), formAddress)).toBe(true);
  });

  it('is false when the `a` tag points at a different form', () => {
    expect(isMembershipApplication(makeResponse([['a', '30168:admin:other']]), formAddress)).toBe(
      false
    );
  });

  it('is false for non-1069 events even with matching `a` tag', () => {
    expect(isMembershipApplication(makeResponse([['a', formAddress]], 1070), formAddress)).toBe(
      false
    );
  });

  it('is false when membershipFormAddress is empty or nullish', () => {
    const evt = makeResponse([['a', formAddress]]);
    expect(isMembershipApplication(evt, '')).toBe(false);
    expect(isMembershipApplication(evt, null)).toBe(false);
    expect(isMembershipApplication(evt, undefined)).toBe(false);
  });

  it('is false when the event has no `a` tag at all', () => {
    expect(isMembershipApplication(makeResponse([['p', 'abc']]), formAddress)).toBe(false);
  });
});

describe('getNotificationUrl', () => {
  const validPubkey = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';

  it('returns form respond URL for kind 1070', () => {
    const event = { kind: 1070, tags: [['a', `30168:${validPubkey}:myform`]] };
    const url = getNotificationUrl(event);
    expect(url).toMatch(/^\/forms\/naddr1/);
    expect(url).toMatch(/\/respond$/);
  });
  it('returns form deep-link URL with tab and hash for kind 1069', () => {
    const event = { kind: 1069, id: 'abc123', tags: [['a', `30168:${validPubkey}:myform`]] };
    const url = getNotificationUrl(event);
    expect(url).toMatch(/^\/forms\/naddr1/);
    expect(url).toContain('?tab=responses');
    expect(url).toContain('#response-abc123');
  });
  it('returns community URL for kind 9 with h tag', () => {
    const event = { kind: 9, tags: [['h', 'communitypubkey123']] };
    expect(getNotificationUrl(event)).toBe('/c/communitypubkey123');
  });
  it('returns naddr URL for reaction with a-tag (last a-tag per NIP-25)', () => {
    const event = {
      kind: 7,
      tags: [
        ['a', `30023:${validPubkey}:wrong-one`],
        ['a', `31923:${validPubkey}:correct-one`]
      ]
    };
    const url = getNotificationUrl(event);
    expect(url).toMatch(/^\/naddr1/);
    expect(url).not.toContain('#');
  });
  it('returns nevent URL for reaction with only e-tag', () => {
    const eventId = 'a'.repeat(64);
    const event = {
      kind: 7,
      tags: [
        ['e', eventId, 'wss://relay.example.com'],
        ['p', validPubkey]
      ]
    };
    const url = getNotificationUrl(event);
    expect(url).toMatch(/^\/nevent1/);
    expect(url).not.toContain('#');
  });
  it('returns nevent URL encoding the comment event itself', () => {
    const commentId = 'c'.repeat(64);
    const event = {
      kind: 1111,
      id: commentId,
      tags: [
        ['A', `31923:${validPubkey}:cal-event`, 'wss://relay.example.com'],
        ['K', '31923'],
        ['a', `31923:${validPubkey}:cal-event`, 'wss://relay.example.com'],
        ['k', '31923']
      ]
    };
    const url = getNotificationUrl(event);
    expect(url).toMatch(/^\/nevent1/);
  });
  it('returns naddr URL for RSVP with a-tag', () => {
    const event = {
      kind: 31925,
      tags: [['a', `31923:${validPubkey}:cal-event`, 'wss://relay.example.com']]
    };
    const url = getNotificationUrl(event);
    expect(url).toMatch(/^\/naddr1/);
  });
  it('returns profile URL for wave (kind 7 with k=0)', () => {
    const pokerPubkey = 'a'.repeat(64);
    const event = {
      kind: 7,
      pubkey: pokerPubkey,
      content: '👋',
      tags: [
        ['e', 'b'.repeat(64)],
        ['p', 'c'.repeat(64)],
        ['k', '0'],
        ['a', '0:' + 'c'.repeat(64) + ':']
      ]
    };
    expect(getNotificationUrl(event)).toBe(`/p/${pokerPubkey}`);
  });
  it('returns null for reaction without navigable tags', () => {
    expect(getNotificationUrl({ kind: 7, tags: [] })).toBe(null);
  });
  it('returns nevent URL for comment even without root tags', () => {
    const commentId = 'd'.repeat(64);
    const url = getNotificationUrl({ kind: 1111, id: commentId, tags: [] });
    expect(url).toMatch(/^\/nevent1/);
  });
  it('returns null for RSVP without a-tag', () => {
    expect(getNotificationUrl({ kind: 31925, tags: [] })).toBe(null);
  });
  it('returns nevent URL for pollVote with e-tag', () => {
    const pollId = 'a'.repeat(64);
    const event = {
      kind: 1018,
      tags: [
        ['e', pollId, 'wss://relay.example.com'],
        ['response', 'option-id']
      ]
    };
    const url = getNotificationUrl(event);
    expect(url).toMatch(/^\/nevent1/);
  });
  it('returns null for pollVote without e-tag', () => {
    expect(getNotificationUrl({ kind: 1018, tags: [['response', 'opt']] })).toBe(null);
  });
});

describe('extractMentionPubkeys', () => {
  it('extracts hex pubkeys from nostr:npub mentions', () => {
    // npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 = 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d
    const content =
      'Hey nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 check this';
    const pubkeys = extractMentionPubkeys(content);
    expect(pubkeys).toHaveLength(1);
    expect(pubkeys[0]).toBe('3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d');
  });
  it('deduplicates repeated mentions', () => {
    const content =
      'nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 and again nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6';
    const pubkeys = extractMentionPubkeys(content);
    expect(pubkeys).toHaveLength(1);
  });
  it('returns empty array when no mentions', () => {
    expect(extractMentionPubkeys('hello world')).toEqual([]);
  });
  it('skips invalid npub strings', () => {
    const content = 'nostr:npub1invalid';
    expect(extractMentionPubkeys(content)).toEqual([]);
  });
});
