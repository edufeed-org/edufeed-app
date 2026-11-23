/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

const ME = 'a'.repeat(64);
const RELAY = 'wss://groups.example/';
const state = vi.hoisted(() => ({ participants: /** @type {string[]} */ ([]) }));

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/paraglide/messages', () => ({
  home_calls_title: () => 'Anrufe in deinen Kanälen',
  home_calls_people: (/** @type {any} */ { count }) => `${count} im Anruf`,
  home_calls_people_with_me: (/** @type {any} */ { count }) => `${count} im Anruf, du bist dabei`,
  home_calls_join: () => 'Beitreten',
  home_calls_now: () => 'Jetzt',
  home_calls_open: () => 'Zum Kanal',
  home_calls_in: (/** @type {any} */ { name }) => `in ${name}`
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => ({ pubkey: ME }) }));
vi.mock('$lib/groups/feature.js', () => ({ moderatedCreationAvailable: () => true }));
vi.mock('$lib/groups/my-calls.svelte.js', () => ({
  useMyCalls: () => () => ({
    pointers: [{ id: 'chan', relay: RELAY }],
    participantsByKey: { [`chan@${RELAY}`]: state.participants },
    events: []
  })
}));
vi.mock('$lib/groups/channel-metadata.svelte.js', () => ({
  useChannelMetadata: () => () => ({
    byKey: {
      [`chan@${RELAY}`]: {
        tags: [
          ['d', 'chan'],
          ['name', 'Sitzungen (Hochschule)'],
          ['parent', 'root']
        ]
      },
      [`root@${RELAY}`]: {
        tags: [
          ['d', 'root'],
          ['name', 'AG Metadaten']
        ]
      }
    },
    failedRelays: []
  })
}));

import DashboardCalls from '$lib/components/dashboard/DashboardCalls.svelte';

describe('DashboardCalls', () => {
  it('offers to join a call I am not in, and names the community with a space before "in"', () => {
    state.participants = ['b'.repeat(64), 'c'.repeat(64)];
    const { getByTestId } = render(DashboardCalls);
    const row = getByTestId('dashboard-call-running');
    expect(row.textContent).toContain('2 im Anruf');
    expect(row.querySelector('a')?.textContent).toBe('Beitreten');
    expect(row.textContent?.replace(/\s+/g, ' ')).toContain(
      'Sitzungen (Hochschule) in AG Metadaten'
    );
  });

  it('says I am in it and only opens the channel when I am already in the call', () => {
    state.participants = ['b'.repeat(64), ME];
    const { getByTestId } = render(DashboardCalls);
    const row = getByTestId('dashboard-call-running');
    expect(row.textContent).toContain('2 im Anruf, du bist dabei');
    expect(row.querySelector('a')?.textContent).toBe('Zum Kanal');
  });

  it('renders nothing without a call or meeting', () => {
    state.participants = [];
    const { queryByTestId } = render(DashboardCalls);
    expect(queryByTestId('dashboard-calls')).toBeNull();
  });
});
