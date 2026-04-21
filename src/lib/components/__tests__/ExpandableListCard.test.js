/**
 * ExpandableListCard Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ExpandableListCard from '../dashboard/ExpandableListCard.svelte';

describe('ExpandableListCard', () => {
  it('renders title and count', () => {
    const { getByText } = render(ExpandableListCard, {
      props: { title: 'Bookmarks', count: 5, expanded: false, toggle: vi.fn() }
    });

    expect(getByText('Bookmarks')).toBeTruthy();
    expect(getByText('5 items')).toBeTruthy();
  });

  it('renders custom count label', () => {
    const { getByText } = render(ExpandableListCard, {
      props: { title: 'People', count: 8, countLabel: 'people', expanded: false, toggle: vi.fn() }
    });

    expect(getByText('8 people')).toBeTruthy();
  });

  it('shows down arrow when collapsed', () => {
    const { getByText } = render(ExpandableListCard, {
      props: { title: 'Test', count: 0, expanded: false, toggle: vi.fn() }
    });

    expect(getByText('▼')).toBeTruthy();
  });

  it('shows up arrow when expanded', () => {
    const { getByText } = render(ExpandableListCard, {
      props: { title: 'Test', count: 0, expanded: true, toggle: vi.fn() }
    });

    expect(getByText('▲')).toBeTruthy();
  });

  it('calls toggle when clicked', async () => {
    const toggle = vi.fn();
    const { container } = render(ExpandableListCard, {
      props: { title: 'Test', count: 0, expanded: false, toggle }
    });

    const button = container.querySelector('button');
    expect(button).toBeTruthy();
    await fireEvent.click(/** @type {HTMLElement} */ (button));
    expect(toggle).toHaveBeenCalledOnce();
  });
});
