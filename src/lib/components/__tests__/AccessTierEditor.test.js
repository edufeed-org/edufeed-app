/** @vitest-environment jsdom */
/**
 * AccessTierEditor — Task 7. Per-section access tier editor for moderated
 * communities: one row per `content` section (from parseCommunityContentTypes),
 * a tier select (all/members/role) + role text input, and a per-row save that
 * surgically edits just that section via withSectionAccess/communityUpdateTemplate.
 * withSectionAccess itself is unit-tested elsewhere; this only proves the wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';

const OWNER = 'a'.repeat(64);
const GROUPS_RELAY = 'wss://groups.example/';

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast', () => ({ showToast: toastSpy }));

const publishCommunityUpdate = vi.hoisted(() => vi.fn(async (template) => template));
vi.mock('$lib/helpers/publishCommunityUpdate.js', () => ({ publishCommunityUpdate }));

const { default: AccessTierEditor } = await import(
  '$lib/components/community/settings/AccessTierEditor.svelte'
);

/** Learning=role lehrkraft, Calendar=members, Forum=ungated (all). */
const communikeyEvent = {
  kind: 10222,
  pubkey: OWNER,
  created_at: 1000,
  content: 'desc',
  tags: [
    ['membership', 'rootgroup1', GROUPS_RELAY],
    ['content', 'Learning'],
    ['k', '30142'],
    ['access', 'role', 'lehrkraft'],
    ['content', 'Calendar'],
    ['k', '31923'],
    ['access', 'members'],
    ['content', 'Forum'],
    ['k', '11']
  ]
};

const communitySigner = { signEvent: vi.fn(async (t) => ({ ...t, id: 'sig', pubkey: OWNER })) };

/** @param {any[]} sections @param {string} name */
function findSection(sections, name) {
  const found = sections.find((/** @type {any} */ s) => s.name === name);
  if (!found) throw new Error(`section ${name} not found`);
  return found;
}

beforeEach(() => {
  toastSpy.mockClear();
  publishCommunityUpdate.mockClear();
  communitySigner.signEvent.mockClear();
});

describe('AccessTierEditor', () => {
  it('renders one row per section with the current tier preselected', async () => {
    render(AccessTierEditor, {
      props: { communikeyEvent, communitySigner, roleSuggestions: [] }
    });

    const learningRow = await screen.findByTestId('access-tier-row-Learning');
    const calendarRow = screen.getByTestId('access-tier-row-Calendar');
    const forumRow = screen.getByTestId('access-tier-row-Forum');

    // The select and the role text input both carry an implicit ARIA
    // "combobox" role (the input via its `list`/datalist attribute), so
    // disambiguate the select by its accessible name (aria-label=
    // {section.name}) and reach the role input via a plain DOM query.
    expect(
      /** @type {HTMLSelectElement} */ (
        within(learningRow).getByRole('combobox', { name: 'Learning' })
      ).value
    ).toBe('role');
    expect(
      /** @type {HTMLInputElement} */ (learningRow.querySelector('input[type="text"]')).value
    ).toBe('lehrkraft');

    expect(
      /** @type {HTMLSelectElement} */ (
        within(calendarRow).getByRole('combobox', { name: 'Calendar' })
      ).value
    ).toBe('members');
    expect(calendarRow.querySelector('input[type="text"]')).toBeNull();

    expect(
      /** @type {HTMLSelectElement} */ (within(forumRow).getByRole('combobox', { name: 'Forum' }))
        .value
    ).toBe('all');
    expect(forumRow.querySelector('input[type="text"]')).toBeNull();
  });

  it('saving Learning (role/lehrkraft) publishes a template with Learning=role/lehrkraft and Calendar untouched', async () => {
    render(AccessTierEditor, {
      props: { communikeyEvent, communitySigner, roleSuggestions: [] }
    });

    const learningRow = await screen.findByTestId('access-tier-row-Learning');
    await fireEvent.click(within(learningRow).getByTestId('access-tier-save-Learning'));

    await waitFor(() => expect(publishCommunityUpdate).toHaveBeenCalledOnce());
    const [template] = /** @type {any[]} */ (publishCommunityUpdate.mock.calls[0]);
    const sections = parseCommunityContentTypes(template);
    expect(findSection(sections, 'Learning').access).toEqual({
      tier: 'role',
      role: 'lehrkraft'
    });
    expect(findSection(sections, 'Calendar').access).toEqual({
      tier: 'members'
    });
    expect(toastSpy).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('switching Calendar to "all" and saving removes its access tag', async () => {
    render(AccessTierEditor, {
      props: { communikeyEvent, communitySigner, roleSuggestions: [] }
    });

    const calendarRow = await screen.findByTestId('access-tier-row-Calendar');
    await fireEvent.change(within(calendarRow).getByRole('combobox', { name: 'Calendar' }), {
      target: { value: 'all' }
    });
    await fireEvent.click(within(calendarRow).getByTestId('access-tier-save-Calendar'));

    await waitFor(() => expect(publishCommunityUpdate).toHaveBeenCalledOnce());
    const [template] = /** @type {any[]} */ (publishCommunityUpdate.mock.calls[0]);
    const sections = parseCommunityContentTypes(template);
    expect(findSection(sections, 'Calendar').access).toEqual({
      tier: 'all'
    });
    // Learning untouched by the Calendar-row save.
    expect(findSection(sections, 'Learning').access).toEqual({
      tier: 'role',
      role: 'lehrkraft'
    });
    const calendarAccessTag = template.tags.find(
      (/** @type {string[]} */ t, /** @type {number} */ i) =>
        t[0] === 'access' &&
        template.tags
          .slice(0, i)
          .reverse()
          .find((/** @type {string[]} */ t2) => t2[0] === 'content')?.[1] === 'Calendar'
    );
    expect(calendarAccessTag).toBeUndefined();
  });

  it('shows a toast on publish failure and re-enables the save button', async () => {
    publishCommunityUpdate.mockRejectedValueOnce(new Error('relay down'));
    render(AccessTierEditor, {
      props: { communikeyEvent, communitySigner, roleSuggestions: [] }
    });

    const learningRow = await screen.findByTestId('access-tier-row-Learning');
    const saveButton = /** @type {HTMLButtonElement} */ (
      within(learningRow).getByTestId('access-tier-save-Learning')
    );
    await fireEvent.click(saveButton);

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('relay down'), 'error')
    );
    expect(saveButton.disabled).toBe(false);
  });
});
