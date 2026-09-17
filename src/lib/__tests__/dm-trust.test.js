/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  getConversationPeers,
  classifyDmConversations,
  excludeMutedAuthors,
  matchesMutedWord,
  foldConfusables,
  excludeMuted
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

  it('drops a stranger conversation whose last message matches a muted word', () => {
    const opts = { ...emptyOpts(), mutedWords: new Set(['botrift']) };
    const spam = conv(SPAMMER, {
      lastMessage: { pubkey: SPAMMER, created_at: 1000, content: 'Get Verified on Nostr @ Botrift' }
    });
    const { known, requests } = classifyDmConversations([spam], opts);
    expect(known).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it('keeps a known conversation whose last message matches a muted word', () => {
    const opts = {
      ...emptyOpts(),
      follows: new Set([FRIEND]),
      mutedWords: new Set(['botrift'])
    };
    const chat = conv(FRIEND, {
      lastMessage: { pubkey: FRIEND, created_at: 1000, content: 'did you see the botrift spam?' }
    });
    const { known, requests } = classifyDmConversations([chat], opts);
    expect(known).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });

  it('keeps a stranger conversation whose last message is not decrypted yet', () => {
    const opts = { ...emptyOpts(), mutedWords: new Set(['botrift']) };
    const locked = conv(STRANGER, { lastMessage: { pubkey: STRANGER, created_at: 1000 } });
    const { requests } = classifyDmConversations([locked], opts);
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

describe('matchesMutedWord', () => {
  const words = new Set(['damus airdrop', 'damuspurple']);

  it('matches case-insensitively as a substring', () => {
    expect(matchesMutedWord('✨ Claim your tokens — Damus Airdrop is live!', words)).toBe(true);
    expect(matchesMutedWord('visit https://DAMUSPURPLE.xyz/airdrop/', words)).toBe(true);
  });

  it('does not match unrelated content', () => {
    expect(matchesMutedWord('Willkommen auf edufeed.org!', words)).toBe(false);
  });

  it('handles empty word set and missing content', () => {
    expect(matchesMutedWord('anything', new Set())).toBe(false);
    expect(matchesMutedWord(undefined, words)).toBe(false);
  });

  // The 2026-09-11 campaign spelled the brand with Unicode small capitals
  // (U+1D00 A, U+1D0D M, U+1D1C U) to slip past the plain substring filter.
  it('matches through small-capital homoglyphs (the real 2026-09-11 spam)', () => {
    const spam =
      '🔔 Claim window is open. Dᴀᴍᴜs Airdrop is open. https://damusmainnet.xyz/check/ Final';
    expect(matchesMutedWord(spam, words)).toBe(true);
  });

  it('matches through fullwidth and mathematical-alphanumeric letters', () => {
    expect(matchesMutedWord('Ｄａｍｕｓ Ａｉｒｄｒｏｐ', words)).toBe(true);
    expect(matchesMutedWord('𝐃𝐚𝐦𝐮𝐬 𝐀𝐢𝐫𝐝𝐫𝐨𝐩 today', words)).toBe(true);
    expect(matchesMutedWord('𝓓𝓪𝓶𝓾𝓼 𝓐𝓲𝓻𝓭𝓻𝓸𝓹', words)).toBe(true);
  });

  it('matches through Cyrillic/Greek lookalike letters', () => {
    // Cyrillic а (U+0430), о (U+043E), р (U+0440), Greek ο (U+03BF)
    expect(matchesMutedWord('Dаmus Airdrοp is live', words)).toBe(true);
  });

  it('ignores zero-width characters and soft hyphens inside the word', () => {
    expect(matchesMutedWord('Da\u200Bmus\u00AD Air\u200Ddrop', words)).toBe(true);
  });

  it('folds the muted words themselves too', () => {
    const fancy = new Set(['dᴀᴍᴜs airdrop']);
    expect(matchesMutedWord('damus airdrop', fancy)).toBe(true);
  });

  it('does not over-match after folding', () => {
    expect(matchesMutedWord('ᴅᴀᴍᴘ ᴀɪʀ ᴅʀᴏᴘs on the window', words)).toBe(false);
  });
});

describe('foldConfusables', () => {
  it('lowercases, NFKC-normalizes and maps small caps to ASCII', () => {
    expect(foldConfusables('Dᴀᴍᴜs Ｆｉｎａｌ 𝐗')).toBe('damus final x');
  });

  it('strips zero-width and soft-hyphen characters', () => {
    expect(foldConfusables('a\u200Bb\u200Cc\u200Dd\uFEFFe\u00ADf')).toBe('abcdef');
  });

  it('leaves ordinary text (including umlauts) alone apart from lowercasing', () => {
    expect(foldConfusables('Willkommen auf edufeed.org, Größe 3€')).toBe(
      'willkommen auf edufeed.org, größe 3€'
    );
  });
});

describe('excludeMuted', () => {
  const events = [
    { id: '1', pubkey: FRIEND, content: 'hello there' },
    { id: '2', pubkey: SPAMMER, content: 'legit-looking text' },
    { id: '3', pubkey: STRANGER, content: 'Damus Airdrop season 1 is LIVE' },
    { id: '4', pubkey: STRANGER, content: 'a normal mention' }
  ];

  it('drops muted authors and word-matching content', () => {
    const result = excludeMuted(events, new Set([SPAMMER]), new Set(['damus airdrop']));
    expect(result.map((e) => e.id)).toEqual(['1', '4']);
  });

  it('returns the same array when nothing is muted', () => {
    expect(excludeMuted(events, new Set(), new Set())).toBe(events);
  });

  it('works with words only', () => {
    const result = excludeMuted(events, new Set(), new Set(['airdrop']));
    expect(result.map((e) => e.id)).toEqual(['1', '2', '4']);
  });
});
