/** @vitest-environment node */
import { describe, test, expect } from 'vitest';
import {
  buildCommunityDefinitionTags,
  createDefaultContentTypes
} from '$lib/helpers/communityTagBuilder.js';

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

    test('emits form-marked a-tag with relay hint when formRef and formRefRelay are set', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: '30168:abc123:my-form',
            formRefRelay: 'wss://forms.example'
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, { communityPubkey });

      const formMarked = tags.filter((t) => t[0] === 'a' && t[3] === 'form');
      expect(formMarked).toHaveLength(1);
      expect(formMarked[0]).toEqual(['a', '30168:abc123:my-form', 'wss://forms.example', 'form']);
    });

    test('form-marked a-tag falls back to empty relay hint when formRefRelay is absent', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: '30168:abc123:my-form'
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, { communityPubkey });
      const formMarked = tags.filter((t) => t[0] === 'a' && t[3] === 'form');
      expect(formMarked).toHaveLength(1);
      expect(formMarked[0]).toEqual(['a', '30168:abc123:my-form', '', 'form']);
    });

    test('does not emit form-marked a-tag when formRef is empty', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: ''
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, { communityPubkey });
      const formMarked = tags.filter((t) => t[0] === 'a' && t[3] === 'form');
      expect(formMarked).toHaveLength(0);
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

      const profileListATags = tags.filter((t) => t[0] === 'a' && t[1]?.startsWith('30000:'));
      expect(profileListATags).toHaveLength(1);
      expect(profileListATags[0][1]).toBe(`30000:${communityPubkey}:Calendar`);
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

  describe('access tier emission', () => {
    /**
     * @param {{tier: 'all'}|{tier: 'members'}|{tier: 'role', role: string}|undefined} access
     */
    const data = (access) => ({
      relays: [],
      blossomServers: [],
      location: '',
      description: '',
      contentTypes: {
        learning: {
          name: 'Learning',
          enabled: true,
          badges: { read: null, write: null },
          relays: [],
          formRef: '',
          access
        }
      }
    });
    const PK = 'a'.repeat(64);

    test('emits ["access","members"] inside the section (new-spec only)', () => {
      const tags = buildCommunityDefinitionTags(data({ tier: 'members' }), { communityPubkey: PK });
      const ci = tags.findIndex((t) => t[0] === 'content' && t[1] === 'Learning');
      const section = tags.slice(ci + 1);
      expect(section).toContainEqual(['access', 'members']);
    });

    test('emits ["access","role",<name>]', () => {
      const tags = buildCommunityDefinitionTags(data({ tier: 'role', role: 'lehrkraft' }), {
        communityPubkey: PK
      });
      expect(tags).toContainEqual(['access', 'role', 'lehrkraft']);
    });

    test('emits nothing for tier "all", missing access, or old-spec mode', () => {
      const all = buildCommunityDefinitionTags(data({ tier: 'all' }), { communityPubkey: PK });
      expect(all.some((t) => t[0] === 'access')).toBe(false);
      const missing = buildCommunityDefinitionTags(data(undefined), { communityPubkey: PK });
      expect(missing.some((t) => t[0] === 'access')).toBe(false);
      const oldSpec = buildCommunityDefinitionTags(data({ tier: 'members' }), {});
      expect(oldSpec.some((t) => t[0] === 'access')).toBe(false);
    });

    test('createDefaultContentTypes seeds access tier "all"', () => {
      const cts = createDefaultContentTypes(['learning']);
      expect(cts.learning.access).toEqual({ tier: 'all' });
    });

    test('never emits access role tags with empty/missing role (fail open)', () => {
      // Deliberately off-type: role missing on purpose to exercise fail-open
      // behavior. Cast at the fixture rather than widening the production type.
      const missingRole = buildCommunityDefinitionTags(
        data(/** @type {any} */ ({ tier: 'role' })),
        { communityPubkey: PK }
      );
      expect(missingRole.some((t) => t[0] === 'access')).toBe(false);

      const emptyRole = buildCommunityDefinitionTags(data({ tier: 'role', role: '  ' }), {
        communityPubkey: PK
      });
      expect(emptyRole.some((t) => t[0] === 'access')).toBe(false);
    });
  });
});
