// @ts-nocheck
/**
 * EventTags Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import EventTags from '../calendar/EventTags.svelte';

// Mock paraglide messages
vi.mock('$lib/paraglide/messages', () => ({
  event_tags_view_all_tooltip: ({ tag }) => `View all ${tag} events`,
  event_tags_more_count: ({ count }) => `+${count} weitere`
}));

// Mock $app/paths
vi.mock('$app/paths', () => ({
  resolve: (path) => path
}));

describe('EventTags', () => {
  it('renders nothing for empty tags array', () => {
    const { container } = render(EventTags, { props: { tags: [] } });
    expect(container.querySelector('.flex')).toBeNull();
  });

  it('renders all tags when no maxDisplay', () => {
    const { getAllByRole } = render(EventTags, {
      props: { tags: ['svelte', 'nostr', 'web'] }
    });
    const links = getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(links[0].textContent).toContain('#svelte');
    expect(links[1].textContent).toContain('#nostr');
    expect(links[2].textContent).toContain('#web');
  });

  it('truncates to maxDisplay visible tags and shows overflow dropdown', () => {
    const { getAllByRole, getByText } = render(EventTags, {
      props: { tags: ['a', 'b', 'c', 'd', 'e'], maxDisplay: 2 }
    });
    const links = getAllByRole('link');
    // 2 visible + 3 hidden in dropdown
    expect(links).toHaveLength(5);
    expect(links[0].textContent).toContain('#a');
    expect(links[1].textContent).toContain('#b');
    expect(getByText('+3 weitere')).toBeTruthy();
  });

  it('overflow indicator is a clickable button', () => {
    const { getByRole } = render(EventTags, {
      props: { tags: ['a', 'b', 'c', 'd'], maxDisplay: 2 }
    });
    const button = getByRole('button');
    expect(button).toBeTruthy();
    expect(button.textContent).toContain('+2 weitere');
  });

  it('hidden tags render as links in the dropdown', () => {
    const { getAllByRole } = render(EventTags, {
      props: { tags: ['a', 'b', 'c', 'd'], maxDisplay: 2 }
    });
    const links = getAllByRole('link');
    // 2 visible + 2 hidden in dropdown
    expect(links).toHaveLength(4);
    expect(links[2].textContent).toContain('#c');
    expect(links[3].textContent).toContain('#d');
    expect(links[2].getAttribute('href')).toBe('/calendar?tags=c');
    expect(links[3].getAttribute('href')).toBe('/calendar?tags=d');
  });

  it('tags link to correct targetRoute with encoded tag param', () => {
    const { getAllByRole } = render(EventTags, {
      props: { tags: ['test tag'], targetRoute: '/discover' }
    });
    const link = getAllByRole('link')[0];
    expect(link.getAttribute('href')).toBe('/discover?tags=test%20tag');
  });

  it('deduplicates tags', () => {
    const { getAllByRole } = render(EventTags, {
      props: { tags: ['svelte', 'svelte', 'nostr'] }
    });
    const links = getAllByRole('link');
    expect(links).toHaveLength(2);
  });
});
