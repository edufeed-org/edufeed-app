/**
 * WoT (Web of Trust) Content Filtering Tests
 *
 * Tests the WoT extension to the curated authors service:
 * - WoT initialization (anchor pubkeys + kind 3 follow extraction)
 * - Union of curated + WoT authors in getCuratedAuthors()
 * - User follows inclusion/exclusion
 * - Reset behavior
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { of, EMPTY } from 'rxjs';

// Mock dependencies
vi.mock('nostr-tools', () => ({
  nip19: {
    decode: vi.fn()
  }
}));

const mockPoolRequest = vi.fn();

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { request: mockPoolRequest },
  eventStore: { add: vi.fn() }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: vi.fn(() => ['wss://relay.example.com']),
  getEventLoaderLookupRelays: () => []
}));

vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  kindToAppRelayCategory: vi.fn((/** @type {number} */ kind) => {
    if ([31922, 31923, 31924, 31925].includes(kind)) return 'calendar';
    if ([10222, 30222].includes(kind)) return 'communikey';
    if ([30142].includes(kind)) return 'educational';
    if ([30023].includes(kind)) return 'longform';
    if ([30301, 30302, 8571].includes(kind)) return 'kanban';
    return null;
  })
}));

describe('WoT content filtering', () => {
  const anchorPubkey = 'a'.repeat(64);
  const followPubkey1 = 'b'.repeat(64);
  const followPubkey2 = 'c'.repeat(64);
  const curatedPubkey = 'd'.repeat(64);

  /** Helper to create a kind 3 contact list event
   * @param {string} pubkey
   * @param {string[]} follows
   */
  function makeKind3Event(pubkey, follows) {
    return {
      kind: 3,
      pubkey,
      tags: follows.map((/** @type {string} */ f) => ['p', f]),
      created_at: Math.floor(Date.now() / 1000)
    };
  }

  describe('initializeWotAuthors', () => {
    it('should fetch kind 3 for anchors and cache their follows', async () => {
      vi.resetModules();
      mockPoolRequest.mockReturnValue(
        of(makeKind3Event(anchorPubkey, [followPubkey1, followPubkey2]))
      );
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: true,
            includeUserFollows: false,
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            educational: { anchors: [anchorPubkey] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      await service.initializeWotAuthors('educational');

      const authors = service.getCuratedAuthors('educational');
      expect(authors).toContain(anchorPubkey);
      expect(authors).toContain(followPubkey1);
      expect(authors).toContain(followPubkey2);
      expect(authors).toHaveLength(3);
    });

    it('should be a no-op when WoT is disabled', async () => {
      vi.resetModules();
      mockPoolRequest.mockClear();
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: false,
            includeUserFollows: false,
            educational: { anchors: [anchorPubkey] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      await service.initializeWotAuthors('educational');

      expect(service.getCuratedAuthors('educational')).toBeNull();
      expect(mockPoolRequest).not.toHaveBeenCalled();
    });

    it('should be a no-op when category has no anchors', async () => {
      vi.resetModules();
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: true,
            includeUserFollows: false,
            educational: { anchors: [] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      await service.initializeWotAuthors('educational');

      expect(service.getCuratedAuthors('educational')).toBeNull();
    });

    it('should not re-initialize if already initialized', async () => {
      vi.resetModules();
      let callCount = 0;
      mockPoolRequest.mockImplementation(() => {
        callCount++;
        return of(makeKind3Event(anchorPubkey, [followPubkey1]));
      });
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: true,
            includeUserFollows: false,
            educational: { anchors: [anchorPubkey] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      await service.initializeWotAuthors('educational');
      const firstCallCount = callCount;

      await service.initializeWotAuthors('educational');
      expect(callCount).toBe(firstCallCount); // No additional calls
    });

    it('should handle network errors gracefully', async () => {
      vi.resetModules();
      mockPoolRequest.mockReturnValue(EMPTY);
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: true,
            includeUserFollows: false,
            educational: { anchors: [anchorPubkey] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      // Should not throw
      await service.initializeWotAuthors('educational');

      // Anchor is still included even with no follows returned
      const authors = service.getCuratedAuthors('educational');
      expect(authors).toEqual([anchorPubkey]);
    });

    it('should support npub-encoded anchor pubkeys', async () => {
      vi.resetModules();
      const { nip19 } = await import('nostr-tools');
      /** @type {any} */ (nip19.decode).mockReturnValue({
        type: 'npub',
        data: anchorPubkey
      });
      mockPoolRequest.mockReturnValue(of(makeKind3Event(anchorPubkey, [followPubkey1])));
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: true,
            includeUserFollows: false,
            educational: { anchors: ['npub1test'] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      await service.initializeWotAuthors('educational');

      const authors = service.getCuratedAuthors('educational');
      expect(authors).toContain(anchorPubkey);
      expect(authors).toContain(followPubkey1);
    });
  });

  describe('getCuratedAuthors with WoT union', () => {
    it('should union curated + WoT authors', async () => {
      vi.resetModules();
      mockPoolRequest.mockReturnValue(of(makeKind3Event(anchorPubkey, [followPubkey1])));
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [curatedPubkey] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: true,
            includeUserFollows: false,
            educational: { anchors: [anchorPubkey] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      await service.initializeWotAuthors('educational');

      const authors = service.getCuratedAuthors('educational');
      expect(authors).toContain(curatedPubkey);
      expect(authors).toContain(anchorPubkey);
      expect(authors).toContain(followPubkey1);
    });

    it('should deduplicate overlapping curated and WoT pubkeys', async () => {
      vi.resetModules();
      // Anchor follows include the curated pubkey (overlap)
      mockPoolRequest.mockReturnValue(
        of(makeKind3Event(anchorPubkey, [curatedPubkey, followPubkey1]))
      );
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [curatedPubkey] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: true,
            includeUserFollows: false,
            educational: { anchors: [anchorPubkey] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      await service.initializeWotAuthors('educational');

      const authors = service.getCuratedAuthors('educational');
      // curatedPubkey should appear only once
      expect(authors?.filter((p) => p === curatedPubkey)).toHaveLength(1);
      expect(authors).toHaveLength(3); // curatedPubkey, anchorPubkey, followPubkey1
    });

    it('should return null when neither curated nor WoT is configured', async () => {
      vi.resetModules();
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: false,
            includeUserFollows: false,
            educational: { anchors: [] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      expect(service.getCuratedAuthors('educational')).toBeNull();
    });
  });

  describe('user follows', () => {
    it('should include user follows when includeUserFollows is true', async () => {
      vi.resetModules();
      const userFollow1 = 'e'.repeat(64);
      const userFollow2 = 'f'.repeat(64);
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [curatedPubkey] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: true,
            includeUserFollows: true,
            educational: { anchors: [] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      service.setUserFollows([userFollow1, userFollow2]);

      const authors = service.getCuratedAuthors('educational');
      expect(authors).toContain(curatedPubkey);
      expect(authors).toContain(userFollow1);
      expect(authors).toContain(userFollow2);
    });

    it('should NOT include user follows when includeUserFollows is false', async () => {
      vi.resetModules();
      const userFollow1 = 'e'.repeat(64);
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [curatedPubkey] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: true,
            includeUserFollows: false,
            educational: { anchors: [] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      service.setUserFollows([userFollow1]);

      const authors = service.getCuratedAuthors('educational');
      expect(authors).toEqual([curatedPubkey]);
      expect(authors).not.toContain(userFollow1);
    });

    it('should clear user follows on logout', async () => {
      vi.resetModules();
      const userFollow1 = 'e'.repeat(64);
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [curatedPubkey] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: true,
            includeUserFollows: true,
            educational: { anchors: [] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      service.setUserFollows([userFollow1]);
      expect(service.getCuratedAuthors('educational')).toContain(userFollow1);

      service.clearUserFollows();
      const authors = service.getCuratedAuthors('educational');
      expect(authors).toEqual([curatedPubkey]);
      expect(authors).not.toContain(userFollow1);
    });

    it('should return null when user follows are the only source and empty', async () => {
      vi.resetModules();
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: true,
            includeUserFollows: true,
            educational: { anchors: [] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      // No user follows set
      expect(service.getCuratedAuthors('educational')).toBeNull();
    });
  });

  describe('_resetForTesting with WoT', () => {
    it('should clear WoT cache for specific category', async () => {
      vi.resetModules();
      mockPoolRequest.mockReturnValue(of(makeKind3Event(anchorPubkey, [followPubkey1])));
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: true,
            includeUserFollows: false,
            educational: { anchors: [anchorPubkey] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      await service.initializeWotAuthors('educational');
      expect(service.getCuratedAuthors('educational')).not.toBeNull();

      service._resetForTesting('educational');
      // After reset, WoT cache is cleared but can re-initialize
      // getCuratedAuthors returns null because wotAuthorsCache was cleared
      // and direct pubkeys re-initialize from (empty) config
      expect(service.getCuratedAuthors('educational')).toBeNull();
    });

    it('should clear all WoT state and user follows on full reset', async () => {
      vi.resetModules();
      mockPoolRequest.mockReturnValue(of(makeKind3Event(anchorPubkey, [followPubkey1])));
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: true,
            includeUserFollows: true,
            educational: { anchors: [anchorPubkey] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      await service.initializeWotAuthors('educational');
      service.setUserFollows(['e'.repeat(64)]);
      expect(service.getCuratedAuthors('educational')).not.toBeNull();

      service._resetForTesting();
      expect(service.getCuratedAuthors('educational')).toBeNull();
    });
  });

  describe('active user pubkey', () => {
    const activeUser = 'aa'.repeat(32);

    it('should include active user pubkey in getCuratedAuthors when curated filtering is active', async () => {
      vi.resetModules();
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [curatedPubkey] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: false,
            includeUserFollows: false,
            educational: { anchors: [] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      service.setActiveUserPubkey(activeUser);

      const authors = service.getCuratedAuthors('educational');
      expect(authors).toContain(curatedPubkey);
      expect(authors).toContain(activeUser);
    });

    it('should NOT return active user pubkey when no curated config exists (null case preserved)', async () => {
      vi.resetModules();
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: false,
            includeUserFollows: false,
            educational: { anchors: [] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      // No active user set, no curated config — should still be null
      expect(service.getCuratedAuthors('educational')).toBeNull();
    });

    it('should remove active user from set after clearActiveUserPubkey', async () => {
      vi.resetModules();
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [curatedPubkey] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: false,
            includeUserFollows: false,
            educational: { anchors: [] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      service.setActiveUserPubkey(activeUser);
      expect(service.getCuratedAuthors('educational')).toContain(activeUser);

      service.clearActiveUserPubkey();
      const authors = service.getCuratedAuthors('educational');
      expect(authors).toEqual([curatedPubkey]);
      expect(authors).not.toContain(activeUser);
    });

    it('should include active user even when includeUserFollows is false', async () => {
      vi.resetModules();
      const userFollow = 'e'.repeat(64);
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [curatedPubkey] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: true,
            includeUserFollows: false,
            educational: { anchors: [] },
            calendar: { anchors: [] },
            communikey: { anchors: [] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      service.setActiveUserPubkey(activeUser);
      service.setUserFollows([userFollow]);

      const authors = service.getCuratedAuthors('educational');
      // Active user is included unconditionally
      expect(authors).toContain(activeUser);
      // User follows are NOT included (includeUserFollows is false)
      expect(authors).not.toContain(userFollow);
    });
  });

  describe('initializeAllWotAuthors', () => {
    it('should initialize all categories in parallel', async () => {
      vi.resetModules();
      mockPoolRequest.mockReturnValue(of(makeKind3Event(anchorPubkey, [followPubkey1])));
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: true,
            includeUserFollows: false,
            calendar: { anchors: [anchorPubkey] },
            communikey: { anchors: [] },
            educational: { anchors: [anchorPubkey] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      await service.initializeAllWotAuthors();

      expect(service.getCuratedAuthors('calendar')).toContain(anchorPubkey);
      expect(service.getCuratedAuthors('educational')).toContain(anchorPubkey);
      expect(service.getCuratedAuthors('communikey')).toBeNull();
    });

    it('should be a no-op when WoT is globally disabled', async () => {
      vi.resetModules();
      mockPoolRequest.mockClear();
      vi.doMock('$lib/stores/config.svelte.js', () => ({
        runtimeConfig: {
          curatedMode: {
            calendar: { sets: [], direct: [] },
            communikey: { sets: [], direct: [] },
            educational: { sets: [], direct: [] },
            longform: { sets: [], direct: [] },
            kanban: { sets: [], direct: [] }
          },
          wotMode: {
            enabled: false,
            includeUserFollows: false,
            calendar: { anchors: [anchorPubkey] },
            communikey: { anchors: [] },
            educational: { anchors: [anchorPubkey] },
            longform: { anchors: [] },
            kanban: { anchors: [] }
          }
        }
      }));

      const service = await import('../services/curated-authors-service.svelte.js');
      await service.initializeAllWotAuthors();

      expect(mockPoolRequest).not.toHaveBeenCalled();
    });
  });
});
