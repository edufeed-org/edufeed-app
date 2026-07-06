/**
 * Declarative registry of content-creation actions for the global FAB.
 * Adding a new content type = adding one entry here; the FAB renders whatever
 * this registry contains. Side effects go exclusively through the injected
 * context so entries stay unit-testable outside Svelte.
 */
import * as m from '$lib/paraglide/messages';
import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';
import {
  CalendarIcon,
  Calendar3Icon,
  GraduationCapIcon,
  ArticleIcon,
  BookIcon,
  ScrollTextIcon,
  PollIcon,
  BookmarkIcon,
  RepostIcon
} from '$lib/components/icons';
import { getEnabledVariants, getDefaultVariantId } from '$lib/config/resource-form-variants.js';

/**
 * @typedef {Object} CreateActionContext
 * @property {string} communityPubkey - Hex pubkey of the current community, or '' outside community routes
 * @property {(name: string, props?: Object) => void} openModal
 * @property {(url: string) => void} goto
 * @property {(path: string) => string} resolve
 * @property {() => void} openVariantPicker - Opens the resource variant picker (multi-variant deployments)
 */

/**
 * @typedef {Object} CreateAction
 * @property {string} id
 * @property {'create'|'add'|'share'} section
 * @property {number[]|null} kinds - Nostr kinds this action produces; null = context-independent (never filtered)
 * @property {() => string} label
 * @property {() => string} ariaLabel
 * @property {(() => string) | undefined} [description] - Tooltip text disambiguating similar actions
 * @property {any} icon - Svelte icon component
 * @property {(ctx: CreateActionContext) => void} run
 */

/**
 * @param {string} path
 * @param {CreateActionContext} ctx
 */
function withCommunity(path, ctx) {
  return ctx.communityPubkey ? `${path}?community=${ctx.communityPubkey}` : path;
}

/** @type {CreateAction[]} */
export const CREATE_ACTIONS = [
  {
    id: 'event',
    section: 'create',
    kinds: [31922, 31923],
    label: m.fab_create_event,
    ariaLabel: m.fab_create_event_aria,
    description: m.fab_create_event_desc,
    icon: CalendarIcon,
    run(ctx) {
      ctx.openModal('calendarEvent', {
        communityPubkey: ctx.communityPubkey,
        selectedDate: new Date(),
        mode: 'create'
      });
    }
  },
  {
    id: 'calendar',
    section: 'create',
    kinds: [31924],
    label: m.fab_create_calendar,
    ariaLabel: m.fab_create_calendar_aria,
    description: m.fab_create_calendar_desc,
    icon: Calendar3Icon,
    run(ctx) {
      ctx.openModal('createCalendar');
    }
  },
  {
    id: 'resource',
    section: 'create',
    kinds: [30142],
    label: m.fab_create_resource,
    ariaLabel: m.fab_create_resource_aria,
    icon: GraduationCapIcon,
    run(ctx) {
      // Single-variant deployments skip the picker and navigate directly.
      if (getEnabledVariants().length <= 1) {
        ctx.goto(ctx.resolve(withCommunity(`/create/resource/${getDefaultVariantId()}`, ctx)));
        return;
      }
      ctx.openVariantPicker();
    }
  },
  {
    id: 'article',
    section: 'create',
    kinds: [30023],
    label: m.article_fab_write,
    ariaLabel: m.article_fab_write,
    icon: ArticleIcon,
    run(ctx) {
      ctx.goto(ctx.resolve(withCommunity('/create/article', ctx)));
    }
  },
  {
    id: 'wiki',
    section: 'create',
    kinds: [30818],
    label: m.wiki_fab_write,
    ariaLabel: m.wiki_fab_write,
    icon: BookIcon,
    run(ctx) {
      ctx.goto(ctx.resolve(withCommunity('/create/wiki', ctx)));
    }
  },
  {
    id: 'form',
    section: 'create',
    kinds: null,
    label: m.fab_create_form,
    ariaLabel: m.fab_create_form,
    icon: ScrollTextIcon,
    run(ctx) {
      ctx.goto(ctx.resolve('/forms/new'));
    }
  },
  {
    id: 'poll',
    section: 'create',
    kinds: [1068],
    label: m.fab_create_poll,
    ariaLabel: m.fab_create_poll_aria,
    icon: PollIcon,
    run(ctx) {
      ctx.openModal(
        'createPoll',
        ctx.communityPubkey ? { communityPubkey: ctx.communityPubkey } : {}
      );
    }
  },
  {
    id: 'bookmark',
    section: 'add',
    kinds: null,
    label: m.fab_add_bookmark,
    ariaLabel: m.fab_add_bookmark,
    description: m.fab_add_bookmark_desc,
    icon: BookmarkIcon,
    run(ctx) {
      ctx.openModal('addBookmark', { communityPubkey: ctx.communityPubkey });
    }
  },
  {
    id: 'share',
    section: 'share',
    kinds: null,
    label: m.fab_share_existing,
    ariaLabel: m.fab_share_existing_aria,
    description: m.fab_share_existing_desc,
    icon: RepostIcon,
    run(ctx) {
      ctx.openModal('shareByNaddr', { communityPubkey: ctx.communityPubkey });
    }
  }
];

/**
 * Filter actions by a community's allowed content kinds (kind 10222 content sections).
 * Fails open: with no community event or no declared content sections, everything is shown.
 * Entries with kinds === null are context-independent and never filtered.
 * @param {CreateAction[]} actions
 * @param {import('nostr-tools').Event | null | undefined} communityEvent
 * @returns {CreateAction[]}
 */
export function filterActionsForCommunity(actions, communityEvent) {
  if (!communityEvent) return actions;

  const allowed = new Set();
  for (const section of parseCommunityContentTypes(communityEvent)) {
    for (const kind of section.kinds) allowed.add(kind);
  }
  if (allowed.size === 0) return actions;

  return actions.filter((a) => a.kinds === null || a.kinds.some((k) => allowed.has(k)));
}

/** Community `?view=` param (or dashboard content view) → suggested action id */
const VIEW_TO_ACTION = {
  calendar: 'event',
  learning: 'resource',
  articles: 'article',
  wikis: 'wiki',
  polls: 'poll',
  'social-bookmarks': 'bookmark'
};

/**
 * Pick contextual suggestions for the current screen. Returns at most 2 action ids,
 * restricted to the currently visible actions so community filtering still applies.
 * @param {string | null | undefined} routeId - SvelteKit route id (e.g. '/calendar/[view]')
 * @param {string | null | undefined} viewParam - Community `?view=` param
 * @param {CreateAction[]} visibleActions
 * @returns {string[]}
 */
export function suggestedActionIds(routeId, viewParam, visibleActions) {
  /** @type {string[]} */
  const ids = [];

  if (viewParam && viewParam in VIEW_TO_ACTION) {
    ids.push(VIEW_TO_ACTION[/** @type {keyof typeof VIEW_TO_ACTION} */ (viewParam)]);
  } else if (routeId?.startsWith('/calendar')) {
    ids.push('event');
  } else if (routeId?.startsWith('/discover')) {
    ids.push('resource');
  }

  const visible = new Set(visibleActions.map((a) => a.id));
  return ids.filter((id) => visible.has(id)).slice(0, 2);
}
