// Shared mocks for the TermiChatWindow component tests. Import it FIRST in a
// window test file; each file gets its own copy (vitest isolates files), so a
// file sets `termiEnv` once at the top or per test.
//
// Also mocks the lazily imported history store: the real one pulls the publish
// stack in, and that import used to resolve after a test file had torn down.
import { vi } from 'vitest';

/** A store that records nothing; history tests replace it with spies. */
export const emptyHistoryStore = () => ({
  list: [],
  current: null,
  refresh: async () => {},
  open: async () => null,
  startNew: () => {},
  record: () => {},
  remove: async () => {},
  dispose: () => {}
});

export const termiEnv = {
  config: /** @type {Record<string, any>} */ ({
    membership: { enabled: false, handleDomain: 'edufeed.org' },
    help: { url: '/wiki/edufeed-erste-schritte' },
    termi: { enabled: true, embed: true, llm: true },
    discover: { contentTypes: ['events', 'learning', 'articles'] }
  }),
  /** @type {any} */
  user: null,
  /** Replace with a reactive getter to drive account switches through effects. */
  getUser: () => termiEnv.user,
  runCreateAction: vi.fn(() => true),
  goto: vi.fn(),
  history: {
    /** @type {(opts: { scope: string, sync: any }) => any} */
    createConversationStore: () => emptyHistoryStore(),
    /** @type {(opts: any) => any} */
    createRelaySync: () => ({})
  }
};

vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: termiEnv.config }));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => termiEnv.getUser() }));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({ useUserProfile: () => () => null }));
vi.mock('$lib/helpers/run-create-action.js', () => ({
  runCreateAction: (/** @type {any[]} */ ...a) => termiEnv.runCreateAction(...a)
}));
vi.mock('$app/navigation', () => ({
  goto: (/** @type {any[]} */ ...a) => termiEnv.goto(...a)
}));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('../history/conversation-store.svelte.js', () => ({
  createConversationStore: (/** @type {any} */ opts) =>
    termiEnv.history.createConversationStore(opts),
  createRelaySync: (/** @type {any} */ opts) => termiEnv.history.createRelaySync(opts)
}));

export const windowProps = () => ({
  onToggleExpand: () => {},
  onClose: () => {},
  hints: [],
  openCount: 0,
  runHint: vi.fn(),
  customizeHint: vi.fn(),
  dismissHint: vi.fn()
});
