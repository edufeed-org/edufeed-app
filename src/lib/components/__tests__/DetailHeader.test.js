// @ts-nocheck
/**
 * DetailHeader Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

// Mock app-settings before any imports that transitively depend on it
vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { debugMode: false, gatedMode: false }
}));

vi.mock('$lib/paraglide/messages', () => ({
  default: {},
  common_back: () => 'Back',
  event_tags_view_all_tooltip: ({ tag }) => `View all ${tag} events`,
  event_tags_more_count: ({ count }) => `+${count} more`
}));

vi.mock('$app/paths', () => ({
  resolve: (path) => path
}));

vi.mock('$lib/helpers/navigationHistory.js', () => ({
  getHasHistory: () => true
}));

vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => null
}));

vi.mock('applesauce-core/helpers', () => ({
  getDisplayName: () => 'Test User'
}));

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  profileLink: (pubkey) => (pubkey ? `/p/${pubkey}` : '#')
}));

// Mock heavy sub-components to avoid deep dependency chains
vi.mock('../shared/EventContextMenu.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: () => ({}) }));

import DetailHeaderTestWrapper from './DetailHeaderTestWrapper.svelte';

describe('DetailHeader', () => {
  it('renders title below toolbar border', () => {
    const { getByText } = render(DetailHeaderTestWrapper, {
      props: { title: 'My Title' }
    });
    const titleEl = getByText('My Title');
    expect(titleEl).toBeTruthy();
    // Title should be an h1 outside the toolbar
    expect(titleEl.tagName).toBe('H1');
  });

  it('renders metadata snippet in toolbar when provided', () => {
    const { getByTestId } = render(DetailHeaderTestWrapper, {
      props: { showMetadata: true, tags: ['svelte', 'nostr'] }
    });
    expect(getByTestId('metadata-content')).toBeTruthy();
  });

  it('renders without metadata when not provided', () => {
    const { queryByTestId } = render(DetailHeaderTestWrapper, {
      props: { showMetadata: false }
    });
    expect(queryByTestId('metadata-content')).toBeNull();
  });

  it('does not render author info when authorPubkey is empty', () => {
    const { container } = render(DetailHeaderTestWrapper, {
      props: { title: 'No Author', authorPubkey: '' }
    });
    // No author name link should be rendered
    const toolbar = container.querySelector('.border-b');
    expect(toolbar).toBeTruthy();
    const authorLinks = toolbar.querySelectorAll('a[href*="/p/"]');
    expect(authorLinks.length).toBe(0);
  });

  it('does not render title section when title is empty', () => {
    const { container } = render(DetailHeaderTestWrapper, {
      props: { title: '' }
    });
    const h1 = container.querySelector('h1');
    expect(h1).toBeNull();
  });
});
