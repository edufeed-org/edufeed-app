/** @vitest-environment jsdom */
/**
 * MembershipPane — Task 8. Root-group roster management (counts + a
 * "Mitglieder verwalten" button wired to GroupMembersModal via the roster
 * hook) and application-form management (select/save/remove/create-default
 * a kind 30168 template referenced by the community's `application` tag).
 * useRootRoster/useFormTemplates/GroupMembersModal internals are covered by
 * their own suites; this only proves the wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { parseApplicationRef } from '$lib/groups/community-membership.js';

const OWNER = 'a'.repeat(64);
const ADMIN2 = 'b'.repeat(64);
const MEMBER = 'c'.repeat(64);
const GROUPS_RELAY = 'wss://groups.example/';
const COMMUNIKEY_RELAY = 'wss://communikey.example/';

// vi.mock factories are hoisted above these consts, so anything a factory
// closes over must be built via vi.hoisted() (TDZ, same as
// GroupMembersModal.test.js's header comment explains).
const {
  rosterFixture,
  activeUserFixture,
  communitySigner,
  isCommunityOwner,
  getCommunitySigner,
  formTemplateFixture,
  publishCommunityUpdate,
  publishEvent,
  eventStoreAdd,
  showToast,
  publishToGroupRelay
} = vi.hoisted(() => {
  const OWNER = 'a'.repeat(64);
  const ADMIN2 = 'b'.repeat(64);
  const MEMBER = 'c'.repeat(64);
  const GROUPS_RELAY = 'wss://groups.example/';
  return {
    rosterFixture: /** @type {{ value: any }} */ ({
      value: {
        pointer: { id: 'root1', relay: GROUPS_RELAY },
        refresh: vi.fn(),
        admins: [
          { pubkey: OWNER, roles: ['admin'] },
          { pubkey: ADMIN2, roles: ['lehrkraft'] }
        ],
        members: new Set([OWNER, ADMIN2, MEMBER]),
        isLoading: false,
        isMember: () => true,
        rolesOf: () => []
      }
    }),
    activeUserFixture: /** @type {{ value: any }} */ ({ value: { pubkey: OWNER, signer: {} } }),
    communitySigner: { signEvent: vi.fn(async (t) => ({ ...t, id: 'sig', pubkey: OWNER })) },
    isCommunityOwner: vi.fn(() => true),
    getCommunitySigner: vi.fn(() => communitySigner),
    formTemplateFixture: {
      kind: 30168,
      pubkey: OWNER,
      tags: [
        ['d', 'membership'],
        ['name', 'Standard-Formular']
      ]
    },
    publishCommunityUpdate: vi.fn(async (template) => template),
    publishEvent: vi.fn(async () => {}),
    eventStoreAdd: vi.fn(),
    showToast: vi.fn(),
    publishToGroupRelay: vi.fn(async () => ({}))
  };
});

const { poolMock } = vi.hoisted(() => {
  return {
    poolMock: {
      relay: vi.fn((_url) => ({
        publish: vi.fn(async () => ({ ok: true }))
      }))
    }
  };
});

vi.mock('$lib/groups/root-roster.svelte.js', () => ({
  useRootRoster: () => () => rosterFixture.value
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => activeUserFixture.value
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: eventStoreAdd },
  pool: poolMock
}));
vi.mock('$lib/helpers/community-signer.js', () => ({ getCommunitySigner, isCommunityOwner }));
vi.mock('$lib/stores/form-templates.svelte.js', () => ({
  useFormTemplates: () => () => [formTemplateFixture]
}));
vi.mock('$lib/helpers/publishCommunityUpdate.js', () => ({ publishCommunityUpdate }));
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent }));
// Inlined literal (not the outer const): vi.mock factories are hoisted
// above regular top-level declarations, so only vi.hoisted() bindings or
// literals are safe to reference here (see the TDZ note above).
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://communikey.example/']
}));
vi.mock('$lib/helpers/toast', () => ({ showToast }));
vi.mock('$lib/groups/group-management.js', async () => {
  const actual = await vi.importActual('$lib/groups/group-management.js');
  return {
    ...actual,
    publishToGroupRelay
  };
});
vi.mock(
  '$lib/components/groups/GroupMembersModal.svelte',
  () => import('./fixtures/GroupMembersModalStub.svelte')
);
vi.mock(
  '$lib/components/community/settings/ApplicationApprovals.svelte',
  () => import('./fixtures/ApplicationApprovalsStub.svelte')
);
vi.mock('$lib/paraglide/messages', () => ({
  community_membership_pane_title: () => 'Mitglieder & Rollen',
  community_membership_pane_manage: () => 'Mitglieder verwalten',
  community_membership_pane_member_count: (/** @type {{count: number}} */ p) =>
    `${p.count} Mitglieder`,
  community_membership_pane_application_title: () => 'Beitrittsformular',
  community_membership_pane_application_lead: () => 'lead',
  community_membership_pane_application_none: () => 'Kein Formular hinterlegt',
  community_membership_pane_application_save: () => 'Übernehmen',
  community_membership_pane_application_remove: () => 'Formular entfernen',
  community_membership_pane_application_create_default: () => 'Standard-Formular erstellen',
  community_membership_pane_application_saved: () => 'Gespeichert.',
  community_membership_pane_application_failed: (/** @type {{reason: string}} */ p) =>
    `Speichern fehlgeschlagen: ${p.reason}`,
  community_invite_title: () => 'Einladungscode',
  community_invite_create: () => 'Code erstellen',
  community_invite_hint: () =>
    'Der Code kann auf der Community-Seite unter „Einladungscode einlösen" verwendet werden.',
  community_invite_copy: () => 'Kopieren',
  community_invite_copied: () => 'Kopiert.',
  community_invite_failed: (/** @type {{reason: string}} */ p) =>
    `Code konnte nicht erstellt werden: ${p.reason}`,
  community_invite_clipboard_unavailable: () => 'Zwischenablage nicht verfügbar',
  // Pulled in transitively by createDefaultMembershipForm -> getDefaultMembershipForm.
  default_form_name: () => 'Standard-Formular',
  default_form_field_name: () => 'Name',
  default_form_field_email: () => 'E-Mail',
  default_form_field_motivation: () => 'Motivation'
}));

const { default: MembershipPane } = await import(
  '$lib/components/community/settings/MembershipPane.svelte'
);

// id/sig present so applesauce's getDisplayName treats this as a real event
// (it gates event-vs-plain-metadata detection on those two fields).
const profileEvent = {
  kind: 0,
  pubkey: OWNER,
  tags: [],
  content: JSON.stringify({ name: 'X' }),
  id: 'profile-id',
  sig: 'profile-sig'
};

/** @param {string[][]} tags */
function communikeyEvent(tags) {
  return { kind: 10222, pubkey: OWNER, created_at: 1000, content: 'desc', tags };
}

const eventWithApplication = communikeyEvent([
  ['membership', 'root1', GROUPS_RELAY],
  ['application', '30168:' + OWNER + ':membership', COMMUNIKEY_RELAY]
]);
const eventWithoutApplication = communikeyEvent([['membership', 'root1', GROUPS_RELAY]]);

beforeEach(() => {
  rosterFixture.value = {
    pointer: { id: 'root1', relay: GROUPS_RELAY },
    refresh: vi.fn(),
    admins: [
      { pubkey: OWNER, roles: ['admin'] },
      { pubkey: ADMIN2, roles: ['lehrkraft'] }
    ],
    members: new Set([OWNER, ADMIN2, MEMBER]),
    isLoading: false,
    isMember: () => true,
    rolesOf: () => []
  };
  activeUserFixture.value = { pubkey: OWNER, signer: {} };
  isCommunityOwner.mockClear().mockReturnValue(true);
  getCommunitySigner.mockClear().mockReturnValue(communitySigner);
  communitySigner.signEvent.mockClear();
  publishCommunityUpdate.mockClear();
  publishEvent.mockClear();
  eventStoreAdd.mockClear();
  showToast.mockClear();
  publishToGroupRelay.mockClear();
  // jsdom has no navigator.clipboard; stub it
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined)
    }
  });
});

describe('MembershipPane — roster', () => {
  it('renders the member count and opens GroupMembersModal with roster-derived props', async () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    expect(screen.getByTestId('membership-pane')).toBeTruthy();
    expect(screen.getByText('3 Mitglieder')).toBeTruthy();

    await fireEvent.click(screen.getByTestId('membership-manage-members'));

    const stub = await screen.findByTestId('stub-group-members-modal');
    expect(JSON.parse(/** @type {string} */ (stub.dataset.pointer))).toEqual({
      id: 'root1',
      relay: GROUPS_RELAY
    });
    expect(JSON.parse(/** @type {string} */ (stub.dataset.admins))).toEqual([
      { pubkey: OWNER, roles: ['admin'] },
      { pubkey: ADMIN2, roles: ['lehrkraft'] }
    ]);
    expect(JSON.parse(/** @type {string} */ (stub.dataset.members)).sort()).toEqual(
      [OWNER, ADMIN2, MEMBER].sort()
    );
    expect(stub.dataset.mypubkey).toBe(OWNER);
    expect(stub.dataset.isadmin).toBe('true');
    // Union of admin roles + 'admin', deduped.
    expect(JSON.parse(/** @type {string} */ (stub.dataset.roleoptions)).sort()).toEqual(
      ['admin', 'lehrkraft'].sort()
    );
  });

  it('manage-members button is disabled when the roster has no pointer', () => {
    rosterFixture.value = { ...rosterFixture.value, pointer: null };
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });
    const button = /** @type {HTMLButtonElement} */ (
      screen.getByTestId('membership-manage-members')
    );
    expect(button.disabled).toBe(true);
  });

  it('reports the role union upward via onRolesChanged', async () => {
    const onRolesChanged = vi.fn();
    render(MembershipPane, {
      props: {
        communikeyEvent: eventWithoutApplication,
        communityId: OWNER,
        profileEvent,
        onRolesChanged
      }
    });
    await waitFor(() =>
      expect(onRolesChanged).toHaveBeenCalledWith(expect.arrayContaining(['admin', 'lehrkraft']))
    );
  });
});

describe('MembershipPane — application form', () => {
  it('shows the "no form" hint when no application ref is set', () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });
    expect(screen.getByText('Kein Formular hinterlegt')).toBeTruthy();
    expect(screen.queryByTestId('membership-application-remove')).toBeNull();
  });

  it('shows the remove button when an application ref is already set', () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithApplication, communityId: OWNER, profileEvent }
    });
    expect(screen.getByTestId('membership-application-remove')).toBeTruthy();
  });

  it('saving publishes a template whose parseApplicationRef matches the selected form', async () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    const select = /** @type {HTMLSelectElement} */ (
      screen.getByTestId('membership-application-select')
    );
    await fireEvent.change(select, { target: { value: `30168:${OWNER}:membership` } });
    await fireEvent.click(screen.getByTestId('membership-application-save'));

    await waitFor(() => expect(publishCommunityUpdate).toHaveBeenCalledOnce());
    const [template] = /** @type {any[]} */ (publishCommunityUpdate.mock.calls[0]);
    expect(parseApplicationRef(template)).toEqual({
      address: `30168:${OWNER}:membership`,
      relay: COMMUNIKEY_RELAY
    });
    expect(showToast).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('saving over an already-referenced form keeps its existing relay hint', async () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithApplication, communityId: OWNER, profileEvent }
    });

    // Re-save the same address that's already referenced (with a distinct
    // relay from getCommunikeyRelays, proving the existing ref's relay wins).
    await fireEvent.click(screen.getByTestId('membership-application-save'));

    await waitFor(() => expect(publishCommunityUpdate).toHaveBeenCalledOnce());
    const [template] = /** @type {any[]} */ (publishCommunityUpdate.mock.calls[0]);
    expect(parseApplicationRef(template)?.relay).toBe(COMMUNIKEY_RELAY);
  });

  it('remove publishes a template with no application ref', async () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithApplication, communityId: OWNER, profileEvent }
    });

    await fireEvent.click(screen.getByTestId('membership-application-remove'));

    await waitFor(() => expect(publishCommunityUpdate).toHaveBeenCalledOnce());
    const [template] = /** @type {any[]} */ (publishCommunityUpdate.mock.calls[0]);
    expect(parseApplicationRef(template)).toBeNull();
  });

  it('create-default publishes a new form template and selects it', async () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    await fireEvent.click(screen.getByTestId('membership-application-create-default'));

    await waitFor(() => expect(communitySigner.signEvent).toHaveBeenCalled());
    await waitFor(() => expect(publishEvent).toHaveBeenCalled());
    expect(eventStoreAdd).toHaveBeenCalled();

    const select = /** @type {HTMLSelectElement} */ (
      screen.getByTestId('membership-application-select')
    );
    await waitFor(() => expect(select.value).toBe(`30168:${OWNER}:membership`));
  });

  it('renders the approvals queue (with roster + community props) when an application ref exists', async () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithApplication, communityId: OWNER, profileEvent }
    });
    const stub = await screen.findByTestId('stub-application-approvals');
    expect(stub.dataset.communityid).toBe(OWNER);
    expect(stub.dataset.communityname).toBe('X');
    expect(JSON.parse(/** @type {string} */ (stub.dataset.application))).toEqual([
      'application',
      `30168:${OWNER}:membership`,
      COMMUNIKEY_RELAY
    ]);
    expect(JSON.parse(/** @type {string} */ (stub.dataset.rosterpointer))).toEqual({
      id: 'root1',
      relay: GROUPS_RELAY
    });
  });

  it('does not render the approvals queue when no application ref is set', () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });
    expect(screen.queryByTestId('stub-application-approvals')).toBeNull();
  });

  it('does not render the approvals queue for a non-admin', () => {
    isCommunityOwner.mockReturnValue(false);
    rosterFixture.value = {
      ...rosterFixture.value,
      admins: [{ pubkey: ADMIN2, roles: ['admin'] }]
    };
    render(MembershipPane, {
      props: { communikeyEvent: eventWithApplication, communityId: OWNER, profileEvent }
    });
    expect(screen.queryByTestId('stub-application-approvals')).toBeNull();
  });

  it('a rejected save shows an error toast with the reason', async () => {
    publishCommunityUpdate.mockRejectedValueOnce(new Error('relay down'));
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    const select = /** @type {HTMLSelectElement} */ (
      screen.getByTestId('membership-application-select')
    );
    await fireEvent.change(select, { target: { value: `30168:${OWNER}:membership` } });
    await fireEvent.click(screen.getByTestId('membership-application-save'));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('relay down'), 'error')
    );
  });
});

describe('MembershipPane — invite-code minting', () => {
  it('renders the invite-code block for admins', () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    expect(screen.getByTestId('membership-invite-create')).toBeTruthy();
  });

  it('clicking create generates a code, publishes 9009 to the roster relay, and displays the code', async () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    await fireEvent.click(screen.getByTestId('membership-invite-create'));

    await waitFor(() => expect(publishToGroupRelay).toHaveBeenCalledOnce());
    const [relayConn, template, user] = /** @type {any[]} */ (publishToGroupRelay.mock.calls[0]);

    // Verify the relay connection points to the roster relay
    expect(relayConn).toBeTruthy();
    expect(poolMock.relay).toHaveBeenCalledWith(GROUPS_RELAY);

    // Verify the template is kind 9009 with h-tag and code tag
    expect(template.kind).toBe(9009);
    expect(template.tags).toEqual([
      ['h', 'root1'],
      [
        'code',
        expect.stringMatching(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz]{12}$/)
      ]
    ]);

    // Verify user is the active user
    expect(user.pubkey).toBe(OWNER);

    // Verify the code is displayed
    const codeElement = await screen.findByTestId('membership-invite-code');
    expect(codeElement).toBeTruthy();
  });

  it('displays a copy button for the generated code', async () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    await fireEvent.click(screen.getByTestId('membership-invite-create'));

    await waitFor(() => {
      const copyButton = screen.getByTestId('membership-invite-copy');
      expect(copyButton).toBeTruthy();
    });
  });

  it('copy button shows success toast', async () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    await fireEvent.click(screen.getByTestId('membership-invite-create'));

    await waitFor(() => {
      const copyButton = screen.getByTestId('membership-invite-copy');
      expect(copyButton).toBeTruthy();
    });

    const copyButton = screen.getByTestId('membership-invite-copy');
    await fireEvent.click(copyButton);

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Kopiert'), 'success')
    );
  });

  it('copy button shows an i18n clipboard-unavailable reason, not a hardcoded string', async () => {
    // @ts-expect-error - simulating a browser with no Clipboard API
    delete navigator.clipboard;
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    await fireEvent.click(screen.getByTestId('membership-invite-create'));
    await waitFor(() => expect(screen.getByTestId('membership-invite-copy')).toBeTruthy());

    await fireEvent.click(screen.getByTestId('membership-invite-copy'));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('Zwischenablage nicht verfügbar'),
        'error'
      )
    );
  });

  it('shows an error toast when publishing fails', async () => {
    publishToGroupRelay.mockRejectedValueOnce(new Error('relay rejected'));
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    await fireEvent.click(screen.getByTestId('membership-invite-create'));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('relay rejected'), 'error')
    );
  });
});
