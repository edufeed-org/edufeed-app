/**
 * Community Tag Builder Tests
 *
 * Tests buildCommunityDefinitionTags — the shared tag builder for
 * CreateCommunityModal and EditCommunityModal.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { buildCommunityDefinitionTags } from '../helpers/communityTagBuilder.js';

/** Helper to build minimal form data
 * @param {Partial<import('../helpers/communityTagBuilder.js').CommunityFormData>} [overrides]
 * @returns {import('../helpers/communityTagBuilder.js').CommunityFormData}
 */
function makeFormData(overrides = {}) {
  return /** @type {any} */ ({
    relays: ['wss://relay.example.com'],
    blossomServers: [],
    location: '',
    description: '',
    languages: [],
    contentTypes: {
      calendar: {
        name: 'Calendar',
        enabled: false,
        badges: { read: null, write: null },
        relays: []
      },
      chat: { name: 'Chat', enabled: false, badges: { read: null, write: null }, relays: [] },
      articles: {
        name: 'Articles',
        enabled: false,
        badges: { read: null, write: null },
        relays: []
      },
      posts: { name: 'Posts', enabled: false, badges: { read: null, write: null }, relays: [] },
      wikis: { name: 'Wikis', enabled: false, badges: { read: null, write: null }, relays: [] }
    },
    ...overrides
  });
}

// ─── OLD-SPEC BEHAVIOR (backward compat, no communityPubkey) ─────────────────

describe('buildCommunityDefinitionTags — old-spec (no communityPubkey)', () => {
  it('writes global relays as ["r", url]', () => {
    const data = makeFormData({ relays: ['wss://r1.example.com', 'wss://r2.example.com'] });
    const tags = buildCommunityDefinitionTags(data);
    expect(tags).toContainEqual(['r', 'wss://r1.example.com']);
    expect(tags).toContainEqual(['r', 'wss://r2.example.com']);
  });

  it('writes blossom servers as ["blossom", url]', () => {
    const data = makeFormData({ blossomServers: ['https://blossom.example.com'] });
    const tags = buildCommunityDefinitionTags(data);
    expect(tags).toContainEqual(['blossom', 'https://blossom.example.com']);
  });

  it('writes enabled content types with content + k tags', () => {
    const data = makeFormData();
    data.contentTypes.calendar.enabled = true;
    const tags = buildCommunityDefinitionTags(data);
    expect(tags).toContainEqual(['content', 'Calendar']);
    expect(tags).toContainEqual(['k', '31922']);
    expect(tags).toContainEqual(['k', '31923']);
  });

  it('omits disabled content types', () => {
    const data = makeFormData();
    // all disabled by default
    const tags = buildCommunityDefinitionTags(data);
    const contentTags = tags.filter((t) => t[0] === 'content');
    expect(contentTags).toHaveLength(0);
  });

  it('writes badge a-tags with write/read qualifiers', () => {
    const data = makeFormData();
    data.contentTypes.chat.enabled = true;
    data.contentTypes.chat.badges.write = '30009:pub:writer';
    data.contentTypes.chat.badges.read = '30009:pub:reader';
    const tags = buildCommunityDefinitionTags(data);
    expect(tags).toContainEqual(['a', '30009:pub:writer', 'write']);
    expect(tags).toContainEqual(['a', '30009:pub:reader', 'read']);
  });

  it('writes per-section relays as ["r", url, "content"]', () => {
    const data = makeFormData();
    data.contentTypes.articles.enabled = true;
    data.contentTypes.articles.relays = ['wss://articles.relay'];
    const tags = buildCommunityDefinitionTags(data);
    expect(tags).toContainEqual(['r', 'wss://articles.relay', 'content']);
  });

  it('writes optional location', () => {
    const data = makeFormData({ location: 'Berlin, Germany' });
    const tags = buildCommunityDefinitionTags(data);
    expect(tags).toContainEqual(['location', 'Berlin, Germany']);
  });

  it('omits empty location', () => {
    const data = makeFormData({ location: '  ' });
    const tags = buildCommunityDefinitionTags(data);
    expect(tags.find((t) => t[0] === 'location')).toBeUndefined();
  });

  it('writes optional description', () => {
    const data = makeFormData({ description: 'A cool community' });
    const tags = buildCommunityDefinitionTags(data);
    expect(tags).toContainEqual(['description', 'A cool community']);
  });

  it('omits empty description', () => {
    const data = makeFormData({ description: '' });
    const tags = buildCommunityDefinitionTags(data);
    expect(tags.find((t) => t[0] === 'description')).toBeUndefined();
  });

  it('produces correct kinds for all content types', () => {
    const data = makeFormData();
    data.contentTypes.calendar.enabled = true;
    data.contentTypes.chat.enabled = true;
    data.contentTypes.articles.enabled = true;
    data.contentTypes.posts.enabled = true;
    data.contentTypes.wikis.enabled = true;
    const tags = buildCommunityDefinitionTags(data);

    // Calendar: 31922, 31923
    expect(tags).toContainEqual(['k', '31922']);
    expect(tags).toContainEqual(['k', '31923']);
    // Chat: 9
    expect(tags).toContainEqual(['k', '9']);
    // Articles: 30023
    expect(tags).toContainEqual(['k', '30023']);
    // Posts: 1, 11
    expect(tags).toContainEqual(['k', '1']);
    expect(tags).toContainEqual(['k', '11']);
    // Wikis: 30818
    expect(tags).toContainEqual(['k', '30818']);
  });

  it('preserves tag ordering: globals before content sections', () => {
    const data = makeFormData({
      relays: ['wss://relay.example.com'],
      blossomServers: ['https://blossom.example.com'],
      location: 'Berlin'
    });
    data.contentTypes.chat.enabled = true;
    const tags = buildCommunityDefinitionTags(data);

    const relayIdx = tags.findIndex((t) => t[0] === 'r' && t[1] === 'wss://relay.example.com');
    const contentIdx = tags.findIndex((t) => t[0] === 'content');
    expect(relayIdx).toBeLessThan(contentIdx);
  });
});

// ─── NEW-SPEC BEHAVIOR (with communityPubkey) ────────────────────────────────

describe('buildCommunityDefinitionTags — new-spec (with communityPubkey)', () => {
  const opts = { communityPubkey: 'abc123' };

  it('writes profile list a-tags instead of badge a-tags', () => {
    const data = makeFormData();
    data.contentTypes.calendar.enabled = true;
    const tags = buildCommunityDefinitionTags(data, opts);

    // Should have profile list reference
    expect(tags).toContainEqual(['a', '30000:abc123:Calendar']);
    // Should NOT have any 30009 badge tags
    const badgeTags = tags.filter((t) => t[0] === 'a' && t[1]?.startsWith('30009:'));
    expect(badgeTags).toHaveLength(0);
  });

  it('does not write per-section relay tags', () => {
    const data = makeFormData();
    data.contentTypes.articles.enabled = true;
    data.contentTypes.articles.relays = ['wss://articles.relay'];
    const tags = buildCommunityDefinitionTags(data, opts);

    const sectionRelays = tags.filter((t) => t[0] === 'r' && t[2] === 'content');
    expect(sectionRelays).toHaveLength(0);
  });

  it('writes enforced relays as ["r", url, "enforced"]', () => {
    const data = makeFormData({
      relays: [
        { url: 'wss://open.relay', enforced: false },
        { url: 'wss://enforced.relay', enforced: true }
      ]
    });
    data.contentTypes.chat.enabled = true;
    const tags = buildCommunityDefinitionTags(data, opts);

    expect(tags).toContainEqual(['r', 'wss://open.relay']);
    expect(tags).toContainEqual(['r', 'wss://enforced.relay', 'enforced']);
  });

  it('writes languages as ["l", langCode, "ISO-639-1"]', () => {
    const data = makeFormData({ languages: ['en', 'de'] });
    data.contentTypes.chat.enabled = true;
    const tags = buildCommunityDefinitionTags(data, opts);

    expect(tags).toContainEqual(['l', 'en', 'ISO-639-1']);
    expect(tags).toContainEqual(['l', 'de', 'ISO-639-1']);
  });

  it('profile list a-tag uses section name from contentType', () => {
    const data = makeFormData();
    data.contentTypes.posts.enabled = true;
    data.contentTypes.wikis.enabled = true;
    const tags = buildCommunityDefinitionTags(data, opts);

    expect(tags).toContainEqual(['a', '30000:abc123:Posts']);
    expect(tags).toContainEqual(['a', '30000:abc123:Wikis']);
  });

  it('ignores badge data even if provided', () => {
    const data = makeFormData();
    data.contentTypes.chat.enabled = true;
    data.contentTypes.chat.badges.write = '30009:pub:writer';
    const tags = buildCommunityDefinitionTags(data, opts);

    const badgeTags = tags.filter((t) => t[0] === 'a' && t[1]?.startsWith('30009:'));
    expect(badgeTags).toHaveLength(0);
  });
});

// ─── BACKWARD COMPAT (old-spec with badges preserved) ────────────────────────

describe('buildCommunityDefinitionTags — backward compat', () => {
  it('without communityPubkey preserves badge a-tags', () => {
    const data = makeFormData();
    data.contentTypes.calendar.enabled = true;
    data.contentTypes.calendar.badges.write = '30009:pub:cal-writer';
    const tags = buildCommunityDefinitionTags(data);

    expect(tags).toContainEqual(['a', '30009:pub:cal-writer', 'write']);
    // Should NOT have profile list tags
    const profileTags = tags.filter((t) => t[0] === 'a' && t[1]?.startsWith('30000:'));
    expect(profileTags).toHaveLength(0);
  });
});

// ─── RELAY FORMAT HANDLING ───────────────────────────────────────────────────

describe('buildCommunityDefinitionTags — relay format handling', () => {
  it('handles string[] relays (old format)', () => {
    const data = makeFormData({ relays: ['wss://r1.example.com'] });
    const tags = buildCommunityDefinitionTags(data);
    expect(tags).toContainEqual(['r', 'wss://r1.example.com']);
  });

  it('handles {url, enforced}[] relays (new format)', () => {
    const data = makeFormData({
      relays: [{ url: 'wss://r1.example.com', enforced: false }]
    });
    const tags = buildCommunityDefinitionTags(data);
    expect(tags).toContainEqual(['r', 'wss://r1.example.com']);
  });

  it('enforced flag only written when communityPubkey provided', () => {
    const data = makeFormData({
      relays: [{ url: 'wss://enforced.relay', enforced: true }]
    });
    // Old-spec: enforced flag ignored
    const tagsOld = buildCommunityDefinitionTags(data);
    expect(tagsOld).toContainEqual(['r', 'wss://enforced.relay']);
    expect(tagsOld).not.toContainEqual(['r', 'wss://enforced.relay', 'enforced']);

    // New-spec: enforced flag written
    const tagsNew = buildCommunityDefinitionTags(data, { communityPubkey: 'abc' });
    expect(tagsNew).toContainEqual(['r', 'wss://enforced.relay', 'enforced']);
  });
});
