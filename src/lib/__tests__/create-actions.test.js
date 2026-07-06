/**
 * CREATE_ACTIONS registry — declarative content-creation actions for the global FAB.
 * Entries must be pure data + a run(ctx) that only talks to the injected context,
 * so the FAB can render any number of content types without hardcoded handlers.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/paraglide/messages', () => ({
  default: {},
  fab_create_event: () => 'Create Event',
  fab_create_event_aria: () => 'Create new event',
  fab_create_calendar: () => 'Create Calendar',
  fab_create_calendar_aria: () => 'Create new calendar',
  fab_create_resource: () => 'Create Learning Content',
  fab_create_resource_aria: () => 'Create new learning content',
  article_fab_write: () => 'Write Article',
  wiki_fab_write: () => 'Write Wiki',
  fab_create_form: () => 'Create Form',
  fab_create_poll: () => 'Create Poll',
  fab_create_poll_aria: () => 'Create new poll',
  fab_add_bookmark: () => 'Add Bookmark',
  fab_share_existing: () => 'Share Existing Content',
  fab_share_existing_aria: () => 'Share existing content with community'
}));

vi.mock('$lib/components/icons', () => ({
  CalendarIcon: {},
  CalendarPlusIcon: {},
  GraduationCapIcon: {},
  ArticleIcon: {},
  BookIcon: {},
  ScrollTextIcon: {},
  PollIcon: {},
  BookmarkIcon: {},
  RepostIcon: {}
}));

vi.mock('$lib/config/resource-form-variants.js', () => {
  /** @type {Array<{id: string}>} */
  let variants = [{ id: 'amb' }];
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
import {
  CREATE_ACTIONS,
  filterActionsForCommunity,
  suggestedActionIds
} from '$lib/config/create-actions.js';

/**
 * Fabricate a kind 10222 community event with content sections.
 * @param {Array<{name: string, kinds: number[]}>} sections
 */
function makeCommunityEvent(sections) {
  const tags = [];
  for (const section of sections) {
    tags.push(['content', section.name]);
    for (const kind of section.kinds) tags.push(['k', String(kind)]);
  }
  return { kind: 10222, pubkey: 'a'.repeat(64), tags, content: '', created_at: 0, id: '', sig: '' };
}

/** Build a spy context. @param {string} [communityPubkey] */
function makeCtx(communityPubkey = '') {
  return {
    communityPubkey,
    openModal: vi.fn(),
    goto: vi.fn(),
    resolve: vi.fn((/** @type {string} */ path) => path),
    openVariantPicker: vi.fn()
  };
}

/** @param {string} id */
function action(id) {
  const found = CREATE_ACTIONS.find((a) => a.id === id);
  if (!found) throw new Error(`no action ${id}`);
  return found;
}

beforeEach(() => {
  __setVariants([{ id: 'amb' }]);
});

describe('CREATE_ACTIONS shape', () => {
  it('has unique ids', () => {
    const ids = CREATE_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry has a valid section, callable label/ariaLabel/run, icon, kinds array or null', () => {
    for (const a of CREATE_ACTIONS) {
      expect(['create', 'add', 'share']).toContain(a.section);
      expect(typeof a.label).toBe('function');
      expect(typeof a.ariaLabel).toBe('function');
      expect(typeof a.run).toBe('function');
      expect(a.icon).toBeTruthy();
      expect(a.kinds === null || Array.isArray(a.kinds)).toBe(true);
    }
  });

  it('contains the nine known actions', () => {
    expect(CREATE_ACTIONS.map((a) => a.id)).toEqual([
      'event',
      'calendar',
      'resource',
      'article',
      'wiki',
      'form',
      'poll',
      'bookmark',
      'share'
    ]);
  });

  it('maps content kinds correctly', () => {
    expect(action('event').kinds).toEqual([31922, 31923]);
    expect(action('calendar').kinds).toEqual([31924]);
    expect(action('resource').kinds).toEqual([30142]);
    expect(action('article').kinds).toEqual([30023]);
    expect(action('wiki').kinds).toEqual([30818]);
    expect(action('poll').kinds).toEqual([1068]);
    expect(action('form').kinds).toBeNull();
    expect(action('bookmark').kinds).toBeNull();
    expect(action('share').kinds).toBeNull();
  });
});

describe('CREATE_ACTIONS run(ctx)', () => {
  it('event opens the calendarEvent modal in create mode', () => {
    const ctx = makeCtx('abc');
    action('event').run(ctx);
    expect(ctx.openModal).toHaveBeenCalledWith('calendarEvent', {
      communityPubkey: 'abc',
      selectedDate: expect.any(Date),
      mode: 'create'
    });
  });

  it('calendar opens the createCalendar modal', () => {
    const ctx = makeCtx();
    action('calendar').run(ctx);
    expect(ctx.openModal).toHaveBeenCalledWith('createCalendar');
  });

  it('resource navigates to the default variant in single-variant mode', () => {
    const ctx = makeCtx();
    action('resource').run(ctx);
    expect(ctx.goto).toHaveBeenCalledWith('/create/resource/amb');
    expect(ctx.openVariantPicker).not.toHaveBeenCalled();
  });

  it('resource preserves the community param', () => {
    const ctx = makeCtx('abc');
    action('resource').run(ctx);
    expect(ctx.goto).toHaveBeenCalledWith('/create/resource/amb?community=abc');
  });

  it('resource opens the variant picker (and does not navigate) in multi-variant mode', () => {
    __setVariants([{ id: 'amb' }, { id: 'ekw' }]);
    const ctx = makeCtx();
    action('resource').run(ctx);
    expect(ctx.openVariantPicker).toHaveBeenCalled();
    expect(ctx.goto).not.toHaveBeenCalled();
  });

  it('article navigates to /create/article, preserving community', () => {
    const plain = makeCtx();
    action('article').run(plain);
    expect(plain.goto).toHaveBeenCalledWith('/create/article');

    const community = makeCtx('abc');
    action('article').run(community);
    expect(community.goto).toHaveBeenCalledWith('/create/article?community=abc');
  });

  it('wiki navigates to /create/wiki, preserving community', () => {
    const ctx = makeCtx('abc');
    action('wiki').run(ctx);
    expect(ctx.goto).toHaveBeenCalledWith('/create/wiki?community=abc');
  });

  it('form navigates to /forms/new', () => {
    const ctx = makeCtx();
    action('form').run(ctx);
    expect(ctx.goto).toHaveBeenCalledWith('/forms/new');
  });

  it('poll opens the createPoll modal with communityPubkey only when present', () => {
    const community = makeCtx('abc');
    action('poll').run(community);
    expect(community.openModal).toHaveBeenCalledWith('createPoll', { communityPubkey: 'abc' });

    const plain = makeCtx();
    action('poll').run(plain);
    expect(plain.openModal).toHaveBeenCalledWith('createPoll', {});
  });

  it('bookmark opens the addBookmark modal', () => {
    const ctx = makeCtx('abc');
    action('bookmark').run(ctx);
    expect(ctx.openModal).toHaveBeenCalledWith('addBookmark', { communityPubkey: 'abc' });
  });

  it('share opens the shareByNaddr modal', () => {
    const ctx = makeCtx('abc');
    action('share').run(ctx);
    expect(ctx.openModal).toHaveBeenCalledWith('shareByNaddr', { communityPubkey: 'abc' });
  });
});

describe('filterActionsForCommunity', () => {
  it('returns all actions when there is no community event (fail open)', () => {
    expect(filterActionsForCommunity(CREATE_ACTIONS, null)).toEqual(CREATE_ACTIONS);
    expect(filterActionsForCommunity(CREATE_ACTIONS, undefined)).toEqual(CREATE_ACTIONS);
  });

  it('returns all actions when the community declares no content sections (fail open)', () => {
    const event = makeCommunityEvent([]);
    expect(filterActionsForCommunity(CREATE_ACTIONS, event)).toEqual(CREATE_ACTIONS);
  });

  it('keeps only actions whose kinds intersect the community content kinds, plus context-independent ones', () => {
    const event = makeCommunityEvent([{ name: 'Calendar', kinds: [31922, 31923, 31924, 31925] }]);
    const ids = filterActionsForCommunity(CREATE_ACTIONS, event).map((a) => a.id);
    expect(ids).toEqual(['event', 'calendar', 'form', 'bookmark', 'share']);
  });

  it('matches actions with any of several sections', () => {
    const event = makeCommunityEvent([
      { name: 'Learning', kinds: [30142] },
      { name: 'Articles', kinds: [30023] }
    ]);
    const ids = filterActionsForCommunity(CREATE_ACTIONS, event).map((a) => a.id);
    expect(ids).toEqual(['resource', 'article', 'form', 'bookmark', 'share']);
  });
});

describe('suggestedActionIds', () => {
  it('suggests event on calendar routes', () => {
    expect(suggestedActionIds('/calendar', null, CREATE_ACTIONS)).toEqual(['event']);
  });

  it('suggests resource on discover routes', () => {
    expect(suggestedActionIds('/discover', null, CREATE_ACTIONS)).toEqual(['resource']);
  });

  it('maps community view params to actions', () => {
    expect(suggestedActionIds('/c/[pubkey]', 'learning', CREATE_ACTIONS)).toEqual(['resource']);
    expect(suggestedActionIds('/c/[pubkey]', 'articles', CREATE_ACTIONS)).toEqual(['article']);
    expect(suggestedActionIds('/c/[pubkey]', 'calendar', CREATE_ACTIONS)).toEqual(['event']);
    expect(suggestedActionIds('/c/[pubkey]', 'wikis', CREATE_ACTIONS)).toEqual(['wiki']);
    expect(suggestedActionIds('/c/[pubkey]', 'polls', CREATE_ACTIONS)).toEqual(['poll']);
    expect(suggestedActionIds('/c/[pubkey]', 'social-bookmarks', CREATE_ACTIONS)).toEqual([
      'bookmark'
    ]);
  });

  it('returns no suggestion on unknown routes', () => {
    expect(suggestedActionIds('/settings', null, CREATE_ACTIONS)).toEqual([]);
    expect(suggestedActionIds(null, null, CREATE_ACTIONS)).toEqual([]);
  });

  it('drops suggestions that were filtered out for the community', () => {
    const calendarOnly = makeCommunityEvent([{ name: 'Calendar', kinds: [31923] }]);
    const visible = filterActionsForCommunity(CREATE_ACTIONS, calendarOnly);
    expect(suggestedActionIds('/c/[pubkey]', 'polls', visible)).toEqual([]);
    expect(suggestedActionIds('/c/[pubkey]', 'calendar', visible)).toEqual(['event']);
  });
});
