/** @vitest-environment jsdom */
/**
 * SectionOverridePane — "Inhalte & Rechte" for root-group admins, who hold no
 * community key and therefore publish a kind-30223 section override instead
 * of editing the 10222. What matters here is the wiring: the pane seeds from
 * the community's effective sections, and saving emits ONE override carrying
 * the whole block.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';

const OWNER = 'a'.repeat(64);
const ADMIN = 'b'.repeat(64);
const GROUPS_RELAY = 'wss://groups.example/';

const { activeUser, publishSectionOverride, showToast } = vi.hoisted(() => ({
  activeUser: { pubkey: 'b'.repeat(64), signEvent: vi.fn(async (/** @type {any} */ t) => t) },
  publishSectionOverride: vi.fn(
    async (
      /** @type {string} */ _communityPubkey,
      /** @type {any[]} */ _sections,
      /** @type {any} */ _account,
      /** @type {any} */ _communityEvent
    ) => ({ id: 'signed' })
  ),
  showToast: vi.fn()
}));

vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => activeUser }));
vi.mock('$lib/helpers/publishSectionOverride.js', () => ({ publishSectionOverride }));
vi.mock('$lib/helpers/toast', () => ({ showToast }));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => ({ name: 'Anna Admin' })
}));
vi.mock('$lib/paraglide/messages', () => ({
  community_access_editor_title: () => 'Inhalte & Rechte',
  community_access_editor_save: () => 'Speichern',
  community_access_editor_saved: () => 'Gespeichert.',
  community_access_editor_save_failed: (/** @type {{reason: string}} */ p) => `Fehler: ${p.reason}`,
  community_access_editor_role_placeholder: () => 'Rolle',
  community_access_editor_role_required: () => 'Rolle erforderlich',
  community_access_all: () => 'Alle',
  community_access_members: () => 'Nur Mitglieder',
  community_access_publisher: () => 'Nur Publisher',
  community_access_role: () => 'Rolle',
  community_section_override_lead: () => 'Als Admin legst du fest…',
  community_section_override_by: (/** @type {{name: string}} */ p) =>
    `Zuletzt geändert von ${p.name}`,
  create_community_modal_content_types_label: () => 'Inhaltstypen',
  create_community_modal_content_types_alt: () => 'Auswahl',
  create_community_modal_content_calendar: () => 'Kalender',
  create_community_modal_content_chat: () => 'Chat',
  create_community_modal_content_articles: () => 'Artikel',
  create_community_modal_content_posts: () => 'Forum',
  create_community_modal_content_wikis: () => 'Wikis',
  create_community_modal_content_learning: () => 'Materialien',
  create_community_modal_content_polls: () => 'Umfragen',
  create_community_modal_content_bookmarks: () => 'Lesezeichen',
  create_community_modal_content_meet: () => 'Meet'
}));

const { default: SectionOverridePane } = await import(
  '$lib/components/community/settings/SectionOverridePane.svelte'
);

/** Learning gated on publisher, Calendar open. */
const communikeyEvent = {
  kind: 10222,
  pubkey: OWNER,
  id: 'evt1',
  created_at: 1000,
  content: '',
  tags: [
    ['membership', 'root1', GROUPS_RELAY],
    ['strict', 'content'],
    ['content', 'Learning'],
    ['k', '30142'],
    ['access', 'role', 'publisher'],
    ['content', 'Calendar'],
    ['k', '31923']
  ]
};

beforeEach(() => {
  publishSectionOverride.mockClear();
  publishSectionOverride.mockResolvedValue({ id: 'signed' });
  showToast.mockClear();
});

describe('SectionOverridePane', () => {
  it('seeds a row per declared section, with the section’s current tier selected', async () => {
    render(SectionOverridePane, { props: { communikeyEvent } });
    await tick();

    const learning = screen.getByTestId('section-override-row-learning');
    expect(/** @type {HTMLSelectElement} */ (learning.querySelector('select')).value).toBe(
      'publisher'
    );
    const calendar = screen.getByTestId('section-override-row-calendar');
    expect(/** @type {HTMLSelectElement} */ (calendar.querySelector('select')).value).toBe('all');
    // Undeclared types get no row.
    expect(screen.queryByTestId('section-override-row-wikis')).toBeNull();
  });

  it('publishes ONE override carrying every enabled section, not just the edited one', async () => {
    render(SectionOverridePane, { props: { communikeyEvent } });
    await tick();

    const calendar = screen.getByTestId('section-override-row-calendar');
    await fireEvent.change(/** @type {Element} */ (calendar.querySelector('select')), {
      target: { value: 'members' }
    });
    await fireEvent.click(screen.getByTestId('section-override-save'));

    await waitFor(() => expect(publishSectionOverride).toHaveBeenCalledTimes(1));
    const [communityPubkey, sections, account] = publishSectionOverride.mock.calls[0];
    expect(communityPubkey).toBe(OWNER);
    expect(account).toBe(activeUser);
    expect(sections).toEqual([
      { name: 'Calendar', kinds: [31922, 31923, 31924], access: { tier: 'members' } },
      { name: 'Learning', kinds: [30142], access: { tier: 'role', role: 'publisher' } }
    ]);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Gespeichert.', 'success'));
  });

  it('a blank free-text role blocks the save rather than publishing an open section', async () => {
    // An ["access","role",""] tag parses back as tier 'all' — publishing it
    // would silently un-gate the section instead of gating it.
    render(SectionOverridePane, { props: { communikeyEvent } });
    await tick();

    const learning = screen.getByTestId('section-override-row-learning');
    await fireEvent.change(/** @type {Element} */ (learning.querySelector('select')), {
      target: { value: 'role' }
    });
    await tick();

    // Switching publisher → Rolle seeds the box with the role it already had,
    // so the blank state is one the user has to type themselves.
    const roleInput = /** @type {HTMLInputElement} */ (
      learning.querySelector('input[type="text"]')
    );
    expect(roleInput.value).toBe('publisher');
    await fireEvent.input(roleInput, { target: { value: '   ' } });
    await tick();

    expect(screen.getByTestId('section-override-role-required-learning')).toBeTruthy();
    const saveBtn = /** @type {HTMLButtonElement} */ (screen.getByTestId('section-override-save'));
    expect(saveBtn.disabled).toBe(true);
    await fireEvent.click(saveBtn);
    expect(publishSectionOverride).not.toHaveBeenCalled();
  });

  it('surfaces a failed publish instead of pretending it saved', async () => {
    publishSectionOverride.mockRejectedValueOnce(new Error('relay rejected'));
    render(SectionOverridePane, { props: { communikeyEvent } });
    await tick();

    await fireEvent.click(screen.getByTestId('section-override-save'));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('relay rejected'), 'error')
    );
  });

  it('names the admin whose override is currently in effect', async () => {
    render(SectionOverridePane, { props: { communikeyEvent, overrideAuthor: ADMIN } });
    expect((await screen.findByTestId('section-override-provenance')).textContent).toContain(
      'Anna Admin'
    );
  });

  it('shows no provenance line while the owner’s own sections are in effect', async () => {
    render(SectionOverridePane, { props: { communikeyEvent, overrideAuthor: null } });
    await tick();
    expect(screen.queryByTestId('section-override-provenance')).toBeNull();
  });
});
