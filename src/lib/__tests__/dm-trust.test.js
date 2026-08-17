/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  getConversationPeers,
  classifyDmConversations,
  excludeMutedAuthors
} from '$lib/helpers/dm-trust.js';

const SELF = 'a'.repeat(64);
const FRIEND = 'b'.repeat(64);
const STRANGER = 'c'.repeat(64);
const SPAMMER = 'd'.repeat(64);
const PLATFORM = 'e'.repeat(64);

/** @param {string} peer @param {object} [overrides] */
function conv(peer, overrides = {}) {
  return {
    id: `${SELF}:${peer}`,
    participants: [SELF, peer],
    lastMessage: { pubkey: peer, created_at: 1000 },
    ...overrides
  };
}

const emptyOpts = () => ({
  selfPubkey: SELF,
  follows: new Set(),
  mutedPubkeys: new Set(),
  outboundPeers: new Set(),
  trustedSenders: new Set()
});

describe('getConversationPeers', () => {
  it('returns the other participant', () => {
    expect(getConversationPeers([SELF, FRIEND], SELF)).toEqual([FRIEND]);
  });

  it('returns empty for a note-to-self conversation', () => {
    expect(getConversationPeers([SELF], SELF)).toEqual([]);
  });

  it('returns all non-self participants for group conversations', () => {
    expect(getConversationPeers([SELF, FRIEND, STRANGER], SELF)).toEqual([FRIEND, STRANGER]);
  });
});

describe('classifyDmConversations', () => {
  it('puts conversations with followed peers in known', () => {
    const opts = { ...emptyOpts(), follows: new Set([FRIEND]) };
    const { known, requests } = classifyDmConversations([conv(FRIEND), conv(STRANGER)], opts);
    expect(known.map((c) => c.id)).toEqual([conv(FRIEND).id]);
    expect(requests.map((c) => c.id)).toEqual([conv(STRANGER).id]);
  });

  it('puts conversations the user has replied to in known', () => {
    const opts = { ...emptyOpts(), outboundPeers: new Set([STRANGER]) };
    const { known, requests } = classifyDmConversations([conv(STRANGER)], opts);
    expect(known).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });

  it('treats note-to-self as known', () => {
    const selfConv = { id: SELF, participants: [SELF], lastMessage: { created_at: 1 } };
    const { known, requests } = classifyDmConversations([selfConv], emptyOpts());
    expect(known).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });

  it('treats deployment-trusted senders as known', () => {
    const opts = { ...emptyOpts(), trustedSenders: new Set([PLATFORM]) };
    const { known } = classifyDmConversations([conv(PLATFORM)], opts);
    expect(known).toHaveLength(1);
  });

  it('drops conversations whose peers are all muted', () => {
    const opts = { ...emptyOpts(), mutedPubkeys: new Set([SPAMMER]) };
    const { known, requests } = classifyDmConversations([conv(SPAMMER)], opts);
    expect(known).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it('mute wins over follow', () => {
    const opts = {
      ...emptyOpts(),
      follows: new Set([SPAMMER]),
      mutedPubkeys: new Set([SPAMMER])
    };
    const { known, requests } = classifyDmConversations([conv(SPAMMER)], opts);
    expect(known).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it('keeps a group conversation when at least one peer is unmuted and known', () => {
    const opts = {
      ...emptyOpts(),
      follows: new Set([FRIEND]),
      mutedPubkeys: new Set([SPAMMER])
    };
    const group = {
      id: 'group',
      participants: [SELF, FRIEND, SPAMMER],
      lastMessage: { created_at: 1 }
    };
    const { known } = classifyDmConversations([group], opts);
    expect(known).toHaveLength(1);
  });

  it('defaults unknown strangers to requests', () => {
    const { known, requests } = classifyDmConversations([conv(STRANGER)], emptyOpts());
    expect(known).toHaveLength(0);
    expect(requests).toHaveLength(1);
  });

  it('preserves input order within each bucket', () => {
    const opts = { ...emptyOpts(), follows: new Set([FRIEND, PLATFORM]) };
    const a = conv(FRIEND);
    const b = conv(PLATFORM, { id: 'second' });
    const { known } = classifyDmConversations([a, b], opts);
    expect(known.map((c) => c.id)).toEqual([a.id, 'second']);
  });
});

describe('excludeMutedAuthors', () => {
  const events = [
    { id: '1', pubkey: FRIEND },
    { id: '2', pubkey: SPAMMER },
    { id: '3', pubkey: STRANGER }
  ];

  it('drops events authored by muted pubkeys', () => {
    const result = excludeMutedAuthors(events, new Set([SPAMMER]));
    expect(result.map((e) => e.id)).toEqual(['1', '3']);
  });

  it('returns the same array when nothing is muted', () => {
    expect(excludeMutedAuthors(events, new Set())).toBe(events);
  });
});
