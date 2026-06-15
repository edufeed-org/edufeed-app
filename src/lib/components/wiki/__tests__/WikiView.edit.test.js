// @ts-nocheck
/**
 * WikiView edit-action wiring tests.
 *
 * The author of a published wiki article must get an edit affordance that
 * navigates to the wiki editor in edit mode (/create/wiki?edit=<naddr>).
 * Non-authors must not see edit or delete actions. The heavy DetailHeader is
 * replaced with a test double that exposes the onEdit/onDelete handlers as
 * buttons; all network/store dependencies are stubbed.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const AUTHOR = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

const gotoMock = vi.fn();
let activeUserPubkey = AUTHOR;

vi.mock('$app/navigation', () => ({ goto: (...args) => gotoMock(...args) }));
vi.mock('$app/paths', () => ({ resolve: (path) => path }));

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  encodeEventToNaddr: () => 'naddr1wikitest'
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => (activeUserPubkey ? { pubkey: activeUserPubkey } : null)
}));

vi.mock('$lib/helpers/eventDeletion.js', () => ({ deleteEvent: vi.fn() }));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('$lib/helpers/wikiContent.js', () => ({ renderWikiContent: () => Promise.resolve('') }));
vi.mock('$lib/helpers/calendar.js', () => ({ formatCalendarDate: () => 'date' }));

vi.mock('$lib/loaders/event-highlights.js', () => ({
  loadEventHighlights: () => ({ loader: () => {}, cleanup: () => {} })
}));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { model: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) }
}));

vi.mock('applesauce-core/models', () => ({ TimelineModel: {} }));

vi.mock('$lib/paraglide/messages', () => ({
  default: {},
  wiki_view_delete_success: () => 'deleted',
  wiki_view_delete_failed: () => 'delete failed',
  wiki_view_delete_confirm_title: () => 'Delete wiki?',
  wiki_view_comments: () => 'Comments'
}));

// Replace heavy sub-components with no-op / introspectable doubles.
vi.mock('../../shared/DetailHeader.svelte', () => import('./DetailHeaderMock.svelte'));
vi.mock('../../shared/HighlightOverlay.svelte', () => ({ default: () => ({}) }));
vi.mock('../../reactions/ReactionBar.svelte', () => ({ default: () => ({}) }));
vi.mock('../../comments/CommentList.svelte', () => ({ default: () => ({}) }));
vi.mock('../../calendar/EventTags.svelte', () => ({ default: () => ({}) }));

import WikiView from '../WikiView.svelte';

/** @param {string} pubkey */
function wikiEvent(pubkey) {
  return {
    id: 'wiki-id',
    kind: 30818,
    pubkey,
    created_at: 1700000000,
    content: 'hello',
    tags: [
      ['d', 'my-topic'],
      ['title', 'My Wiki']
    ],
    sig: 'c'.repeat(128)
  };
}

describe('WikiView edit action', () => {
  beforeEach(() => {
    gotoMock.mockClear();
    activeUserPubkey = AUTHOR;
  });

  it('shows an edit action to the author that navigates to the wiki editor', async () => {
    const { getByTestId } = render(WikiView, { props: { event: wikiEvent(AUTHOR) } });

    const editBtn = getByTestId('edit-action');
    await fireEvent.click(editBtn);

    expect(gotoMock).toHaveBeenCalledTimes(1);
    expect(gotoMock).toHaveBeenCalledWith('/create/wiki?edit=naddr1wikitest');
  });

  it('does not show edit or delete actions to a non-author', () => {
    activeUserPubkey = OTHER;
    const { queryByTestId } = render(WikiView, { props: { event: wikiEvent(AUTHOR) } });

    expect(queryByTestId('edit-action')).toBeNull();
    expect(queryByTestId('delete-action')).toBeNull();
  });
});
