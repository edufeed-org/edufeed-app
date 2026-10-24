/**
 * Calendar Management Store Tests
 *
 * Tests the Loader+Model pattern for calendar management:
 * - Model's next handler sets loading=false (race condition fix)
 * - TimelineModel provides reactive data with auto-deletion filtering
 * - Safety timeout prevents infinite loading
 * - ActionRunner-based CRUD for add/remove calendar events
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock data ---

const MOCK_PUBKEY = 'abc123pubkey';

/** @type {any[]} */
const mockCalendarEvents = [
  {
    id: 'evt1',
    pubkey: MOCK_PUBKEY,
    kind: 31924,
    content: 'My work calendar',
    created_at: 1700000000,
    tags: [
      ['d', 'work-cal'],
      ['title', 'Work Calendar'],
      ['a', '31922:abc:meeting1']
    ]
  },
  {
    id: 'evt2',
    pubkey: MOCK_PUBKEY,
    kind: 31924,
    content: '',
    created_at: 1700001000,
    tags: [
      ['d', 'personal-cal'],
      ['title', 'Personal Calendar']
    ]
  }
];

// --- Subscription capture helpers ---

/** @type {{ complete?: Function, error?: Function, next?: Function } | null} */
let capturedLoaderHandler = null;
/** @type {{ complete?: Function, error?: Function, next?: Function } | null} */
let capturedModelHandler = null;

const loaderUnsub = vi.fn();
const deletionUnsub = vi.fn();
const modelUnsub = vi.fn();

// --- Mocks ---

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: vi.fn(() => {
      const obs = {
        pipe: vi.fn(() => obs),
        subscribe: vi.fn((/** @type {any} */ handler) => {
          capturedModelHandler = handler;
          return { unsubscribe: modelUnsub };
        })
      };
      return obs;
    }),
    add: vi.fn()
  }
}));

vi.mock('$lib/loaders/calendar.js', () => ({
  userCalendarLoader: vi.fn(() => ({
    subscribe: vi.fn((/** @type {any} */ handler) => {
      capturedLoaderHandler = handler;
      return { unsubscribe: loaderUnsub };
    })
  }))
}));

vi.mock('$lib/loaders/base.js', () => ({
  fetchUserDeletions: vi.fn(() => ({
    subscribe: vi.fn(() => ({ unsubscribe: deletionUnsub }))
  }))
}));

vi.mock('applesauce-core/models', () => ({
  TimelineModel: class TimelineModel {}
}));

vi.mock('applesauce-common/helpers', () => ({
  getCalendarEventTitle: (/** @type {any} */ event) =>
    event?.tags?.find((/** @type {any[]} */ t) => t[0] === 'title')?.[1] || null
}));

vi.mock('applesauce-core/helpers', () => ({
  getTagValue: (/** @type {any} */ event, /** @type {string} */ name) =>
    event?.tags?.find((/** @type {any[]} */ t) => t[0] === name)?.[1] || undefined
}));

const mockActionRunnerRun = vi.fn();
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunner: {
    run: (/** @type {any[]} */ ...args) => mockActionRunnerRun(...args)
  }
}));

vi.mock('applesauce-actions/actions', () => ({
  AddEventToCalendar: vi.fn(),
  RemoveEventFromCalendar: vi.fn()
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: null, active$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) } }
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: vi.fn()
}));

// Mock rxjs debounceTime to be a passthrough
vi.mock('rxjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    .../** @type {object} */ (actual),
    debounceTime: () => (/** @type {any} */ source) => source
  };
});

// --- Import after mocks ---

const { createCalendarManagementStore, useCalendarManagement, cleanupCalendarManagementStores } =
  await import('../stores/calendar-management-store.svelte.js');
const { eventStore } = await import('../stores/nostr-infrastructure.svelte');
const { userCalendarLoader } = await import('../loaders/calendar.js');
const { fetchUserDeletions } = await import('../loaders/base.js');
const { AddEventToCalendar, RemoveEventFromCalendar } = await import('applesauce-actions/actions');

describe('createCalendarManagementStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    capturedLoaderHandler = null;
    capturedModelHandler = null;
    cleanupCalendarManagementStores();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes with loading=true and empty calendars', () => {
    const store = createCalendarManagementStore(MOCK_PUBKEY);

    expect(store.loading).toBe(true);
    expect(store.calendars).toEqual([]);
    expect(store.error).toBe(null);

    store.destroy();
  });

  it('creates loader with correct pubkey', () => {
    const store = createCalendarManagementStore(MOCK_PUBKEY);

    expect(userCalendarLoader).toHaveBeenCalledWith(MOCK_PUBKEY);
    expect(fetchUserDeletions).toHaveBeenCalledWith(MOCK_PUBKEY);

    store.destroy();
  });

  it('subscribes to TimelineModel with correct filter', () => {
    const store = createCalendarManagementStore(MOCK_PUBKEY);

    expect(eventStore.model).toHaveBeenCalledWith(expect.any(Function), {
      kinds: [31924],
      authors: [MOCK_PUBKEY]
    });

    store.destroy();
  });

  it('sets loading=false when loader completes', () => {
    const store = createCalendarManagementStore(MOCK_PUBKEY);

    expect(store.loading).toBe(true);

    // Simulate loader completion (EOSE received from all relays)
    capturedLoaderHandler?.complete?.();

    expect(store.loading).toBe(false);

    store.destroy();
  });

  it('sets loading=false when model emits events (before loader completes)', () => {
    const store = createCalendarManagementStore(MOCK_PUBKEY);

    expect(store.loading).toBe(true);

    // Model emits before loader completes — race condition fix
    capturedModelHandler?.next?.(mockCalendarEvents);

    expect(store.loading).toBe(false);
    expect(store.calendars).toHaveLength(2);

    store.destroy();
  });

  it('handles empty results — loading becomes false, calendars stays empty', () => {
    const store = createCalendarManagementStore(MOCK_PUBKEY);

    // Loader completes without emitting any events
    capturedLoaderHandler?.complete?.();

    // Model emits empty array
    capturedModelHandler?.next?.([]);

    expect(store.loading).toBe(false);
    expect(store.calendars).toEqual([]);
    expect(store.error).toBe(null);

    store.destroy();
  });

  it('maps TimelineModel events to Calendar objects with originalEvent', () => {
    const store = createCalendarManagementStore(MOCK_PUBKEY);

    // Simulate model emission
    capturedModelHandler?.next?.(mockCalendarEvents);

    expect(store.calendars).toHaveLength(2);
    expect(store.calendars[0]).toEqual({
      id: 'evt1',
      pubkey: MOCK_PUBKEY,
      kind: 31924,
      title: 'Work Calendar',
      description: 'My work calendar',
      dTag: 'work-cal',
      eventReferences: ['31922:abc:meeting1'],
      createdAt: 1700000000,
      originalEvent: mockCalendarEvents[0]
    });
    expect(store.calendars[1]).toEqual({
      id: 'evt2',
      pubkey: MOCK_PUBKEY,
      kind: 31924,
      title: 'Personal Calendar',
      description: '',
      dTag: 'personal-cal',
      eventReferences: [],
      createdAt: 1700001000,
      originalEvent: mockCalendarEvents[1]
    });

    store.destroy();
  });

  it('handles null/undefined model emission gracefully', () => {
    const store = createCalendarManagementStore(MOCK_PUBKEY);

    capturedModelHandler?.next?.(null);
    expect(store.calendars).toEqual([]);

    capturedModelHandler?.next?.(undefined);
    expect(store.calendars).toEqual([]);

    store.destroy();
  });

  it('sets error and loading=false on loader error', () => {
    const store = createCalendarManagementStore(MOCK_PUBKEY);

    capturedLoaderHandler?.error?.(new Error('Network timeout'));

    expect(store.loading).toBe(false);
    expect(store.error).toBe('Network timeout');

    store.destroy();
  });

  it('safety timeout sets loading=false after 5 seconds', () => {
    const store = createCalendarManagementStore(MOCK_PUBKEY);

    expect(store.loading).toBe(true);

    // Advance past safety timeout
    vi.advanceTimersByTime(5_000);

    expect(store.loading).toBe(false);

    store.destroy();
  });

  it('refresh clears calendars and re-initializes', async () => {
    const store = createCalendarManagementStore(MOCK_PUBKEY);

    // Populate initial data
    capturedModelHandler?.next?.(mockCalendarEvents);
    capturedLoaderHandler?.complete?.();
    expect(store.calendars).toHaveLength(2);
    expect(store.loading).toBe(false);

    // Refresh
    await store.refresh();

    // Should clear and re-initialize
    expect(store.calendars).toEqual([]);
    expect(store.loading).toBe(true);

    // Loaders should be called again
    expect(userCalendarLoader).toHaveBeenCalledTimes(2);
    expect(fetchUserDeletions).toHaveBeenCalledTimes(2);

    store.destroy();
  });

  it('destroy unsubscribes all subscriptions', () => {
    const store = createCalendarManagementStore(MOCK_PUBKEY);

    store.destroy();

    expect(loaderUnsub).toHaveBeenCalled();
    expect(deletionUnsub).toHaveBeenCalled();
    expect(modelUnsub).toHaveBeenCalled();
  });
});

describe('addEventToCalendar / removeEventFromCalendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    capturedLoaderHandler = null;
    capturedModelHandler = null;
    cleanupCalendarManagementStores();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('addEventToCalendar delegates to ActionRunner with correct arguments', async () => {
    mockActionRunnerRun.mockResolvedValue(undefined);
    const store = createCalendarManagementStore(MOCK_PUBKEY);
    capturedModelHandler?.next?.(mockCalendarEvents);

    const mockEvent = { id: 'ce1', kind: 31923, pubkey: 'p1', tags: [['d', 'ev1']] };
    const result = await store.addEventToCalendar('evt1', mockEvent);

    expect(result).toBe(true);
    expect(mockActionRunnerRun).toHaveBeenCalledWith(
      AddEventToCalendar,
      mockCalendarEvents[0], // originalEvent
      mockEvent
    );

    store.destroy();
  });

  it('removeEventFromCalendar delegates to ActionRunner with correct arguments', async () => {
    mockActionRunnerRun.mockResolvedValue(undefined);
    const store = createCalendarManagementStore(MOCK_PUBKEY);
    capturedModelHandler?.next?.(mockCalendarEvents);

    const mockEvent = { id: 'ce1', kind: 31923, pubkey: 'p1', tags: [['d', 'ev1']] };
    const result = await store.removeEventFromCalendar('evt1', mockEvent);

    expect(result).toBe(true);
    expect(mockActionRunnerRun).toHaveBeenCalledWith(
      RemoveEventFromCalendar,
      mockCalendarEvents[0],
      mockEvent
    );

    store.destroy();
  });

  it('addEventToCalendar returns false and sets error when calendar not found', async () => {
    const store = createCalendarManagementStore(MOCK_PUBKEY);
    capturedModelHandler?.next?.(mockCalendarEvents);

    const result = await store.addEventToCalendar('nonexistent', { kind: 31923 });

    expect(result).toBe(false);
    expect(store.error).toBe('Calendar not found');

    store.destroy();
  });

  it('addEventToCalendar returns false and sets error on ActionRunner failure', async () => {
    mockActionRunnerRun.mockRejectedValue(new Error('Publish failed'));
    const store = createCalendarManagementStore(MOCK_PUBKEY);
    capturedModelHandler?.next?.(mockCalendarEvents);

    const result = await store.addEventToCalendar('evt1', { kind: 31923 });

    expect(result).toBe(false);
    expect(store.error).toBe('Publish failed');

    store.destroy();
  });
});

describe('useCalendarManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    capturedLoaderHandler = null;
    capturedModelHandler = null;
    cleanupCalendarManagementStores();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns same store instance for same pubkey', () => {
    const store1 = useCalendarManagement(MOCK_PUBKEY);
    const store2 = useCalendarManagement(MOCK_PUBKEY);

    expect(store1).toBe(store2);

    // Only one store should have been created
    expect(userCalendarLoader).toHaveBeenCalledTimes(1);

    store1.destroy();
  });

  it('returns different store instances for different pubkeys', () => {
    const store1 = useCalendarManagement('pubkey1');
    const store2 = useCalendarManagement('pubkey2');

    expect(store1).not.toBe(store2);
    expect(userCalendarLoader).toHaveBeenCalledTimes(2);

    store1.destroy();
    store2.destroy();
  });
});

describe('cleanupCalendarManagementStores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    capturedLoaderHandler = null;
    capturedModelHandler = null;
    cleanupCalendarManagementStores();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('destroys all stores and clears cache', () => {
    const store1 = useCalendarManagement('pubkey1');
    useCalendarManagement('pubkey2');

    cleanupCalendarManagementStores();

    // After cleanup, creating a new store for same pubkey should be a new instance
    const store3 = useCalendarManagement('pubkey1');
    expect(store3).not.toBe(store1);
  });
});
