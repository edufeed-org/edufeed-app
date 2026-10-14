/** @vitest-environment jsdom */
// Logged-in avatar menu: Meine Inhalte and Gruppen moved here from the phone
// dock, and the inbox entry links to the /c route (not the legacy redirect).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
const { active$, holders } = await vi.hoisted(async () => {
  const { BehaviorSubject } = await import('rxjs');
  return {
    active$: new BehaviorSubject(/** @type {any} */ (null)),
    holders: { groupsConfigEnabled: false, groupsSettingEnabled: false }
  };
});

vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active$ } }));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: { openModal: vi.fn() } }));
vi.mock('$lib/loaders/calendar.js', () => ({ prefetchCalendarData: vi.fn() }));
vi.mock('$lib/services/inbox-service.svelte.js', () => ({ getTotalUnreadCount: () => 0 }));
vi.mock('$lib/services/dm-service.svelte.js', () => ({ getUnreadDmCount: () => 0 }));
vi.mock('../shared/AccountMenuSection.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ConnectionStatus.svelte', () => ({ default: () => ({}) }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { help: { url: null }, cordnGroups: {} }
}));
vi.mock('$lib/cordn', () => ({
  parseCordnGroupsConfig: () => ({ enabled: holders.groupsConfigEnabled })
}));
vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: {
    get cordnGroupsEnabled() {
      return holders.groupsSettingEnabled;
    }
  }
}));

import MobileNavMenu from '../shared/MobileNavMenu.svelte';

describe('MobileNavMenu logged-in entries', () => {
  beforeEach(() => {
    active$.next({ pubkey: 'a'.repeat(64) });
    holders.groupsConfigEnabled = false;
    holders.groupsSettingEnabled = false;
  });

  it('links Meine Inhalte and the inbox under /c', async () => {
    const { findByTestId } = render(MobileNavMenu, { onClose: vi.fn() });
    expect((await findByTestId('menu-my-stuff')).getAttribute('href')).toBe('/c/?view=my-stuff');
    expect((await findByTestId('menu-inbox')).getAttribute('href')).toBe('/c/inbox');
  });

  it('shows Gruppen only when the deployment and the user enable it', async () => {
    const { queryByTestId, findByTestId, unmount } = render(MobileNavMenu, { onClose: vi.fn() });
    await findByTestId('menu-my-stuff');
    expect(queryByTestId('menu-groups')).toBeNull();
    unmount();
    holders.groupsConfigEnabled = true;
    holders.groupsSettingEnabled = true;
    const second = render(MobileNavMenu, { onClose: vi.fn() });
    expect((await second.findByTestId('menu-groups')).getAttribute('href')).toBe('/c/groups');
  });
});
