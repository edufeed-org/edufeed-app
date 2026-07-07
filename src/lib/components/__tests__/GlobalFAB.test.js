/**
 * GlobalFAB Component Tests
 *
 * The FAB opens a registry-driven "create hub" sheet (single markup for all
 * breakpoints). Actions come from CREATE_ACTIONS; community routes filter them
 * by the community's kind 10222 content kinds; a contextual "Suggested" row can
 * appear above the stable sections.
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

// Configurable page store — tests set route/params/url via __setPage.
vi.mock('$app/stores', () => {
  const { writable } = require('svelte/store');
  const store = writable({
    params: {},
    route: { id: '/settings' },
    url: new URL('http://localhost/settings')
  });
  return {
    page: store,
    __setPage: (/** @type {any} */ value) => store.set(value)
  };
});

vi.mock('$lib/paraglide/messages', () => ({
  fab_open_menu: () => 'Open actions menu',
  aria_close_modal: () => 'Close',
  fab_create_event: () => 'Create Event',
  fab_create_event_aria: () => 'Create new event',
  fab_create_event_desc: () => 'Create a single public event',
  fab_create_calendar: () => 'Create Calendar',
  fab_create_calendar_aria: () => 'Create new calendar',
  fab_create_calendar_desc: () => 'Create a public calendar containing events',
  fab_create_resource: () => 'Create Learning Content',
  fab_create_resource_aria: () => 'Create new learning content',
  fab_add_bookmark: () => 'Add Bookmark',
  fab_add_bookmark_desc: () => 'Recommend a link as a bookmark',
  fab_share_existing: () => 'Share Existing Content',
  fab_share_existing_aria: () => 'Share existing content with community',
  fab_share_existing_desc: () => 'Repost existing content into a community',
  article_fab_write: () => 'Write Article',
  wiki_fab_write: () => 'Write Wiki',
  fab_create_form: () => 'Create Form',
  fab_create_poll: () => 'Create Poll',
  fab_create_poll_aria: () => 'Create new poll',
  fab_section_suggested: () => 'Suggested',
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

// Community definition (kind 10222) — tests emit an event via __setCommunityEvent.
const communityState = vi.hoisted(() => ({ event: /** @type {any} */ (null) }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: () => ({
      subscribe: (/** @type {(event: any) => void} */ cb) => {
        cb(communityState.event);
        return { unsubscribe() {} };
      }
    })
  }
}));
vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe() {} }) })
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => []
}));

// Variant registry mock — default to single-variant (legacy behavior).
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

// @ts-ignore — test-only helpers exported from the mocks
import { __setVariants } from '$lib/config/resource-form-variants.js';
// @ts-ignore
import { __setPage } from '$app/stores';

/** @param {string} routeId @param {Record<string, string>} [params] @param {string} [urlPath] */
function setPage(routeId, params = {}, urlPath = '/settings') {
  __setPage({ params, route: { id: routeId }, url: new URL(`http://localhost${urlPath}`) });
}

/**
 * Fabricate a kind 10222 community event with content sections.
 * Writes the ["strict", "content"] marker by default; pass strict: false to
 * fabricate a legacy definition (fails open — no filtering).
 * @param {Array<{name: string, kinds: number[]}>} sections
 * @param {{ strict?: boolean }} [opts]
 */
function makeCommunityEvent(sections, { strict = true } = {}) {
  const tags = [];
  if (strict) tags.push(['strict', 'content']);
  for (const section of sections) {
    tags.push(['content', section.name]);
    for (const kind of section.kinds) tags.push(['k', String(kind)]);
  }
  return { kind: 10222, pubkey: 'a'.repeat(64), tags, content: '', created_at: 0, id: '', sig: '' };
}

beforeEach(() => {
  vi.clearAllMocks();
  communityState.event = null;
  setPage('/settings');
  __setVariants([
    {
      id: 'amb',
      labelKey: 'resource_form_variant_amb_label',
      descriptionKey: 'resource_form_variant_amb_description'
    }
  ]);
});

/**
 * Renders <GlobalFAB /> and clicks the trigger to open the sheet.
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

/** @param {HTMLElement} container */
function actionTiles(container) {
  return container.querySelectorAll('[role="menu"] section button');
}

/** @param {HTMLElement} container */
function sectionHeadings(container) {
  return Array.from(container.querySelectorAll('[role="menu"] section h3')).map((h) =>
    h.textContent?.trim()
  );
}

describe('GlobalFAB', () => {
  it('renders the main FAB button', () => {
    const { container } = render(GlobalFAB);
    const mainButton = container.querySelector('[aria-label="Open actions menu"]');
    expect(mainButton).toBeTruthy();
  });

  it('renders all 9 action tiles in the sheet', async () => {
    const { container } = await renderOpen();
    expect(actionTiles(container).length).toBe(9);
  });

  it('renders the Create/Add/Share section headings (no Suggested on neutral routes)', async () => {
    const { container } = await renderOpen();
    expect(sectionHeadings(container)).toEqual(['Create', 'Add', 'Share']);
  });

  it('has create event button', async () => {
    const { container } = await renderOpen();
    expect(container.querySelector('[aria-label="Create new event"]')).toBeTruthy();
  });

  it('has create calendar button', async () => {
    const { container } = await renderOpen();
    expect(container.querySelector('[aria-label="Create new calendar"]')).toBeTruthy();
  });

  it('shows a disambiguating tooltip on event/calendar/bookmark/share tiles only', async () => {
    const { container } = await renderOpen();
    const tipFor = (/** @type {string} */ ariaLabel) => {
      const tile = /** @type {HTMLElement} */ (
        container.querySelector(`[aria-label="${ariaLabel}"]`)
      );
      return { tip: tile.getAttribute('data-tip'), hasClass: tile.classList.contains('tooltip') };
    };

    expect(tipFor('Create new event')).toEqual({
      tip: 'Create a single public event',
      hasClass: true
    });
    expect(tipFor('Create new calendar')).toEqual({
      tip: 'Create a public calendar containing events',
      hasClass: true
    });
    expect(tipFor('Add Bookmark')).toEqual({
      tip: 'Recommend a link as a bookmark',
      hasClass: true
    });
    expect(tipFor('Share existing content with community')).toEqual({
      tip: 'Repost existing content into a community',
      hasClass: true
    });
    // Tiles without a description get neither the class nor the attribute
    expect(tipFor('Write Article')).toEqual({ tip: null, hasClass: false });
  });

  it('has create learning content button', async () => {
    const { container } = await renderOpen();
    expect(container.querySelector('[aria-label="Create new learning content"]')).toBeTruthy();
  });

  it('has write article button', async () => {
    const { container } = await renderOpen();
    expect(container.querySelector('[aria-label="Write Article"]')).toBeTruthy();
  });

  it('has write wiki button', async () => {
    const { container } = await renderOpen();
    expect(container.querySelector('[aria-label="Write Wiki"]')).toBeTruthy();
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
    expect(mockOpenModal).toHaveBeenCalledWith('createCalendar', undefined);
  });

  it('navigates to /create/resource/<default> on learning content click in single-variant mode', async () => {
    const { container } = await renderOpen();
    const btn = /** @type {Element} */ (
      container.querySelector('[aria-label="Create new learning content"]')
    );
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/create/resource/amb');
  });

  it('opens the global variant picker modal when multiple variants are enabled', async () => {
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
    expect(mockOpenModal).toHaveBeenCalledWith(
      'resourceVariantPicker',
      expect.objectContaining({ communityPubkey: '' })
    );
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

  it('has create form button and navigates to /forms/new', async () => {
    const { container } = await renderOpen();
    const btn = /** @type {Element} */ (container.querySelector('[aria-label="Create Form"]'));
    expect(btn).toBeTruthy();
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/forms/new');
  });

  it('opens createPoll modal on poll button click', async () => {
    const { container } = await renderOpen();
    const btn = /** @type {Element} */ (container.querySelector('[aria-label="Create new poll"]'));
    expect(btn).toBeTruthy();
    await fireEvent.click(btn);
    expect(mockOpenModal).toHaveBeenCalledWith('createPoll', expect.any(Object));
  });

  it('opens add bookmark modal on bookmark button click', async () => {
    const { container } = await renderOpen();
    const btn = /** @type {Element} */ (container.querySelector('[aria-label="Add Bookmark"]'));
    expect(btn).toBeTruthy();
    await fireEvent.click(btn);
    expect(mockOpenModal).toHaveBeenCalledWith('addBookmark', expect.objectContaining({}));
  });

  it('opens share by naddr modal on share existing click', async () => {
    const { container } = await renderOpen();
    const btn = /** @type {Element} */ (
      container.querySelector('[aria-label="Share existing content with community"]')
    );
    expect(btn).toBeTruthy();
    await fireEvent.click(btn);
    expect(mockOpenModal).toHaveBeenCalledWith('shareByNaddr', expect.objectContaining({}));
  });
});

describe('GlobalFAB — toggle behavior', () => {
  it('does not render the sheet when closed', () => {
    const { container } = render(GlobalFAB);
    expect(container.querySelector('[role="menu"]')).toBeFalsy();
  });

  it('clicking the trigger opens the sheet and renders all 9 actions', async () => {
    const { container, trigger } = await renderOpen();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(actionTiles(container).length).toBe(9);
  });

  it('clicking the trigger again closes the sheet', async () => {
    const { container, trigger } = await renderOpen();
    await fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role="menu"]')).toBeFalsy();
  });

  it('pressing Escape closes the sheet', async () => {
    const { container, trigger } = await renderOpen();
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role="menu"]')).toBeFalsy();
  });

  it('selecting an action closes the sheet after firing its handler', async () => {
    const { container, trigger } = await renderOpen();
    const btn = /** @type {Element} */ (container.querySelector('[aria-label="Create new event"]'));
    await fireEvent.click(btn);
    expect(mockOpenModal).toHaveBeenCalledWith(
      'calendarEvent',
      expect.objectContaining({ mode: 'create' })
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('GlobalFAB — community filtering', () => {
  const pubkey = 'a'.repeat(64);

  it('hides actions whose kinds the community does not accept', async () => {
    communityState.event = makeCommunityEvent([
      { name: 'Calendar', kinds: [31922, 31923, 31924, 31925] }
    ]);
    setPage('/c/[pubkey]', { pubkey }, `/c/${pubkey}`);
    const { container } = await renderOpen();
    expect(container.querySelector('[aria-label="Create new event"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Create new calendar"]')).toBeTruthy();
    // Context-independent actions stay
    expect(container.querySelector('[aria-label="Create Form"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Add Bookmark"]')).toBeTruthy();
    expect(
      container.querySelector('[aria-label="Share existing content with community"]')
    ).toBeTruthy();
    // Filtered out
    expect(container.querySelector('[aria-label="Create new poll"]')).toBeFalsy();
    expect(container.querySelector('[aria-label="Write Article"]')).toBeFalsy();
    expect(container.querySelector('[aria-label="Write Wiki"]')).toBeFalsy();
    expect(container.querySelector('[aria-label="Create new learning content"]')).toBeFalsy();
  });

  it('shows all actions for legacy definitions without the strict marker (fail open)', async () => {
    communityState.event = makeCommunityEvent(
      [{ name: 'Calendar', kinds: [31922, 31923, 31924, 31925] }],
      { strict: false }
    );
    setPage('/c/[pubkey]', { pubkey }, `/c/${pubkey}`);
    const { container } = await renderOpen();
    expect(actionTiles(container).length).toBe(9);
  });

  it('shows all actions when the community has no content sections (fail open)', async () => {
    communityState.event = makeCommunityEvent([]);
    setPage('/c/[pubkey]', { pubkey }, `/c/${pubkey}`);
    const { container } = await renderOpen();
    expect(actionTiles(container).length).toBe(9);
  });

  it('shows all actions while the community event has not loaded (fail open)', async () => {
    communityState.event = null;
    setPage('/c/[pubkey]', { pubkey }, `/c/${pubkey}`);
    const { container } = await renderOpen();
    expect(actionTiles(container).length).toBe(9);
  });
});

describe('GlobalFAB — suggested row', () => {
  it('suggests Create Event on calendar routes', async () => {
    setPage('/calendar', {}, '/calendar');
    const { container } = await renderOpen();
    expect(sectionHeadings(container)[0]).toBe('Suggested');
    const suggestedSection = /** @type {Element} */ (
      container.querySelector('[role="menu"] section')
    );
    expect(suggestedSection.querySelector('[aria-label="Create new event"]')).toBeTruthy();
    // 9 stable tiles + 1 suggested
    expect(actionTiles(container).length).toBe(10);
  });

  it('suggests via community ?view= param', async () => {
    const pubkey = 'a'.repeat(64);
    setPage('/c/[pubkey]', { pubkey }, `/c/${pubkey}?view=learning`);
    const { container } = await renderOpen();
    expect(sectionHeadings(container)[0]).toBe('Suggested');
    const suggestedSection = /** @type {Element} */ (
      container.querySelector('[role="menu"] section')
    );
    expect(
      suggestedSection.querySelector('[aria-label="Create new learning content"]')
    ).toBeTruthy();
  });

  it('renders no Suggested section on unknown routes', async () => {
    const { container } = await renderOpen();
    expect(sectionHeadings(container)).not.toContain('Suggested');
  });
});
