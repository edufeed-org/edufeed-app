/** @vitest-environment jsdom */
// The nip05 hint renders per-variant: 'apply' keeps the request-address
// reminder, 'pending' is a passive note without an action button, and
// 'ready' celebrates the granted address with an Activate button.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return { enabled: true, handleDomain: 'edufeed.org' };
    }
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: 'user-pub', type: 'nsec' })
}));

vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => null
}));

import TermiChatWindow from '../TermiChatWindow.svelte';

/** @param {Array<{id: string, status: string, variant?: string, address?: string}>} hints */
function renderWindow(hints) {
  return render(TermiChatWindow, {
    props: {
      onToggleExpand: () => {},
      onClose: () => {},
      hints,
      openCount: hints.length,
      runHint: vi.fn(),
      customizeHint: vi.fn(),
      dismissHint: vi.fn()
    }
  });
}

describe('TermiChatWindow nip05 hint variants', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the request reminder for the 'apply' variant", () => {
    const { getByTestId } = renderWindow([{ id: 'nip05', status: 'open', variant: 'apply' }]);
    const action = getByTestId('termi-hint-nip05-action');
    expect(action.textContent).toMatch(/beantragen|request/i);
  });

  it("renders a passive note without an action button for the 'pending' variant", () => {
    const { getByTestId, queryByTestId } = renderWindow([
      { id: 'nip05', status: 'open', variant: 'pending' }
    ]);
    expect(getByTestId('termi-hint-nip05')).toBeTruthy();
    expect(queryByTestId('termi-hint-nip05-action')).toBeNull();
  });

  it("renders the granted address and an Activate button for the 'ready' variant", () => {
    const { getByTestId } = renderWindow([
      { id: 'nip05', status: 'open', variant: 'ready', address: 'maria@edufeed.org' }
    ]);
    const card = getByTestId('termi-hint-nip05');
    expect(card.textContent).toContain('maria@edufeed.org');
    const action = getByTestId('termi-hint-nip05-action');
    expect(action.textContent).toMatch(/aktivieren|activate/i);
  });
});
