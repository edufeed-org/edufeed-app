/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { eventRoutePath } from '$lib/helpers/eventRoutePath.js';

const PK = 'a'.repeat(64);
const COMMUNITY = 'b'.repeat(64);
const NPUB = nip19.npubEncode(COMMUNITY);
const NADDR = 'naddr1test';
const NEVENT = 'nevent1test';

/** @param {number} kind @param {string[][]} [tags] */
const ev = (kind, tags = []) => ({ kind, pubkey: PK, tags });

describe('eventRoutePath', () => {
  it('routes community-scoped addressables to /c/<npub>/<type>/<naddr>', () => {
    const h = [['h', COMMUNITY]];
    expect(eventRoutePath(ev(30023, h), { naddr: NADDR })).toBe(`/c/${NPUB}/article/${NADDR}`);
    expect(eventRoutePath(ev(30142, h), { naddr: NADDR })).toBe(`/c/${NPUB}/r/${NADDR}`);
    expect(eventRoutePath(ev(30818, h), { naddr: NADDR })).toBe(`/c/${NPUB}/wiki/${NADDR}`);
    expect(eventRoutePath(ev(31923, h), { naddr: NADDR })).toBe(`/c/${NPUB}/event/${NADDR}`);
  });

  it('routes calendar kinds to their top-level routes', () => {
    expect(eventRoutePath(ev(31922), { naddr: NADDR })).toBe(`/calendar/event/${NADDR}`);
    expect(eventRoutePath(ev(31924, [['h', COMMUNITY]]), { naddr: NADDR })).toBe(
      `/calendar/${NADDR}`
    );
  });

  it('routes other addressables to /<naddr>', () => {
    expect(eventRoutePath(ev(30023), { naddr: NADDR })).toBe(`/${NADDR}`);
    expect(eventRoutePath(ev(30040, [['h', COMMUNITY]]), { naddr: NADDR })).toBe(`/${NADDR}`);
  });

  it('routes non-addressables by nevent, community-scoped when h-tagged', () => {
    expect(eventRoutePath(ev(1), { nevent: NEVENT })).toBe(`/${NEVENT}`);
    expect(eventRoutePath(ev(1, [['h', COMMUNITY]]), { nevent: NEVENT })).toBe(
      `/c/${NPUB}/${NEVENT}`
    );
  });

  it('ignores a malformed h-tag', () => {
    expect(eventRoutePath(ev(30023, [['h', 'not-hex']]), { naddr: NADDR })).toBe(`/${NADDR}`);
  });

  it('returns null without the needed identifier', () => {
    expect(eventRoutePath(ev(30023), {})).toBeNull();
    expect(eventRoutePath(ev(1), {})).toBeNull();
    expect(eventRoutePath(null, { naddr: NADDR })).toBeNull();
  });
});
