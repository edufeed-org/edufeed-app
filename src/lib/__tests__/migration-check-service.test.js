/**
 * Migration Check Service Tests
 *
 * Tests the extracted logic functions directly rather than the full async orchestration.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Observable } from 'rxjs';

// --- Mock state ---
/** @type {any} */
let mockFlagEvent = null;
/** @type {any[]} */
let mockOldEvents = [];
/** @type {any} */
let mockFollowSetEvent = null;
/** @type {any[]} */
let actionRunnerCalls = [];
/** @type {any[]} */
let openModalCalls = [];

// --- Mocks ---
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active$: {
      subscribe: vi.fn((_cb) => {
        return { unsubscribe: vi.fn() };
      })
    }
  }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {
    request: vi.fn(() => {
      return new Observable((sub) => {
        for (const e of mockOldEvents) sub.next(e);
        sub.complete();
      });
    })
  },
  eventStore: {
    replaceable: vi.fn((kind, _pubkey, _identifier) => {
      return new Observable((sub) => {
        if (kind === 30078) sub.next(mockFlagEvent);
        else if (kind === 30000) sub.next(mockFollowSetEvent);
        sub.complete();
      });
    })
  }
}));

vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunner: {
    run: vi.fn((...args) => {
      actionRunnerCalls.push(args);
      return Promise.resolve();
    })
  }
}));

vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: {
    openModal: vi.fn((...args) => {
      openModalCalls.push(args);
    })
  }
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  configReady: {
    subscribe: vi.fn((cb) => {
      cb(true);
      return vi.fn();
    })
  },
  runtimeConfig: { appName: 'ComCal' }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: vi.fn(() => ['wss://communikey.relay']),
  getAllLookupRelays: vi.fn(() => ['wss://lookup.relay'])
}));

vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getWriteRelays: vi.fn(() => Promise.resolve([]))
}));

vi.mock('applesauce-core/helpers', () => ({
  getTagValue: vi.fn((/** @type {any} */ event, /** @type {string} */ tagName) => {
    return event.tags?.find((/** @type {string[]} */ t) => t[0] === tagName)?.[1];
  })
}));

vi.mock('applesauce-common/helpers', () => ({
  getProfilePointersFromList: vi.fn((/** @type {any} */ event) => {
    if (!event) return [];
    return event.tags
      .filter((/** @type {string[]} */ t) => t[0] === 'p')
      .map((/** @type {string[]} */ t) => ({ pubkey: t[1], relays: t[2] ? [t[2]] : [] }));
  })
}));

vi.mock('applesauce-actions/actions', () => ({
  UpdateAppData: 'UpdateAppData'
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: vi.fn(() => {
    return new Observable((sub) => {
      sub.complete();
    });
  })
}));

import {
  getMigrationIdentifier,
  isMigrationDone,
  getUnmigratedCommunities,
  writeMigrationFlag
} from '../services/migration-check-service.svelte.js';

describe('getMigrationIdentifier', () => {
  it('uses appName from config', () => {
    expect(getMigrationIdentifier()).toBe('ComCal/community-migration-v1');
  });
});

describe('isMigrationDone', () => {
  beforeEach(() => {
    mockFlagEvent = null;
  });

  it('returns false when no flag event exists', async () => {
    mockFlagEvent = null;
    expect(await isMigrationDone('abc123')).toBe(false);
  });

  it('returns true when flag event has content "done"', async () => {
    mockFlagEvent = {
      kind: 30078,
      content: '"done"',
      tags: [['d', 'ComCal/community-migration-v1']]
    };
    expect(await isMigrationDone('abc123')).toBe(true);
  });

  it('returns false when flag event has different content', async () => {
    mockFlagEvent = {
      kind: 30078,
      content: '"other"',
      tags: [['d', 'ComCal/community-migration-v1']]
    };
    expect(await isMigrationDone('abc123')).toBe(false);
  });
});

describe('getUnmigratedCommunities', () => {
  beforeEach(() => {
    mockOldEvents = [];
    mockFollowSetEvent = null;
  });

  it('returns empty when no old 30382 events exist', async () => {
    mockOldEvents = [];
    const result = await getUnmigratedCommunities('abc123');
    expect(result).toEqual([]);
  });

  it('returns community pubkeys from follow events', async () => {
    mockOldEvents = [
      {
        kind: 30382,
        tags: [
          ['d', 'community1'],
          ['n', 'follow']
        ],
        pubkey: 'abc123'
      },
      {
        kind: 30382,
        tags: [
          ['d', 'community2'],
          ['n', 'follow']
        ],
        pubkey: 'abc123'
      }
    ];
    mockFollowSetEvent = null;

    const result = await getUnmigratedCommunities('abc123');
    expect(result).toEqual(['community1', 'community2']);
  });

  it('excludes events with n-tag=unfollow', async () => {
    mockOldEvents = [
      {
        kind: 30382,
        tags: [
          ['d', 'community1'],
          ['n', 'follow']
        ],
        pubkey: 'abc123'
      },
      {
        kind: 30382,
        tags: [
          ['d', 'community2'],
          ['n', 'unfollow']
        ],
        pubkey: 'abc123'
      }
    ];
    mockFollowSetEvent = null;

    const result = await getUnmigratedCommunities('abc123');
    expect(result).toEqual(['community1']);
  });

  it('excludes already-joined communities', async () => {
    mockOldEvents = [
      {
        kind: 30382,
        tags: [
          ['d', 'community1'],
          ['n', 'follow']
        ],
        pubkey: 'abc123'
      },
      {
        kind: 30382,
        tags: [
          ['d', 'community2'],
          ['n', 'follow']
        ],
        pubkey: 'abc123'
      },
      {
        kind: 30382,
        tags: [
          ['d', 'community3'],
          ['n', 'follow']
        ],
        pubkey: 'abc123'
      }
    ];
    mockFollowSetEvent = {
      kind: 30000,
      tags: [
        ['d', 'communities'],
        ['p', 'community1']
      ],
      pubkey: 'abc123'
    };

    const result = await getUnmigratedCommunities('abc123');
    expect(result).toEqual(['community2', 'community3']);
  });

  it('returns empty when all old communities are already joined', async () => {
    mockOldEvents = [
      {
        kind: 30382,
        tags: [
          ['d', 'community1'],
          ['n', 'follow']
        ],
        pubkey: 'abc123'
      },
      {
        kind: 30382,
        tags: [
          ['d', 'community2'],
          ['n', 'follow']
        ],
        pubkey: 'abc123'
      }
    ];
    mockFollowSetEvent = {
      kind: 30000,
      tags: [
        ['d', 'communities'],
        ['p', 'community1'],
        ['p', 'community2']
      ],
      pubkey: 'abc123'
    };

    const result = await getUnmigratedCommunities('abc123');
    expect(result).toEqual([]);
  });

  it('deduplicates community pubkeys', async () => {
    mockOldEvents = [
      {
        kind: 30382,
        tags: [
          ['d', 'community1'],
          ['n', 'follow']
        ],
        pubkey: 'abc123'
      },
      {
        kind: 30382,
        tags: [
          ['d', 'community1'],
          ['n', 'follow']
        ],
        pubkey: 'abc123'
      }
    ];
    mockFollowSetEvent = null;

    const result = await getUnmigratedCommunities('abc123');
    expect(result).toEqual(['community1']);
  });
});

describe('writeMigrationFlag', () => {
  beforeEach(() => {
    actionRunnerCalls = [];
  });

  it('calls actionRunner with UpdateAppData and correct identifier', async () => {
    await writeMigrationFlag();
    expect(actionRunnerCalls).toHaveLength(1);
    expect(actionRunnerCalls[0][0]).toBe('UpdateAppData');
    expect(actionRunnerCalls[0][1]).toBe('ComCal/community-migration-v1');
    expect(actionRunnerCalls[0][2]).toBe('done');
  });
});
