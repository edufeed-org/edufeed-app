// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { addSeenRelay } from 'applesauce-core/helpers';
import { getCanonicalEventRoute } from '$lib/helpers/eventRouteRedirect.js';

const AUTHOR_HEX = 'a'.repeat(64);
const COMMUNITY_HEX = 'b'.repeat(64);
const EVENT_ID = 'c'.repeat(64);
const COMMUNITY_NPUB = nip19.npubEncode(COMMUNITY_HEX);

/**
 * Build an event with optional h-tag and d-tag.
 * @param {{ kind: number, hTag?: string, dTag?: string }} opts
 */
function makeEvent({ kind, hTag, dTag }) {
  const tags = [];
  if (hTag) tags.push(['h', hTag]);
  if (dTag !== undefined) tags.push(['d', dTag]);
  return { kind, pubkey: AUTHOR_HEX, id: EVENT_ID, tags, content: '', created_at: 0, sig: '' };
}

function expectedNaddr(kind, dTag = '') {
  return nip19.naddrEncode({ kind, pubkey: AUTHOR_HEX, identifier: dTag, relays: [] });
}

function expectedNevent() {
  return nip19.neventEncode({ id: EVENT_ID, relays: [] });
}

describe('getCanonicalEventRoute', () => {
  describe('calendar events (31922 / 31923)', () => {
    it('routes time-based event with no h-tag to /calendar/event/<naddr>', () => {
      const event = makeEvent({ kind: 31923, dTag: 'evt1' });
      expect(getCanonicalEventRoute(event)).toBe(`/calendar/event/${expectedNaddr(31923, 'evt1')}`);
    });

    it('routes date-based event with no h-tag to /calendar/event/<naddr>', () => {
      const event = makeEvent({ kind: 31922, dTag: 'evt2' });
      expect(getCanonicalEventRoute(event)).toBe(`/calendar/event/${expectedNaddr(31922, 'evt2')}`);
    });

    it('routes h-tagged time-based event to /c/<npub>/event/<naddr>', () => {
      const event = makeEvent({ kind: 31923, hTag: COMMUNITY_HEX, dTag: 'evt3' });
      expect(getCanonicalEventRoute(event)).toBe(
        `/c/${COMMUNITY_NPUB}/event/${expectedNaddr(31923, 'evt3')}`
      );
    });

    it('routes h-tagged date-based event to /c/<npub>/event/<naddr>', () => {
      const event = makeEvent({ kind: 31922, hTag: COMMUNITY_HEX, dTag: 'evt4' });
      expect(getCanonicalEventRoute(event)).toBe(
        `/c/${COMMUNITY_NPUB}/event/${expectedNaddr(31922, 'evt4')}`
      );
    });
  });

  describe('calendar collection (31924)', () => {
    it('routes calendar collection to /calendar/<naddr> regardless of h-tag', () => {
      const noHTag = makeEvent({ kind: 31924, dTag: 'col1' });
      const withHTag = makeEvent({ kind: 31924, hTag: COMMUNITY_HEX, dTag: 'col2' });
      expect(getCanonicalEventRoute(noHTag)).toBe(`/calendar/${expectedNaddr(31924, 'col1')}`);
      expect(getCanonicalEventRoute(withHTag)).toBe(`/calendar/${expectedNaddr(31924, 'col2')}`);
    });
  });

  describe('community-scoped addressables', () => {
    it('routes h-tagged article (30023) to /c/<npub>/article/<naddr>', () => {
      const event = makeEvent({ kind: 30023, hTag: COMMUNITY_HEX, dTag: 'a1' });
      expect(getCanonicalEventRoute(event)).toBe(
        `/c/${COMMUNITY_NPUB}/article/${expectedNaddr(30023, 'a1')}`
      );
    });

    it('routes h-tagged AMB resource (30142) to /c/<npub>/r/<naddr>', () => {
      const event = makeEvent({ kind: 30142, hTag: COMMUNITY_HEX, dTag: 'r1' });
      expect(getCanonicalEventRoute(event)).toBe(
        `/c/${COMMUNITY_NPUB}/r/${expectedNaddr(30142, 'r1')}`
      );
    });

    it('routes h-tagged kanban board (30301) to /c/<npub>/board/<naddr>', () => {
      const event = makeEvent({ kind: 30301, hTag: COMMUNITY_HEX, dTag: 'b1' });
      expect(getCanonicalEventRoute(event)).toBe(
        `/c/${COMMUNITY_NPUB}/board/${expectedNaddr(30301, 'b1')}`
      );
    });

    it('routes h-tagged wiki article (30818) to /c/<npub>/wiki/<naddr>', () => {
      const event = makeEvent({ kind: 30818, hTag: COMMUNITY_HEX, dTag: 'w1' });
      expect(getCanonicalEventRoute(event)).toBe(
        `/c/${COMMUNITY_NPUB}/wiki/${expectedNaddr(30818, 'w1')}`
      );
    });
  });

  describe('non-community addressables', () => {
    it('routes article (30023) with no h-tag to /<naddr>', () => {
      const event = makeEvent({ kind: 30023, dTag: 'a2' });
      expect(getCanonicalEventRoute(event)).toBe(`/${expectedNaddr(30023, 'a2')}`);
    });

    it('routes AMB resource (30142) with no h-tag to /<naddr>', () => {
      const event = makeEvent({ kind: 30142, dTag: 'r2' });
      expect(getCanonicalEventRoute(event)).toBe(`/${expectedNaddr(30142, 'r2')}`);
    });

    it('routes generic addressable (NIP-51 list, 30000) to /<naddr>', () => {
      const event = makeEvent({ kind: 30000, dTag: 'communities' });
      expect(getCanonicalEventRoute(event)).toBe(`/${expectedNaddr(30000, 'communities')}`);
    });
  });

  describe('non-addressable events', () => {
    it('routes kind 1 with no h-tag to /<nevent>', () => {
      const event = makeEvent({ kind: 1 });
      expect(getCanonicalEventRoute(event)).toBe(`/${expectedNevent()}`);
    });

    it('routes h-tagged kind 1111 (comment) to /c/<npub>/<nevent>', () => {
      const event = makeEvent({ kind: 1111, hTag: COMMUNITY_HEX });
      expect(getCanonicalEventRoute(event)).toBe(`/c/${COMMUNITY_NPUB}/${expectedNevent()}`);
    });

    it('routes h-tagged kind 11 (forum) to /c/<npub>/<nevent>', () => {
      const event = makeEvent({ kind: 11, hTag: COMMUNITY_HEX });
      expect(getCanonicalEventRoute(event)).toBe(`/c/${COMMUNITY_NPUB}/${expectedNevent()}`);
    });

    it('preserves the event seen-relays as nevent hints', () => {
      const event = makeEvent({ kind: 1111, hTag: COMMUNITY_HEX });
      addSeenRelay(event, 'wss://relay-rpi.edufeed.org');
      addSeenRelay(event, 'wss://nos.lol');

      const route = getCanonicalEventRoute(event);
      const nevent = route.split('/').pop();
      const decoded = nip19.decode(nevent);

      expect(decoded.type).toBe('nevent');
      expect(decoded.data.relays).toEqual(
        expect.arrayContaining(['wss://relay-rpi.edufeed.org', 'wss://nos.lol'])
      );
    });
  });

  describe('edge cases', () => {
    it('returns null for null event', () => {
      expect(getCanonicalEventRoute(null)).toBeNull();
    });

    it('returns null for undefined event', () => {
      expect(getCanonicalEventRoute(undefined)).toBeNull();
    });

    it('falls back to /<nevent> when h-tag is malformed (not 64 hex)', () => {
      const event = makeEvent({ kind: 1, hTag: 'not-a-pubkey' });
      expect(getCanonicalEventRoute(event)).toBe(`/${expectedNevent()}`);
    });

    it('handles addressable with empty d-tag', () => {
      const event = makeEvent({ kind: 30023, dTag: '' });
      expect(getCanonicalEventRoute(event)).toBe(`/${expectedNaddr(30023, '')}`);
    });

    it('handles addressable with missing d-tag (treated as empty)', () => {
      const event = { kind: 30023, pubkey: AUTHOR_HEX, id: EVENT_ID, tags: [] };
      expect(getCanonicalEventRoute(event)).toBe(`/${expectedNaddr(30023, '')}`);
    });
  });
});
