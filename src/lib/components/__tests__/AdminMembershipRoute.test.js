/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

const ADMIN_PUBKEY = 'a'.repeat(64);
const NON_ADMIN_PUBKEY = 'b'.repeat(64);
const FORM_ADDRESS = `30168:${ADMIN_PUBKEY}:edufeed-membership`;

const formTemplateEvent = {
  kind: 30168,
  pubkey: ADMIN_PUBKEY,
  created_at: 1,
  id: 'form-id',
  sig: 'sig',
  content: '',
  tags: [
    ['d', 'edufeed-membership'],
    ['name', 'Edufeed.org-Mitgliedschaftsantrag']
  ]
};

const accountState = { pubkey: ADMIN_PUBKEY };

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return {
        enabled: true,
        handleDomain: 'edufeed.org',
        formAddress: FORM_ADDRESS,
        adminPubkeys: [ADMIN_PUBKEY]
      };
    }
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    get active() {
      return accountState.pubkey ? { pubkey: accountState.pubkey, signer: {} } : null;
    },
    // RxJS-like observable: emit synchronously on subscribe to mirror applesauce.
    active$: {
      subscribe(/** @type {(a: any) => void} */ cb) {
        cb(accountState.pubkey ? { pubkey: accountState.pubkey, signer: {} } : null);
        return { unsubscribe: () => {} };
      }
    }
  }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: () => {},
    replaceable: () => ({
      subscribe(/** @type {(e: any) => void} */ cb) {
        cb(formTemplateEvent);
        return { unsubscribe: () => {} };
      }
    }),
    model: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
    timeline: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
  },
  pool: {}
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
  timedPool: () => ({})
}));

vi.mock('$lib/loaders/community.js', () => ({
  formResponseLoader: () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getFallbackRelays: () => [],
  getCalendarRelays: () => [],
  getCommunikeyRelays: () => [],
  getEducationalRelays: () => [],
  getArticleRelays: () => [],
  getKanbanRelays: () => [],
  getAllLookupRelays: () => [],
  getEventLoaderLookupRelays: () => [],
  getProfileLookupRelays: () => []
}));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunner: { run: vi.fn() }
}));

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({ build: vi.fn(), sign: vi.fn() })
}));

vi.mock('$lib/helpers/communityRelays.js', () => ({
  parseCommunityContentTypes: () => []
}));

vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return { page: readable({ url: new URL('http://localhost/admin/membership') }) };
});

import AdminMembershipPage from '../../../routes/admin/membership/+page.svelte';

describe('/admin/membership route', () => {
  beforeEach(() => {
    accountState.pubkey = ADMIN_PUBKEY;
  });

  it('renders FormResponses when active user is in adminPubkeys', () => {
    const { getByRole } = render(AdminMembershipPage);
    expect(
      getByRole('heading', { name: /Mitgliedschaftsanträge|Membership applications/i, level: 1 })
    ).toBeTruthy();
  });

  it('shows access denied when active user is NOT in adminPubkeys', () => {
    accountState.pubkey = NON_ADMIN_PUBKEY;
    const { getByText } = render(AdminMembershipPage);
    expect(getByText(/Nicht berechtigt|Not authorized|access denied/i)).toBeTruthy();
  });

  it('shows login prompt when no user is active', () => {
    accountState.pubkey = '';
    const { getByText } = render(AdminMembershipPage);
    expect(getByText(/anmelden|sign in|login/i)).toBeTruthy();
  });
});
