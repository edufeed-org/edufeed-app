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
  fab_open_menu: () => 'Open actions menu',
  aria_close_modal: () => 'Close',
  fab_create_event: () => 'Create Event',
  fab_create_event_aria: () => 'Create new event',
  fab_create_calendar: () => 'Create Calendar',
  fab_create_calendar_aria: () => 'Create new calendar',
  fab_create_resource: () => 'Create Learning Content',
  fab_create_resource_aria: () => 'Create new learning content',
  fab_add_bookmark: () => 'Add Bookmark',
  fab_share_existing: () => 'Share Existing Content',
  fab_share_existing_aria: () => 'Share existing content with community',
  article_fab_write: () => 'Write Article',
  wiki_fab_write: () => 'Write Wiki',
  fab_create_form: () => 'Create Form',
  fab_create_poll: () => 'Create Poll',
  fab_create_poll_aria: () => 'Create new poll',
  fab_section_create: () => 'Create',
  fab_section_add: () => 'Add',
  fab_section_share: () => 'Share',
  // Picker modal keys (rendered only when variantPickerOpen becomes true)
  resource_variant_picker_title: () => 'Welche Art?',
  resource_variant_picker_description: () => 'Wähle eine Form.',
  resource_variant_picker_cancel: () => 'Abbrechen',
  resource_form_variant_amb_label: () => 'AMB-Bildungsmaterial',
  resource_form_variant_amb_description: () => 'AMB-Metadatenprofil',
  resource_form_variant_ekw_label: () => 'EKW-Bildungsmaterial',
  resource_form_variant_ekw_description: () => 'EKW-Metadatenprofil'
}));

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  npubToHex: (/** @type {string} */ npub) => npub
}));

// Variant registry mock — default to single-variant (legacy behavior).
// Individual tests can override via __setVariants().
vi.mock('$lib/config/resource-form-variants.js', () => {
  /** @type {Array<{id: string, labelKey: string, descriptionKey: string}>} */
  let variants = [
    {
      id: 'amb',
      labelKey: 'resource_form_variant_amb_label',
      descriptionKey: 'resource_form_variant_amb_description'
    }
  ];
  return {
    getEnabledVariants: () => variants,
    getDefaultVariantId: () => variants[0]?.id ?? 'amb',
    __setVariants(/** @type {typeof variants} */ list) {
      variants = list;
    }
  };
});

// @ts-ignore — test-only helper exported from the mock
import { __setVariants } from '$lib/config/resource-form-variants.js';

beforeEach(() => {
  vi.clearAllMocks();
  // Reset to single-variant (legacy) default.
  __setVariants([
    {
      id: 'amb',
      labelKey: 'resource_form_variant_amb_label',
      descriptionKey: 'resource_form_variant_amb_description'
    }
  ]);
});

/**
 * Renders <GlobalFAB /> and clicks the trigger to open the menu.
 * @returns {Promise<{ container: HTMLElement, trigger: HTMLButtonElement }>}
 */
async function renderOpen() {
  const { container } = render(GlobalFAB);
  const trigger = /** @type {HTMLButtonElement} */ (
    container.querySelector('[aria-label="Open actions menu"]')
  );
  await fireEvent.click(trigger);
  return { container, trigger };
}

describe('GlobalFAB', () => {
  it('renders the main FAB button', () => {
    const { container } = render(GlobalFAB);
    const mainButton = container.querySelector('[aria-label="Open actions menu"]');
    expect(mainButton).toBeTruthy();
  });

  it('renders all 9 action buttons', async () => {
    const { container } = await renderOpen();
    // Action buttons are wrapped in .fab-item containers inside the .fab-items scroll list.
    const actionButtons = container.querySelectorAll('.fab-items .fab-item > button');
    expect(actionButtons.length).toBe(9);
  });

  it('has create event button', async () => {
    const { container } = await renderOpen();
    const btn = container.querySelector('[aria-label="Create new event"]');
    expect(btn).toBeTruthy();
  });

  it('has create calendar button', async () => {
    const { container } = await renderOpen();
    const btn = container.querySelector('[aria-label="Create new calendar"]');
    expect(btn).toBeTruthy();
  });

  it('has create learning content button', async () => {
    const { container } = await renderOpen();
    const btn = container.querySelector('[aria-label="Create new learning content"]');
    expect(btn).toBeTruthy();
  });

  it('has write article button', async () => {
    const { container } = await renderOpen();
    const btn = container.querySelector('[aria-label="Write Article"]');
    expect(btn).toBeTruthy();
  });

  it('has write wiki button', async () => {
    const { container } = await renderOpen();
    const btn = container.querySelector('[aria-label="Write Wiki"]');
    expect(btn).toBeTruthy();
  });

  it('opens calendar event modal on event button click', async () => {
    const { container } = await renderOpen();
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
    const { container } = await renderOpen();
    const btn = /** @type {Element} */ (
      container.querySelector('[aria-label="Create new calendar"]')
    );
    await fireEvent.click(btn);
    expect(mockOpenModal).toHaveBeenCalledWith('createCalendar');
  });

  it('navigates to /create/resource/<default> on learning content click in single-variant mode', async () => {
    const { container } = await renderOpen();
    const btn = /** @type {Element} */ (
      container.querySelector('[aria-label="Create new learning content"]')
    );
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/create/resource/amb');
  });

  it('does not navigate when multiple variants are enabled (opens picker instead)', async () => {
    __setVariants([
      {
        id: 'amb',
        labelKey: 'resource_form_variant_amb_label',
        descriptionKey: 'resource_form_variant_amb_description'
      },
      {
        id: 'ekw',
        labelKey: 'resource_form_variant_ekw_label',
        descriptionKey: 'resource_form_variant_ekw_description'
      }
    ]);
    const { container } = await renderOpen();
    const btn = /** @type {Element} */ (
      container.querySelector('[aria-label="Create new learning content"]')
    );
    await fireEvent.click(btn);
    expect(mockGoto).not.toHaveBeenCalled();
  });

  it('navigates to /create/article on article click', async () => {
    const { container } = await renderOpen();
    const btn = /** @type {Element} */ (container.querySelector('[aria-label="Write Article"]'));
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/create/article');
  });

  it('navigates to /create/wiki on wiki click', async () => {
    const { container } = await renderOpen();
    const btn = /** @type {Element} */ (container.querySelector('[aria-label="Write Wiki"]'));
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/create/wiki');
  });

  it('has create form button', async () => {
    const { container } = await renderOpen();
    const btn = container.querySelector('[aria-label="Create Form"]');
    expect(btn).toBeTruthy();
  });

  it('navigates to /forms/new on form button click', async () => {
    const { container } = await renderOpen();
    const btn = /** @type {Element} */ (container.querySelector('[aria-label="Create Form"]'));
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/forms/new');
  });

  it('has create poll button', async () => {
    const { container } = await renderOpen();
    const btn = container.querySelector('[aria-label="Create new poll"]');
    expect(btn).toBeTruthy();
  });

  it('opens createPoll modal on poll button click', async () => {
    const { container } = await renderOpen();
    const btn = /** @type {Element} */ (container.querySelector('[aria-label="Create new poll"]'));
    await fireEvent.click(btn);
    expect(mockOpenModal).toHaveBeenCalledWith('createPoll', expect.any(Object));
  });

  it('has add bookmark button', async () => {
    const { container } = await renderOpen();
    const btn = container.querySelector('[aria-label="Add Bookmark"]');
    expect(btn).toBeTruthy();
  });

  it('opens add bookmark modal on bookmark button click', async () => {
    const { container } = await renderOpen();
    const btn = /** @type {Element} */ (container.querySelector('[aria-label="Add Bookmark"]'));
    await fireEvent.click(btn);
    expect(mockOpenModal).toHaveBeenCalledWith('addBookmark', expect.objectContaining({}));
  });

  it('has share existing content button', async () => {
    const { container } = await renderOpen();
    const btn = container.querySelector('[aria-label="Share existing content with community"]');
    expect(btn).toBeTruthy();
  });

  it('opens share by naddr modal on share existing click', async () => {
    const { container } = await renderOpen();
    const btn = /** @type {Element} */ (
      container.querySelector('[aria-label="Share existing content with community"]')
    );
    await fireEvent.click(btn);
    expect(mockOpenModal).toHaveBeenCalledWith('shareByNaddr', expect.objectContaining({}));
  });
});

describe('GlobalFAB — toggle + scroll behavior', () => {
  it('does not render action buttons when closed (no phantom layout)', () => {
    const { container } = render(GlobalFAB);
    const actionButtons = container.querySelectorAll('.fab-item > button');
    expect(actionButtons.length).toBe(0);
  });

  it('clicking the trigger opens the menu and renders all 9 actions', async () => {
    const { container } = render(GlobalFAB);
    const trigger = /** @type {HTMLButtonElement} */ (
      container.querySelector('[aria-label="Open actions menu"]')
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const actionButtons = container.querySelectorAll('.fab-item > button');
    expect(actionButtons.length).toBe(9);
  });

  it('clicking the trigger again closes the menu', async () => {
    const { container } = render(GlobalFAB);
    const trigger = /** @type {HTMLButtonElement} */ (
      container.querySelector('[aria-label="Open actions menu"]')
    );
    await fireEvent.click(trigger);
    await fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('.fab-item > button').length).toBe(0);
  });

  it('pressing Escape closes the menu', async () => {
    const { container } = render(GlobalFAB);
    const trigger = /** @type {HTMLButtonElement} */ (
      container.querySelector('[aria-label="Open actions menu"]')
    );
    await fireEvent.click(trigger);
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('.fab-item > button').length).toBe(0);
  });

  it('items container has overflow-y-auto and a max-height class when open', async () => {
    const { container } = render(GlobalFAB);
    const trigger = /** @type {HTMLButtonElement} */ (
      container.querySelector('[aria-label="Open actions menu"]')
    );
    await fireEvent.click(trigger);
    const itemsList = /** @type {HTMLElement} */ (container.querySelector('.fab-items'));
    expect(itemsList).toBeTruthy();
    const cls = itemsList.className;
    expect(cls).toMatch(/overflow-y-auto/);
    expect(cls).toMatch(/max-h-/);
  });

  it('selecting an action closes the menu after firing its handler', async () => {
    const { container } = render(GlobalFAB);
    const trigger = /** @type {HTMLButtonElement} */ (
      container.querySelector('[aria-label="Open actions menu"]')
    );
    await fireEvent.click(trigger);
    const btn = /** @type {Element} */ (container.querySelector('[aria-label="Create new event"]'));
    await fireEvent.click(btn);
    expect(mockOpenModal).toHaveBeenCalledWith(
      'calendarEvent',
      expect.objectContaining({ mode: 'create' })
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
