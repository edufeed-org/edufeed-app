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
import { tick } from 'svelte';
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

/** Same as communikeyEvent but Calendar's `access members` tag is gone (tier
 * now 'all') — simulates a different row's own save (or any external
 * update) round-tripping through EventStore into a fresh prop. */
const updatedEvent = {
  kind: 10222,
  pubkey: OWNER,
  created_at: 1001,
  content: 'desc',
  tags: [
    ['membership', 'rootgroup1', GROUPS_RELAY],
    ['content', 'Learning'],
    ['k', '30142'],
    ['access', 'role', 'lehrkraft'],
    ['content', 'Calendar'],
    ['k', '31923'],
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

  it('role tier with an empty role disables save, shows the required hint, and never publishes', async () => {
    render(AccessTierEditor, {
      props: { communikeyEvent, communitySigner, roleSuggestions: [] }
    });

    const calendarRow = await screen.findByTestId('access-tier-row-Calendar');
    await fireEvent.change(within(calendarRow).getByRole('combobox', { name: 'Calendar' }), {
      target: { value: 'role' }
    });

    const saveButton = /** @type {HTMLButtonElement} */ (
      within(calendarRow).getByTestId('access-tier-save-Calendar')
    );
    expect(saveButton.disabled).toBe(true);
    expect(within(calendarRow).getByTestId('access-tier-role-required-Calendar')).toBeTruthy();

    await fireEvent.click(saveButton);
    expect(publishCommunityUpdate).not.toHaveBeenCalled();
  });

  it('preserves a dirty draft in one row when the communikeyEvent prop updates from another row saving', async () => {
    const { rerender } = render(AccessTierEditor, {
      props: { communikeyEvent, communitySigner, roleSuggestions: [] }
    });

    const learningRow = await screen.findByTestId('access-tier-row-Learning');
    const roleInput = /** @type {HTMLInputElement} */ (
      learningRow.querySelector('input[type="text"]')
    );
    await fireEvent.input(roleInput, { target: { value: 'schulleitung' } });
    expect(roleInput.value).toBe('schulleitung');

    // Simulate Calendar's own save round-tripping through EventStore: the
    // prop changes, Calendar's tier flips to 'all' in the new event, but
    // Learning's unsaved edit above must survive the refresh.
    await rerender({ communikeyEvent: updatedEvent, communitySigner, roleSuggestions: [] });
    await tick();

    const learningRowAfter = screen.getByTestId('access-tier-row-Learning');
    const roleInputAfter = /** @type {HTMLInputElement} */ (
      learningRowAfter.querySelector('input[type="text"]')
    );
    expect(roleInputAfter.value).toBe('schulleitung');

    const calendarRow = screen.getByTestId('access-tier-row-Calendar');
    expect(
      /** @type {HTMLSelectElement} */ (
        within(calendarRow).getByRole('combobox', { name: 'Calendar' })
      ).value
    ).toBe('all');
  });

  it('whitespace-only role edits do not leave the row permanently dirty after a save round-trip', async () => {
    const { rerender } = render(AccessTierEditor, {
      props: { communikeyEvent, communitySigner, roleSuggestions: [] }
    });

    const learningRow = await screen.findByTestId('access-tier-row-Learning');
    const roleInput = /** @type {HTMLInputElement} */ (
      learningRow.querySelector('input[type="text"]')
    );
    // Same value as the baseline ('lehrkraft'), just padded — a whitespace-only
    // diff, not a real edit.
    await fireEvent.input(roleInput, { target: { value: '  lehrkraft  ' } });
    expect(roleInput.value).toBe('  lehrkraft  ');

    // Simulate the round-trip after a save (own or another row's) publishes
    // and the communikeyEvent prop refreshes with the same (trimmed) role.
    const sameRoleEvent = {
      ...communikeyEvent,
      created_at: communikeyEvent.created_at + 1,
      tags: communikeyEvent.tags.map((t) => [...t])
    };
    await rerender({ communikeyEvent: sameRoleEvent, communitySigner, roleSuggestions: [] });
    await tick();

    // Not dirty → the draft resets to `fresh` (trimmed 'lehrkraft'), proving
    // the whitespace-padded edit didn't get stuck as a permanent diff.
    const roleInputAfter = /** @type {HTMLInputElement} */ (
      screen.getByTestId('access-tier-row-Learning').querySelector('input[type="text"]')
    );
    expect(roleInputAfter.value).toBe('lehrkraft');
  });

  it('dedupes a duplicated section name so it renders one row instead of crashing (each_key_duplicate)', async () => {
    const duplicatedEvent = {
      kind: 10222,
      pubkey: OWNER,
      created_at: 1000,
      content: 'desc',
      tags: [
        ['content', 'Learning'],
        ['k', '30142'],
        ['access', 'role', 'lehrkraft'],
        ['content', 'Learning'],
        ['k', '31923']
      ]
    };

    expect(() =>
      render(AccessTierEditor, {
        props: { communikeyEvent: duplicatedEvent, communitySigner, roleSuggestions: [] }
      })
    ).not.toThrow();

    const rows = await screen.findAllByTestId('access-tier-row-Learning');
    expect(rows).toHaveLength(1);
  });

  // `publisher` is an ordinary NIP-29 role on the wire — the select just spares
  // an admin from typing the magic word, and has to round-trip an existing
  // publisher gate back into that option rather than into the free-text row.
  describe('publisher tier', () => {
    const publisherEvent = {
      kind: 10222,
      pubkey: OWNER,
      created_at: 1000,
      content: 'desc',
      tags: [
        ['membership', 'rootgroup1', GROUPS_RELAY],
        ['content', 'Learning'],
        ['k', '30142'],
        ['access', 'role', 'publisher'],
        ['content', 'Forum'],
        ['k', '11']
      ]
    };

    it('an existing publisher gate selects the publisher option, not free-text role', async () => {
      render(AccessTierEditor, {
        props: { communikeyEvent: publisherEvent, communitySigner, roleSuggestions: [] }
      });
      await tick();

      const row = screen.getByTestId('access-tier-row-Learning');
      const select = /** @type {HTMLSelectElement} */ (row.querySelector('select'));
      expect(select.value).toBe('publisher');
      // No free-text role input while the publisher option is selected.
      expect(row.querySelector('input[type="text"]')).toBeNull();
    });

    it('choosing publisher saves an access role publisher tag', async () => {
      render(AccessTierEditor, {
        props: { communikeyEvent, communitySigner, roleSuggestions: [] }
      });
      await tick();

      const row = screen.getByTestId('access-tier-row-Forum');
      const select = /** @type {HTMLSelectElement} */ (row.querySelector('select'));
      await fireEvent.change(select, { target: { value: 'publisher' } });
      await fireEvent.click(within(row).getByTestId('access-tier-save-Forum'));

      await waitFor(() => expect(publishCommunityUpdate).toHaveBeenCalled());
      const template = publishCommunityUpdate.mock.calls[0][0];
      const sections = parseCommunityContentTypes({ ...template, pubkey: OWNER });
      expect(findSection(sections, 'Forum').access).toEqual({ tier: 'role', role: 'publisher' });
      // Sibling sections untouched by the surgical edit.
      expect(findSection(sections, 'Learning').access).toEqual({
        tier: 'role',
        role: 'lehrkraft'
      });
    });

    it('the publisher option never leaves a blank-role gate behind', async () => {
      render(AccessTierEditor, {
        props: { communikeyEvent, communitySigner, roleSuggestions: [] }
      });
      await tick();

      const row = screen.getByTestId('access-tier-row-Forum');
      const select = /** @type {HTMLSelectElement} */ (row.querySelector('select'));
      await fireEvent.change(select, { target: { value: 'publisher' } });
      await tick();

      // The blank-role guard belongs to the free-text tier only — publisher
      // carries its own role, so the save button must stay enabled.
      const saveBtn = /** @type {HTMLButtonElement} */ (
        within(row).getByTestId('access-tier-save-Forum')
      );
      expect(saveBtn.disabled).toBe(false);
      expect(row.querySelector('[data-testid="access-tier-role-required-Forum"]')).toBeNull();
    });
  });
});
