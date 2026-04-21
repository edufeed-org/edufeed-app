/**
 * Unit tests for reaction helper functions
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: vi.fn(() => ({}))
}));

import { getCustomEmojiUrl, normalizeReactionContent } from '$lib/helpers/reactions.js';

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
