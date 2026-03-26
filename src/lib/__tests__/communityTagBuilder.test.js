/** @vitest-environment node */
import { describe, test, expect } from 'vitest';
import { buildCommunityDefinitionTags } from '$lib/helpers/communityTagBuilder.js';

describe('buildCommunityDefinitionTags', () => {
  const baseCommunityData = {
    relays: ['wss://relay.example.com'],
    blossomServers: [],
    location: '',
    description: '',
    contentTypes: {
      calendar: {
        name: 'Calendar',
        enabled: true,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      },
      chat: {
        name: 'Chat',
        enabled: true,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      }
    }
  };

  describe('new-spec mode (communityPubkey set)', () => {
    const communityPubkey = 'abc123';

    test('emits profile list a-tag when formRef is set', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: '30168:abc123:my-form'
          },
          chat: {
            name: 'Chat',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: ''
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, { communityPubkey });

      // Calendar has formRef → should get profile list a-tag
      const calendarATags = tags.filter(
        (t) => t[0] === 'a' && t[1] === `30000:${communityPubkey}:Calendar`
      );
      expect(calendarATags).toHaveLength(1);
    });

    test('omits profile list a-tag when formRef is empty', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: ''
          },
          chat: {
            name: 'Chat',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: ''
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, { communityPubkey });

      // No formRef → no profile list a-tags
      const aTags = tags.filter((t) => t[0] === 'a');
      expect(aTags).toHaveLength(0);
    });

    test('omits profile list a-tag when formRef is null/undefined', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: []
            // formRef not set at all
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, { communityPubkey });

      const aTags = tags.filter((t) => t[0] === 'a');
      expect(aTags).toHaveLength(0);
    });

    test('emits profile list a-tag only for sections with formRef', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: '30168:abc123:apply-form'
          },
          chat: {
            name: 'Chat',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: ''
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, { communityPubkey });

      const aTags = tags.filter((t) => t[0] === 'a');
      expect(aTags).toHaveLength(1);
      expect(aTags[0][1]).toBe(`30000:${communityPubkey}:Calendar`);
    });
  });

  describe('old-spec mode (no communityPubkey)', () => {
    test('emits badge a-tags for old-spec communities', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: '30009:issuer:read-badge', write: '30009:issuer:write-badge' },
            relays: ['wss://content-relay.example.com'],
            formRef: ''
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, {});

      // Old-spec: badge a-tags with read/write qualifiers
      const aTags = tags.filter((t) => t[0] === 'a');
      expect(aTags).toHaveLength(2);
      expect(aTags).toContainEqual(['a', '30009:issuer:write-badge', 'write']);
      expect(aTags).toContainEqual(['a', '30009:issuer:read-badge', 'read']);
    });

    test('emits per-section relays in old-spec mode', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: ['wss://content-relay.example.com'],
            formRef: ''
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, {});

      const rTags = tags.filter((t) => t[0] === 'r' && t[2] === 'content');
      expect(rTags).toHaveLength(1);
      expect(rTags[0][1]).toBe('wss://content-relay.example.com');
    });
  });
});
