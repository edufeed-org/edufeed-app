// @ts-nocheck
/**
 * Unit tests for reaction helper functions
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => {
  /** @type {{ active: any }} */
  const mockManager = { active: null };
  /** @type {{ value: any }} */
  const mockSignArgRef = { value: null };
  const mockSign = vi.fn(async (/** @type {any} */ draft) => {
    mockSignArgRef.value = draft;
    return { ...draft, id: 'signed-event-id', sig: 'mock-sig', pubkey: 'mock-pubkey' };
  });
  const mockPublishEventOptimistic = vi.fn();
  const mockGetCommunikeyRelays = vi.fn(() => ['wss://default-relay.example']);
  return {
    mockManager,
    mockSignArgRef,
    mockSign,
    mockPublishEventOptimistic,
    mockGetCommunikeyRelays
  };
});

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: vi.fn(() => ({
    sign: hoisted.mockSign
  }))
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: (
    /** @type {any} */ event,
    /** @type {any} */ taggedPubkeys,
    /** @type {any} */ opts
  ) => hoisted.mockPublishEventOptimistic(event, taggedPubkeys, opts)
}));

vi.mock('$lib/stores/accounts.svelte.js', () => ({
  manager: hoisted.mockManager
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => hoisted.mockGetCommunikeyRelays()
}));

import {
  aggregateReactions,
  getCustomEmojiUrl,
  normalizeReactionContent,
  publishReactionForUrl
} from '$lib/helpers/reactions.js';

describe('getCustomEmojiUrl', () => {
  it('returns URL for valid custom emoji reaction', () => {
    const event = {
      content: ':zap:',
      tags: [
        ['e', 'target-event-id'],
        ['emoji', 'zap', 'https://example.com/zap.png']
      ]
    };
    expect(getCustomEmojiUrl(event)).toBe('https://example.com/zap.png');
  });

  it('returns URL with whitespace-trimmed content', () => {
    const event = {
      content: '  :soapbox:  ',
      tags: [['emoji', 'soapbox', 'https://example.com/soapbox.gif']]
    };
    expect(getCustomEmojiUrl(event)).toBe('https://example.com/soapbox.gif');
  });

  it('returns null for standard unicode emoji', () => {
    const event = {
      content: '❤️',
      tags: [['e', 'target-event-id']]
    };
    expect(getCustomEmojiUrl(event)).toBeNull();
  });

  it('returns null for + reaction', () => {
    const event = {
      content: '+',
      tags: [['e', 'target-event-id']]
    };
    expect(getCustomEmojiUrl(event)).toBeNull();
  });

  it('returns null for - reaction', () => {
    const event = {
      content: '-',
      tags: [['e', 'target-event-id']]
    };
    expect(getCustomEmojiUrl(event)).toBeNull();
  });

  it('returns null when emoji tag is missing', () => {
    const event = {
      content: ':zap:',
      tags: [['e', 'target-event-id']]
    };
    expect(getCustomEmojiUrl(event)).toBeNull();
  });

  it('returns null when emoji tag shortcode does not match', () => {
    const event = {
      content: ':zap:',
      tags: [['emoji', 'other', 'https://example.com/other.png']]
    };
    expect(getCustomEmojiUrl(event)).toBeNull();
  });

  it('returns null for empty content', () => {
    const event = { content: '', tags: [] };
    expect(getCustomEmojiUrl(event)).toBeNull();
  });

  it('returns null for null/undefined content', () => {
    expect(getCustomEmojiUrl({ content: null, tags: [] })).toBeNull();
    expect(getCustomEmojiUrl({ content: undefined, tags: [] })).toBeNull();
  });

  it('returns null when emoji tag has no URL', () => {
    const event = {
      content: ':zap:',
      tags: [['emoji', 'zap']]
    };
    expect(getCustomEmojiUrl(event)).toBeNull();
  });

  it('handles shortcode with hyphens and underscores', () => {
    const event = {
      content: ':my-custom_emoji:',
      tags: [['emoji', 'my-custom_emoji', 'https://example.com/custom.png']]
    };
    expect(getCustomEmojiUrl(event)).toBe('https://example.com/custom.png');
  });
});

describe('aggregateReactions', () => {
  const ALICE = 'alice-pubkey';
  const BOB = 'bob-pubkey';
  const CAROL = 'carol-pubkey';

  it('returns empty Map for empty input', () => {
    const result = aggregateReactions([], ALICE);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('groups two reactions with the same emoji', () => {
    const events = [
      { id: 'e1', pubkey: ALICE, content: '🔥', tags: [] },
      { id: 'e2', pubkey: BOB, content: '🔥', tags: [] }
    ];
    const result = aggregateReactions(events, CAROL);
    expect(result.size).toBe(1);
    const summary = result.get('🔥');
    expect(summary.count).toBe(2);
    expect(summary.reactors).toEqual([ALICE, BOB]);
  });

  it('separates different emojis into different buckets', () => {
    const events = [
      { id: 'e1', pubkey: ALICE, content: '🔥', tags: [] },
      { id: 'e2', pubkey: BOB, content: '👍', tags: [] }
    ];
    const result = aggregateReactions(events, CAROL);
    expect(result.size).toBe(2);
    expect(result.get('🔥').count).toBe(1);
    expect(result.get('👍').count).toBe(1);
  });

  it('marks userReacted=true when current user pubkey matches', () => {
    const aliceReaction = { id: 'e1', pubkey: ALICE, content: '🔥', tags: [] };
    const events = [aliceReaction, { id: 'e2', pubkey: BOB, content: '🔥', tags: [] }];
    const result = aggregateReactions(events, ALICE);
    const summary = result.get('🔥');
    expect(summary.userReacted).toBe(true);
    expect(summary.userReactionEvent).toBe(aliceReaction);
  });

  it('marks userReacted=false when current user has not reacted', () => {
    const events = [{ id: 'e1', pubkey: ALICE, content: '🔥', tags: [] }];
    const result = aggregateReactions(events, BOB);
    const summary = result.get('🔥');
    expect(summary.userReacted).toBe(false);
    expect(summary.userReactionEvent).toBeNull();
  });

  it('treats undefined currentUserPubkey as no user reacted', () => {
    const events = [{ id: 'e1', pubkey: ALICE, content: '🔥', tags: [] }];
    const result = aggregateReactions(events, undefined);
    expect(result.get('🔥').userReacted).toBe(false);
  });

  it('normalizes + and empty content into the same ❤️ bucket', () => {
    const events = [
      { id: 'e1', pubkey: ALICE, content: '+', tags: [] },
      { id: 'e2', pubkey: BOB, content: '', tags: [] }
    ];
    const result = aggregateReactions(events, CAROL);
    expect(result.size).toBe(1);
    expect(result.get('❤️').count).toBe(2);
  });

  it('extracts emojiUrl from custom emoji reactions', () => {
    const events = [
      {
        id: 'e1',
        pubkey: ALICE,
        content: ':zap:',
        tags: [['emoji', 'zap', 'https://example.com/zap.png']]
      }
    ];
    const result = aggregateReactions(events, BOB);
    const summary = result.get(':zap:');
    expect(summary.emojiUrl).toBe('https://example.com/zap.png');
  });

  it('keeps emojiUrl from first event if later events lack tags', () => {
    const events = [
      {
        id: 'e1',
        pubkey: ALICE,
        content: ':zap:',
        tags: [['emoji', 'zap', 'https://example.com/zap.png']]
      },
      { id: 'e2', pubkey: BOB, content: ':zap:', tags: [] }
    ];
    const result = aggregateReactions(events, CAROL);
    expect(result.get(':zap:').emojiUrl).toBe('https://example.com/zap.png');
  });
});

describe('publishReactionForUrl', () => {
  beforeEach(() => {
    hoisted.mockSignArgRef.value = null;
    hoisted.mockSign.mockClear();
    hoisted.mockPublishEventOptimistic.mockClear();
    hoisted.mockGetCommunikeyRelays.mockClear();
    hoisted.mockManager.active = { signer: { signEvent: vi.fn() }, pubkey: 'mock-pubkey' };
  });

  it('throws when no signer is available', async () => {
    hoisted.mockManager.active = null;
    await expect(publishReactionForUrl('https://example.com', '🔥')).rejects.toThrow();
  });

  it('builds a kind 17 event with [i, url] and [k, web] tags', async () => {
    await publishReactionForUrl('https://example.com/article', '🔥');
    expect(hoisted.mockSign).toHaveBeenCalledTimes(1);
    expect(hoisted.mockSignArgRef.value.kind).toBe(17);
    expect(hoisted.mockSignArgRef.value.tags).toEqual(
      expect.arrayContaining([
        ['i', 'https://example.com/article'],
        ['k', 'web']
      ])
    );
  });

  it('uses the emoji as event content', async () => {
    await publishReactionForUrl('https://example.com/article', '🔥');
    expect(hoisted.mockSignArgRef.value.content).toBe('🔥');
  });

  it("defaults content to '+' when emoji is not provided", async () => {
    await publishReactionForUrl('https://example.com/article');
    expect(hoisted.mockSignArgRef.value.content).toBe('+');
  });

  it('publishes the signed event via publishEventOptimistic', async () => {
    await publishReactionForUrl('https://example.com/article', '🔥');
    expect(hoisted.mockPublishEventOptimistic).toHaveBeenCalledTimes(1);
    const [signedEvent, taggedPubkeys] = hoisted.mockPublishEventOptimistic.mock.calls[0];
    expect(signedEvent.id).toBe('signed-event-id');
    expect(taggedPubkeys).toEqual([]);
  });

  it('uses communikey relays by default', async () => {
    await publishReactionForUrl('https://example.com/article', '🔥');
    const [, , opts] = hoisted.mockPublishEventOptimistic.mock.calls[0];
    expect(opts.additionalRelays).toEqual(['wss://default-relay.example']);
  });

  it('passes through custom relays when provided', async () => {
    await publishReactionForUrl('https://example.com/article', '🔥', {
      relays: ['wss://custom.example']
    });
    const [, , opts] = hoisted.mockPublishEventOptimistic.mock.calls[0];
    expect(opts.additionalRelays).toEqual(['wss://custom.example']);
  });

  it('returns success and the signed event', async () => {
    const result = await publishReactionForUrl('https://example.com/article', '🔥');
    expect(result.success).toBe(true);
    expect(result.event.id).toBe('signed-event-id');
  });

  it('accepts a NIP-30 Emoji object and sets content to :shortcode:', async () => {
    await publishReactionForUrl('https://example.com/article', {
      shortcode: 'catclap_sm',
      url: 'https://example.com/catclap.gif'
    });
    expect(hoisted.mockSignArgRef.value.content).toBe(':catclap_sm:');
  });

  it('appends NIP-30 [emoji, shortcode, url] tag for custom emoji', async () => {
    await publishReactionForUrl('https://example.com/article', {
      shortcode: 'catclap_sm',
      url: 'https://example.com/catclap.gif'
    });
    expect(hoisted.mockSignArgRef.value.tags).toEqual(
      expect.arrayContaining([
        ['i', 'https://example.com/article'],
        ['k', 'web'],
        ['emoji', 'catclap_sm', 'https://example.com/catclap.gif']
      ])
    );
  });

  it('does not add an emoji tag for unicode/string reactions', async () => {
    await publishReactionForUrl('https://example.com/article', '🔥');
    const emojiTag = hoisted.mockSignArgRef.value.tags.find(
      (/** @type {string[]} */ t) => t[0] === 'emoji'
    );
    expect(emojiTag).toBeUndefined();
  });
});

describe('normalizeReactionContent', () => {
  it('converts + to ❤️', () => {
    expect(normalizeReactionContent('+')).toBe('❤️');
  });

  it('converts empty string to ❤️', () => {
    expect(normalizeReactionContent('')).toBe('❤️');
  });

  it('converts - to 👎', () => {
    expect(normalizeReactionContent('-')).toBe('👎');
  });

  it('preserves unicode emoji', () => {
    expect(normalizeReactionContent('🔥')).toBe('🔥');
  });

  it('preserves custom emoji shortcode', () => {
    expect(normalizeReactionContent(':zap:')).toBe(':zap:');
  });
});
