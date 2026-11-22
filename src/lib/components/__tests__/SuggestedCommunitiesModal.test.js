// @ts-nocheck
/**
 * SuggestedCommunitiesModal — Termi's setup message offers the deployment's
 * suggested communities: pre-selected like the signup step, joined in one
 * kind 30000 update, closed on success.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const closeModalMock = vi.hoisted(() => vi.fn());
const joinMock = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const toastMock = vi.hoisted(() => vi.fn());
const suggested = vi.hoisted(() => ({ value: [] }));

vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: { closeModal: closeModalMock } }));
vi.mock('$lib/helpers/community.js', () => ({ joinCommunities: joinMock }));
vi.mock('$lib/helpers/toast', () => ({ showToast: toastMock }));
vi.mock('$lib/loaders/community.js', () => ({
  communikeyTimelineLoader: () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })
}));
// The picker's community list stays empty: only the modal's own logic runs.
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { model: () => ({ subscribe: (cb) => (cb([]), { unsubscribe: vi.fn() }) }) }
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get signup() {
      return { suggestedCommunities: suggested.value };
    }
  }
}));
vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'auth_signup_modal_step3_browse_heading',
      'auth_signup_modal_step3_no_matches',
      'auth_signup_modal_step3_search_placeholder',
      'auth_signup_modal_step3_subtitle',
      'auth_signup_modal_step3_suggested_heading',
      'suggested_communities_modal_failed',
      'suggested_communities_modal_join',
      'suggested_communities_modal_lead',
      'suggested_communities_modal_skip',
      'suggested_communities_modal_title'
    ].map((k) => [k, () => k])
  )
);

import SuggestedCommunitiesModal from '../SuggestedCommunitiesModal.svelte';

beforeEach(() => {
  vi.clearAllMocks();
  suggested.value = [];
});

describe('SuggestedCommunitiesModal', () => {
  it('joins the pre-selected suggested communities in one update and closes', async () => {
    suggested.value = [A, B];
    const { getByTestId } = render(SuggestedCommunitiesModal);
    await fireEvent.click(getByTestId('suggested-communities-join'));
    expect(joinMock).toHaveBeenCalledTimes(1);
    expect(joinMock.mock.calls[0][0].toSorted()).toEqual([A, B]);
    await vi.waitFor(() => expect(closeModalMock).toHaveBeenCalled());
  });

  it('keeps the join button disabled while nothing is selected', () => {
    const { getByTestId } = render(SuggestedCommunitiesModal);
    expect(getByTestId('suggested-communities-join').disabled).toBe(true);
  });

  it('stays open and says so when joining fails', async () => {
    suggested.value = [A];
    joinMock.mockResolvedValueOnce({ success: false, error: 'relay said no' });
    const { getByTestId } = render(SuggestedCommunitiesModal);
    await fireEvent.click(getByTestId('suggested-communities-join'));
    await vi.waitFor(() => expect(toastMock).toHaveBeenCalledWith('relay said no', 'error'));
    expect(closeModalMock).not.toHaveBeenCalled();
  });
});
