/** @vitest-environment node */
/**
 * Which NIP-29 channels hold an unread mention of the viewer, and which
 * community they belong to — the source of the "@" pill on the rail's
 * community icon and on the community's channel rows. Read from the inbox's
 * own notification list, so the pill and the inbox row are one state.
 */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  unreadMentionsByGroup,
  communityGroupIds,
  communityHasMention
} from '$lib/groups/channel-mentions.js';

const VIEWER = 'c'.repeat(64);
const COMMUNITY = 'd'.repeat(64);
const AUTHOR = 'b'.repeat(64);

/** @param {string} id @param {string} h @param {Partial<any>} [extra] @returns {any} */
const msg = (id, h, extra = {}) => ({
  kind: 9,
  id,
  pubkey: AUTHOR,
  created_at: 1,
  content: `hi nostr:${nip19.npubEncode(VIEWER)}`,
  tags: [
    ['h', h],
    ['p', VIEWER]
  ],
  ...extra
});

describe('unreadMentionsByGroup', () => {
  it('groups unread channel mentions and replies by channel id', () => {
    const reply = msg('r1', 'chanA', {
      content: 'ja',
      tags: [
        ['h', 'chanA'],
        ['e', 'x'.repeat(64)],
        ['p', VIEWER]
      ]
    });
    const byGroup = unreadMentionsByGroup(
      [msg('m1', 'chanA'), reply, msg('m2', 'chanB')],
      () => true,
      VIEWER
    );
    expect(byGroup.get('chanA')).toEqual(['m1', 'r1']);
    expect(byGroup.get('chanB')).toEqual(['m2']);
  });

  it('leaves out read items, community chat and everything that is not kind 9', () => {
    const byGroup = unreadMentionsByGroup(
      [
        msg('read', 'chanA'),
        msg('community', COMMUNITY),
        /** @type {any} */ ({
          kind: 7,
          id: 'reaction',
          pubkey: AUTHOR,
          content: '+',
          tags: [['h', 'chanA']]
        })
      ],
      (/** @type {any} */ e) => e.id !== 'read',
      VIEWER
    );
    expect(byGroup.size).toBe(0);
  });
});

describe('communityHasMention', () => {
  const community = {
    kind: 10222,
    pubkey: COMMUNITY,
    tags: [
      ['membership', 'root1', 'wss://groups.example'],
      ['group', 'chanA', 'wss://groups.example', 'arbeitszimmer'],
      ['group', 'chanA', 'wss://groups.example', 'arbeitszimmer']
    ]
  };

  it('lists the root group and every channel once', () => {
    expect(communityGroupIds(community)).toEqual(['root1', 'chanA']);
    expect(communityGroupIds(null)).toEqual([]);
  });

  it('is true when one of its channels holds an unread mention', () => {
    expect(communityHasMention(community, new Map([['chanA', ['m1']]]))).toBe(true);
    expect(communityHasMention(community, new Map([['root1', ['m1']]]))).toBe(true);
    expect(communityHasMention(community, new Map([['other', ['m1']]]))).toBe(false);
    expect(communityHasMention(null, new Map([['chanA', ['m1']]]))).toBe(false);
  });

  it('finds a channel through its kind 39000 parent, the way channels are made today', () => {
    const rootOnly = {
      kind: 10222,
      pubkey: COMMUNITY,
      tags: [['membership', 'root1', 'wss://groups.example']]
    };
    const meta = (/** @type {string} */ id, /** @type {string} */ parent) => ({
      kind: 39000,
      tags: [
        ['d', id],
        ['parent', parent]
      ]
    });
    const byGroup = new Map([['arbeitszimmer', ['m1']]]);
    expect(communityHasMention(rootOnly, byGroup, [meta('arbeitszimmer', 'root1')])).toBe(true);
    expect(communityHasMention(rootOnly, byGroup, [meta('arbeitszimmer', 'other')])).toBe(false);
    expect(communityHasMention(rootOnly, byGroup)).toBe(false);
  });
});
