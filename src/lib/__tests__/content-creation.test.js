/**
 * Content Creation Helper Tests
 *
 * Tests CONTENT_CREATION map and navigateToCreate dispatch.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock SvelteKit modules
vi.mock('$app/navigation', () => ({
  goto: vi.fn()
}));
vi.mock('$app/paths', () => ({
  resolve: vi.fn((p) => p)
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { openModal: vi.fn() }
}));

import { CONTENT_CREATION, navigateToCreate } from '$lib/helpers/contentCreation.js';
import { goto } from '$app/navigation';
import { modalStore } from '$lib/stores/modal.svelte.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CONTENT_CREATION', () => {
  it('has entries for calendar, learning, article, wiki, form', () => {
    expect(Object.keys(CONTENT_CREATION)).toEqual([
      'calendar',
      'learning',
      'article',
      'wiki',
      'form'
    ]);
  });

  it('calendar is a modal target', () => {
    expect(CONTENT_CREATION.calendar.type).toBe('modal');
  });

  it('learning, article, wiki, form are route targets', () => {
    for (const key of ['learning', 'article', 'wiki', 'form']) {
      expect(CONTENT_CREATION[key].type).toBe('route');
    }
  });
});

describe('navigateToCreate', () => {
  it('opens modal for calendar', () => {
    navigateToCreate('calendar');
    expect(modalStore.openModal).toHaveBeenCalledWith(
      'calendarEvent',
      expect.objectContaining({
        communityPubkey: '',
        mode: 'create'
      })
    );
    expect(goto).not.toHaveBeenCalled();
  });

  it('navigates to route for learning', () => {
    navigateToCreate('learning');
    expect(goto).toHaveBeenCalledWith('/create/resource');
    expect(modalStore.openModal).not.toHaveBeenCalled();
  });

  it('navigates to route for article', () => {
    navigateToCreate('article');
    expect(goto).toHaveBeenCalledWith('/create/article');
  });

  it('navigates to route for wiki', () => {
    navigateToCreate('wiki');
    expect(goto).toHaveBeenCalledWith('/create/wiki');
  });

  it('navigates to route for form', () => {
    navigateToCreate('form');
    expect(goto).toHaveBeenCalledWith('/forms/new');
  });

  it('appends community query param when communityPubkey provided', () => {
    navigateToCreate('learning', { communityPubkey: 'abc123' });
    expect(goto).toHaveBeenCalledWith('/create/resource?community=abc123');
  });

  it('passes communityPubkey to modal for calendar', () => {
    navigateToCreate('calendar', { communityPubkey: 'abc123' });
    expect(modalStore.openModal).toHaveBeenCalledWith(
      'calendarEvent',
      expect.objectContaining({
        communityPubkey: 'abc123'
      })
    );
  });

  it('does nothing for unknown key', () => {
    navigateToCreate('unknown');
    expect(goto).not.toHaveBeenCalled();
    expect(modalStore.openModal).not.toHaveBeenCalled();
  });
});
