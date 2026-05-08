/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import FeaturedAuthors from '../FeaturedAuthors.svelte';

// Minimal mock for useProfileMap — returns empty Map (component must still render placeholders)
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

describe('FeaturedAuthors', () => {
  it('renders nothing when pubkeys is empty', () => {
    const { container } = render(FeaturedAuthors, {
      props: { pubkeys: [], selected: [], onToggle: () => {} }
    });
    expect(container.querySelector('[data-testid="featured-authors"]')).toBeNull();
  });

  it('renders one button per pubkey', () => {
    const { getAllByRole } = render(FeaturedAuthors, {
      props: {
        pubkeys: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
        selected: [],
        onToggle: () => {}
      }
    });
    expect(getAllByRole('button').length).toBe(3);
  });

  it('applies selected styling to selected pubkeys', () => {
    const { getAllByRole } = render(FeaturedAuthors, {
      props: {
        pubkeys: ['a'.repeat(64), 'b'.repeat(64)],
        selected: ['a'.repeat(64)],
        onToggle: () => {}
      }
    });
    const buttons = getAllByRole('button');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onToggle with the pubkey when a button is clicked', async () => {
    const onToggle = vi.fn();
    const { getAllByRole } = render(FeaturedAuthors, {
      props: {
        pubkeys: ['a'.repeat(64), 'b'.repeat(64)],
        selected: [],
        onToggle
      }
    });
    await fireEvent.click(getAllByRole('button')[1]);
    expect(onToggle).toHaveBeenCalledWith('b'.repeat(64));
  });
});
