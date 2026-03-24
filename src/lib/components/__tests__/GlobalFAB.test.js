/**
 * GlobalFAB Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import GlobalFAB from '../shared/GlobalFAB.svelte';

// Mock dependencies
const mockOpenModal = vi.fn();
const mockGoto = vi.fn();

vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { openModal: (/** @type {any[]} */ ...args) => mockOpenModal(...args) }
}));

vi.mock('$app/navigation', () => ({
  goto: (/** @type {any[]} */ ...args) => mockGoto(...args)
}));

vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

vi.mock('$app/stores', () => {
  const { readable } = require('svelte/store');
  return {
    page: readable({ params: {}, route: { id: '/calendar' } })
  };
});

vi.mock('$lib/paraglide/messages', () => ({
  article_fab_write: () => 'Write Article',
  wiki_fab_write: () => 'Write Wiki'
}));

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  npubToHex: (/** @type {string} */ npub) => npub
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GlobalFAB', () => {
  it('renders the main FAB button', () => {
    const { container } = render(GlobalFAB);
    const mainButton = container.querySelector('[aria-label="Open actions menu"]');
    expect(mainButton).toBeTruthy();
  });

  it('renders all 7 action buttons', () => {
    const { container } = render(GlobalFAB);
    const actionButtons = container.querySelectorAll('.fab > button');
    expect(actionButtons.length).toBe(7);
  });

  it('has create event button', () => {
    const { container } = render(GlobalFAB);
    const btn = container.querySelector('[aria-label="Create new event"]');
    expect(btn).toBeTruthy();
  });

  it('has create calendar button', () => {
    const { container } = render(GlobalFAB);
    const btn = container.querySelector('[aria-label="Create new calendar"]');
    expect(btn).toBeTruthy();
  });

  it('has create learning content button', () => {
    const { container } = render(GlobalFAB);
    const btn = container.querySelector('[aria-label="Create new learning content"]');
    expect(btn).toBeTruthy();
  });

  it('has write article button', () => {
    const { container } = render(GlobalFAB);
    const btn = container.querySelector('[aria-label="Write Article"]');
    expect(btn).toBeTruthy();
  });

  it('has write wiki button', () => {
    const { container } = render(GlobalFAB);
    const btn = container.querySelector('[aria-label="Write Wiki"]');
    expect(btn).toBeTruthy();
  });

  it('opens calendar event modal on event button click', async () => {
    const { container } = render(GlobalFAB);
    const btn = /** @type {Element} */ (container.querySelector('[aria-label="Create new event"]'));
    await fireEvent.click(btn);
    expect(mockOpenModal).toHaveBeenCalledWith(
      'calendarEvent',
      expect.objectContaining({
        selectedDate: expect.any(Date),
        mode: 'create'
      })
    );
  });

  it('opens create calendar modal on calendar button click', async () => {
    const { container } = render(GlobalFAB);
    const btn = /** @type {Element} */ (
      container.querySelector('[aria-label="Create new calendar"]')
    );
    await fireEvent.click(btn);
    expect(mockOpenModal).toHaveBeenCalledWith('createCalendar');
  });

  it('navigates to /create/resource on learning content click', async () => {
    const { container } = render(GlobalFAB);
    const btn = /** @type {Element} */ (
      container.querySelector('[aria-label="Create new learning content"]')
    );
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/create/resource');
  });

  it('navigates to /create/article on article click', async () => {
    const { container } = render(GlobalFAB);
    const btn = /** @type {Element} */ (container.querySelector('[aria-label="Write Article"]'));
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/create/article');
  });

  it('navigates to /create/wiki on wiki click', async () => {
    const { container } = render(GlobalFAB);
    const btn = /** @type {Element} */ (container.querySelector('[aria-label="Write Wiki"]'));
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/create/wiki');
  });

  it('has add bookmark button', () => {
    const { container } = render(GlobalFAB);
    const btn = container.querySelector('[aria-label="Add Bookmark"]');
    expect(btn).toBeTruthy();
  });

  it('opens add bookmark modal on bookmark button click', async () => {
    const { container } = render(GlobalFAB);
    const btn = /** @type {Element} */ (container.querySelector('[aria-label="Add Bookmark"]'));
    await fireEvent.click(btn);
    expect(mockOpenModal).toHaveBeenCalledWith('addBookmark', expect.objectContaining({}));
  });

  it('has share existing content button', () => {
    const { container } = render(GlobalFAB);
    const btn = container.querySelector('[aria-label="Share existing content with community"]');
    expect(btn).toBeTruthy();
  });

  it('opens share by naddr modal on share existing click', async () => {
    const { container } = render(GlobalFAB);
    const btn = /** @type {Element} */ (
      container.querySelector('[aria-label="Share existing content with community"]')
    );
    await fireEvent.click(btn);
    expect(mockOpenModal).toHaveBeenCalledWith('shareByNaddr', expect.objectContaining({}));
  });
});
