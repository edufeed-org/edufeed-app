/** @vitest-environment jsdom */
// The "Wie fange ich an?" chip: a fourth canned suggestion whose answer links
// to the configured user guide (runtimeConfig.help.url). Without a guide the
// chip is not offered at all.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const mockConfig = vi.hoisted(() => ({
  membership: { enabled: false, handleDomain: 'edufeed.org' },
  help: /** @type {{url: string | null}} */ ({ url: '/wiki/edufeed-erste-schritte' })
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return mockConfig.membership;
    },
    get help() {
      return mockConfig.help;
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

function renderWindow() {
  return render(TermiChatWindow, {
    props: {
      onToggleExpand: () => {},
      onClose: () => {},
      hints: [],
      openCount: 0,
      runHint: vi.fn(),
      customizeHint: vi.fn(),
      dismissHint: vi.fn()
    }
  });
}

describe('TermiChatWindow getting-started chip', () => {
  beforeEach(() => {
    mockConfig.help = { url: '/wiki/edufeed-erste-schritte' };
    vi.useRealTimers();
  });

  it('offers the chip and answers with a link to the guide', async () => {
    vi.useFakeTimers();
    const { getByTestId, getByText } = renderWindow();
    const chip = getByText(/Wie fange ich an\?|How do I get started\?/);
    await fireEvent.click(chip);
    await vi.advanceTimersByTimeAsync(1000);
    const link = getByTestId('termi-help-link');
    expect(link.getAttribute('href')).toBe('/wiki/edufeed-erste-schritte');
    expect(link.getAttribute('target')).toBeNull();
  });

  it('opens an external guide in a new tab', async () => {
    mockConfig.help = { url: 'https://example.org/hilfe' };
    vi.useFakeTimers();
    const { getByTestId, getByText } = renderWindow();
    await fireEvent.click(getByText(/Wie fange ich an\?|How do I get started\?/));
    await vi.advanceTimersByTimeAsync(1000);
    const link = getByTestId('termi-help-link');
    expect(link.getAttribute('href')).toBe('https://example.org/hilfe');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('hides the chip when no guide is configured', () => {
    mockConfig.help = { url: null };
    const { queryByText } = renderWindow();
    expect(queryByText(/Wie fange ich an\?|How do I get started\?/)).toBeNull();
  });
});
