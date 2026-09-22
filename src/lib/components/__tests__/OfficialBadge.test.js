/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const state = vi.hoisted(() => ({ adminPubkeys: /** @type {string[]} */ ([]) }));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return { adminPubkeys: state.adminPubkeys };
    },
    get appName() {
      return 'Edufeed';
    }
  }
}));
vi.mock('$lib/paraglide/messages', () => ({
  official_badge_label: () => 'Official',
  official_badge_title: (/** @type {{ appName: string }} */ i) => `Official ${i.appName} account`
}));

import OfficialBadge from '$lib/components/shared/OfficialBadge.svelte';

const ADMIN = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

describe('OfficialBadge', () => {
  beforeEach(() => {
    state.adminPubkeys = [ADMIN];
  });

  it('marks a configured platform account', () => {
    render(OfficialBadge, { props: { pubkey: ADMIN } });
    const badge = screen.getByText('Official');
    expect(badge.getAttribute('title')).toBe('Official Edufeed account');
  });

  it('renders nothing for anyone else', () => {
    const { container } = render(OfficialBadge, { props: { pubkey: OTHER } });
    expect(container.textContent?.trim()).toBe('');
  });
});
