// @ts-nocheck
/**
 * SelectedAuthors — the profiles of the authors picked in the /discover
 * author filter, above the results: picking a person with nothing published
 * must still show who they are (laoc, 2026-10-30: "shouldn't at least her
 * profile be shown?").
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import SelectedAuthors from '../discover/SelectedAuthors.svelte';

vi.mock(
  '$lib/components/shared/ProfileCard.svelte',
  () => import('./fixtures/ProfileCardStub.svelte')
);

const cards = (container) =>
  [...container.querySelectorAll('[data-testid="selected-author"]')].map((el) => el.dataset.pubkey);

describe('SelectedAuthors', () => {
  it('shows one profile card per selected author, in filter order', () => {
    const { container } = render(SelectedAuthors, {
      props: { pubkeys: ['b'.repeat(64), 'a'.repeat(64)] }
    });
    expect(cards(container)).toEqual(['b'.repeat(64), 'a'.repeat(64)]);
    const stub = container.querySelector('[data-testid="profile-card-stub"]');
    expect(stub?.dataset.details).toBe('nip05,about');
  });

  it('renders nothing without a selection', () => {
    const { container } = render(SelectedAuthors, { props: { pubkeys: [] } });
    expect(container.querySelector('[data-testid="selected-authors"]')).toBeNull();
  });
});
