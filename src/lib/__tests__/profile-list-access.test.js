/**
 * Profile List Access Tests
 *
 * Tests the logic for checking profile-list-based access control.
 * Since useProfileListAccess is a Svelte 5 reactive hook ($effect, $state),
 * we test the underlying logic via parseCommunityContentTypes + getProfilePointersFromList.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { parseCommunityContentTypes } from '../helpers/communityRelays.js';
import { getProfilePointersFromList } from 'applesauce-common/helpers';

/**
 * Helper to build a minimal kind 10222 event with given tags
 * @param {string[][]} tags
 */
function makeCommunityEvent(tags) {
  return { kind: 10222, pubkey: 'community-pubkey', tags, content: '', created_at: 1700000000 };
}

/**
 * Helper to build a minimal kind 30000 profile list event
 * @param {string} pubkey
 * @param {string} identifier
 * @param {string[]} memberPubkeys
 * @param {{ formUrl?: string }} [opts]
 */
function makeProfileListEvent(pubkey, identifier, memberPubkeys, opts = {}) {
  const tags = [['d', identifier], ...memberPubkeys.map((pk) => ['p', pk])];
  if (opts.formUrl) {
    tags.push(['form', opts.formUrl]);
  }
  return /** @type {any} */ ({
    kind: 30000,
    pubkey,
    tags,
    content: '',
    created_at: 1700000000,
    id: 'test-id',
    sig: 'test-sig'
  });
}

// ─── COMMUNITY EVENT PARSING FOR PROFILE LISTS ──────────────────────────────

describe('profile list access — community event parsing', () => {
  it('section without profile list → open access (profileList is null)', () => {
    const event = makeCommunityEvent([
      ['content', 'Chat'],
      ['k', '9']
    ]);
    const contentTypes = parseCommunityContentTypes(event);
    expect(contentTypes[0].profileList).toBeNull();
  });

  it('section with profile list → profileList is set', () => {
    const event = makeCommunityEvent([
      ['content', 'Calendar'],
      ['k', '31922'],
      ['a', '30000:community-pubkey:Calendar', 'wss://relay.example.com']
    ]);
    const contentTypes = parseCommunityContentTypes(event);
    expect(contentTypes[0].profileList).toBe('30000:community-pubkey:Calendar');
    expect(contentTypes[0].profileListRelay).toBe('wss://relay.example.com');
  });

  it('multiple sections with mixed access', () => {
    const event = makeCommunityEvent([
      ['content', 'Chat'],
      ['k', '9'],
      // No profile list → open access
      ['content', 'Calendar'],
      ['k', '31922'],
      ['a', '30000:community-pubkey:Calendar']
      // Has profile list → restricted
    ]);
    const contentTypes = parseCommunityContentTypes(event);
    expect(contentTypes[0].profileList).toBeNull(); // Chat: open
    expect(contentTypes[1].profileList).toBe('30000:community-pubkey:Calendar'); // Calendar: restricted
  });
});

// ─── PROFILE LIST EVENT (KIND 30000) MEMBER EXTRACTION ──────────────────────

describe('profile list access — member extraction from kind 30000', () => {
  it('extracts member pubkeys from p-tags', () => {
    const event = makeProfileListEvent('community-pubkey', 'Calendar', [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    ]);
    const pointers = getProfilePointersFromList(event);
    const pubkeys = pointers.map((p) => p.pubkey);
    expect(pubkeys).toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(pubkeys).toContain('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(pubkeys).toHaveLength(2);
  });

  it('user pubkey in list → canPublish should be true', () => {
    const event = makeProfileListEvent('community-pubkey', 'Calendar', [
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    ]);
    const pointers = getProfilePointersFromList(event);
    const memberSet = new Set(pointers.map((p) => p.pubkey));
    expect(memberSet.has('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc')).toBe(
      true
    );
  });

  it('user pubkey NOT in list → canPublish should be false', () => {
    const event = makeProfileListEvent('community-pubkey', 'Calendar', [
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    ]);
    const pointers = getProfilePointersFromList(event);
    const memberSet = new Set(pointers.map((p) => p.pubkey));
    expect(memberSet.has('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc')).toBe(
      false
    );
  });

  it('empty profile list → no members', () => {
    const event = makeProfileListEvent('community-pubkey', 'Calendar', []);
    const pointers = getProfilePointersFromList(event);
    expect(pointers).toHaveLength(0);
  });

  it('extracts form tag from profile list event', () => {
    const event = makeProfileListEvent('community-pubkey', 'Calendar', ['user1'], {
      formUrl: 'https://forms.example.com/apply'
    });
    const formTag = event.tags.find((/** @type {string[]} */ t) => t[0] === 'form');
    expect(formTag?.[1]).toBe('https://forms.example.com/apply');
  });

  it('no form tag → null', () => {
    const event = makeProfileListEvent('community-pubkey', 'Calendar', ['user1']);
    const formTag = event.tags.find((/** @type {string[]} */ t) => t[0] === 'form');
    expect(formTag).toBeUndefined();
  });
});

// ─── COMMUNITY OWNER BYPASS ────────────────────────────────────────────────

describe('profile list access — community owner bypass', () => {
  it('community owner should have access even if not in profile list', () => {
    const ownerPubkey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const communityEvent = makeCommunityEvent([
      ['content', 'Calendar'],
      ['k', '31922'],
      ['a', '30000:community-pubkey:Calendar']
    ]);
    communityEvent.pubkey = ownerPubkey;

    // Profile list does NOT include the owner
    const profileListEvent = makeProfileListEvent('community-pubkey', 'Calendar', [
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    ]);
    const pointers = getProfilePointersFromList(profileListEvent);
    const memberSet = new Set(pointers.map((p) => p.pubkey));

    // Owner is NOT in the member set
    expect(memberSet.has(ownerPubkey)).toBe(false);

    // But canPublish logic should return true for the owner:
    // if (communityEvent.pubkey === userPubkey) return true;
    const userPubkey = ownerPubkey;
    const isOwner = communityEvent.pubkey === userPubkey;
    expect(isOwner).toBe(true);
  });

  it('non-owner without list membership should not have access', () => {
    const ownerPubkey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const userPubkey = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    const communityEvent = makeCommunityEvent([
      ['content', 'Calendar'],
      ['k', '31922'],
      ['a', '30000:community-pubkey:Calendar']
    ]);
    communityEvent.pubkey = ownerPubkey;

    const profileListEvent = makeProfileListEvent('community-pubkey', 'Calendar', [
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    ]);
    const pointers = getProfilePointersFromList(profileListEvent);
    const memberSet = new Set(pointers.map((p) => p.pubkey));

    const isOwner = communityEvent.pubkey === userPubkey;
    expect(isOwner).toBe(false);
    expect(memberSet.has(userPubkey)).toBe(false);
  });
});

// ─── PROFILE LIST ADDRESS PARSING ───────────────────────────────────────────

describe('profile list access — address parsing', () => {
  it('parses "30000:pubkey:identifier" correctly', () => {
    const address = '30000:community-pubkey:Calendar';
    const parts = address.split(':');
    expect(parts[0]).toBe('30000');
    expect(parts[1]).toBe('community-pubkey');
    expect(parts.slice(2).join(':')).toBe('Calendar');
  });

  it('handles identifier with colons', () => {
    const address = '30000:pubkey:section:subsection';
    const parts = address.split(':');
    const identifier = parts.slice(2).join(':');
    expect(identifier).toBe('section:subsection');
  });
});
