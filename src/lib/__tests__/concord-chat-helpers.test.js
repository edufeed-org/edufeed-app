/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getConcordReplyParentId, aggregateChannelReactions } from '$lib/concord/chat-helpers.js';

describe('getConcordReplyParentId', () => {
  it('returns the q-tag value (NIP-C7 chat reply)', () => {
    const message = {
      tags: [
        ['p', 'a'.repeat(64)],
        ['q', 'parent-id', 'wss://relay.example.com/', 'b'.repeat(64)]
      ]
    };
    expect(getConcordReplyParentId(message)).toBe('parent-id');
  });

  it('returns the FIRST q tag when a malformed rumor repeats it', () => {
    const message = {
      tags: [
        ['q', 'first-parent'],
        ['q', 'second-parent']
      ]
    };
    expect(getConcordReplyParentId(message)).toBe('first-parent');
  });

  it('returns null when there is no q tag (a NIP-10 marked e tag is NOT a concord reply)', () => {
    const message = {
      tags: [['e', 'some-id', 'wss://relay.example.com/', 'reply']]
    };
    expect(getConcordReplyParentId(message)).toBeNull();
  });

  it('returns null for empty tags, missing tags, and empty q value', () => {
    expect(getConcordReplyParentId({ tags: [] })).toBeNull();
    expect(getConcordReplyParentId({})).toBeNull();
    expect(getConcordReplyParentId({ tags: [['q']] })).toBeNull();
    expect(getConcordReplyParentId({ tags: [['q', '']] })).toBeNull();
  });
});

describe('aggregateChannelReactions', () => {
  const AUTHOR_A = 'a'.repeat(64);
  const AUTHOR_B = 'b'.repeat(64);

  /** @param {string} target @param {string} content @param {string} [pubkey] */
  const reaction = (target, content, pubkey = AUTHOR_A) => ({
    content,
    tags: [['e', target]],
    pubkey
  });

  it('counts multiple emojis per target', () => {
    const result = aggregateChannelReactions([
      reaction('msg-1', '👍'),
      reaction('msg-1', '👍', AUTHOR_B),
      reaction('msg-1', '❤️')
    ]);
    expect(result.get('msg-1')?.get('👍')?.count).toBe(2);
    expect(result.get('msg-1')?.get('❤️')?.count).toBe(1);
  });

  it('keeps targets separate', () => {
    const result = aggregateChannelReactions([
      reaction('msg-1', '👍'),
      reaction('msg-2', '👍'),
      reaction('msg-2', '🎉')
    ]);
    expect(result.get('msg-1')?.size).toBe(1);
    expect(result.get('msg-2')?.size).toBe(2);
    expect(result.get('msg-2')?.get('🎉')?.count).toBe(1);
  });

  it('skips reactions without an e tag', () => {
    const result = aggregateChannelReactions([
      { content: '👍', tags: [['p', 'a'.repeat(64)]] },
      { content: '👍', tags: [] },
      { content: '👍' },
      reaction('msg-1', '👍')
    ]);
    expect(result.size).toBe(1);
    expect(result.get('msg-1')?.get('👍')?.count).toBe(1);
  });

  it('defaults empty content to 👍 (NIP-25 "+"-style likes stay distinct)', () => {
    const result = aggregateChannelReactions([
      reaction('msg-1', ''),
      reaction('msg-1', '👍', AUTHOR_B),
      reaction('msg-1', '+')
    ]);
    // '' falls back to 👍 and merges with the explicit 👍; '+' stays its own key
    expect(result.get('msg-1')?.get('👍')?.count).toBe(2);
    expect(result.get('msg-1')?.get('+')?.count).toBe(1);
  });

  it('returns an empty map for an empty input', () => {
    expect(aggregateChannelReactions([]).size).toBe(0);
  });

  it('uses the FIRST e tag as the target when repeated', () => {
    const result = aggregateChannelReactions([
      {
        content: '👍',
        pubkey: AUTHOR_A,
        tags: [
          ['e', 'msg-1'],
          ['e', 'msg-2']
        ]
      }
    ]);
    expect(result.get('msg-1')?.get('👍')?.count).toBe(1);
    expect(result.has('msg-2')).toBe(false);
  });

  it('marks userReacted and collects reactors for the current user pubkey', () => {
    const result = aggregateChannelReactions(
      [reaction('msg-1', '👍', AUTHOR_A), reaction('msg-1', '👍', AUTHOR_B)],
      AUTHOR_B
    );
    const summary = result.get('msg-1')?.get('👍');
    expect(summary?.userReacted).toBe(true);
    expect(summary?.reactors).toEqual([AUTHOR_A, AUTHOR_B]);
  });

  it('does not mark userReacted when currentUserPubkey is undefined', () => {
    const result = aggregateChannelReactions([reaction('msg-1', '👍', AUTHOR_A)]);
    expect(result.get('msg-1')?.get('👍')?.userReacted).toBe(false);
  });

  it("leaves userReactionEvent null even for the current user's own reaction (no retract support yet)", () => {
    const result = aggregateChannelReactions([reaction('msg-1', '👍', AUTHOR_A)], AUTHOR_A);
    expect(result.get('msg-1')?.get('👍')?.userReactionEvent).toBeNull();
  });

  it('resolves a NIP-30 custom-emoji URL from the emoji tag', () => {
    const customReaction = {
      content: ':zap:',
      pubkey: AUTHOR_A,
      tags: [
        ['e', 'msg-1'],
        ['emoji', 'zap', 'https://example.com/zap.png']
      ]
    };
    const result = aggregateChannelReactions([customReaction]);
    expect(result.get('msg-1')?.get(':zap:')?.emojiUrl).toBe('https://example.com/zap.png');
  });
});
