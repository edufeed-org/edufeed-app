// @ts-nocheck
/**
 * CallInviteDialog — guest links for a running call (call passes). Create,
 * copy, send-as-DM and revoke. listCallPasses REJECTS on relay failure
 * (Task 3 ruling), so a listing failure must surface an inline error, not
 * just a console.warn.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const createCallLink = vi.fn();
const listCallPasses = vi.fn();
const passLinkFor = vi.fn();
const revokeCallPass = vi.fn();
vi.mock('$lib/groups/call-passes.js', () => ({
  TITLE_MAX_CHARS: 80,
  createCallLink: (...a) => createCallLink(...a),
  listCallPasses: (...a) => listCallPasses(...a),
  passLinkFor: (...a) => passLinkFor(...a),
  revokeCallPass: (...a) => revokeCallPass(...a)
}));
const callState = { connected: false };
vi.mock('$lib/groups/group-call.svelte.js', () => ({ getGroupCallState: () => callState }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ pool: { relay: (url) => ({ url }) } }));
vi.mock('$lib/services/wrapped-dm.js', () => ({ sendWrappedDm: vi.fn(async () => {}) }));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));
vi.mock('$lib/components/shared/ContactSearchInput.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));

const m = await import('$lib/paraglide/messages');
const { default: CallInviteDialog } = await import(
  '$lib/components/groups/call/CallInviteDialog.svelte'
);

const ME = 'a'.repeat(64);
const props = {
  pointer: { id: 'g1', relay: 'wss://groups.example/' },
  user: { pubkey: ME, signer: {} },
  isAdmin: false,
  title: 'Weekly',
  onClose: vi.fn()
};

beforeEach(() => {
  vi.clearAllMocks();
  callState.connected = false;
  listCallPasses.mockResolvedValue([]);
  passLinkFor.mockResolvedValue(null);
});

/** "Zurückziehen" asks first (QA round 2 C-new-2). */
async function confirmRevoke() {
  await fireEvent.click(await screen.findByTestId('call-invite-revoke-confirm'));
}

describe('CallInviteDialog', () => {
  it('creates a link and shows it', async () => {
    createCallLink.mockResolvedValue({
      code: 'C',
      url: 'https://x/call/p#C',
      event: { id: 'p1', pubkey: ME, created_at: 1, tags: [['h', 'g1']] }
    });
    render(CallInviteDialog, { props });
    await fireEvent.click(screen.getByTestId('call-invite-create'));
    await waitFor(() =>
      expect(screen.getByTestId('call-invite-url').value).toBe('https://x/call/p#C')
    );
  });

  it('sends the typed link name with the create and shows it in the new row', async () => {
    createCallLink.mockResolvedValue({
      code: 'C',
      url: 'https://x/call/p#C',
      event: {
        id: 'p1',
        pubkey: ME,
        created_at: 1,
        tags: [
          ['h', 'g1'],
          ['title', 'Elternabend']
        ]
      }
    });
    render(CallInviteDialog, { props });
    const input = screen.getByTestId('call-invite-title');
    expect(input.getAttribute('maxlength')).toBe('80');
    await fireEvent.input(input, { target: { value: 'Elternabend' } });
    await fireEvent.click(screen.getByTestId('call-invite-create'));
    await waitFor(() => expect(createCallLink).toHaveBeenCalled());
    expect(createCallLink.mock.calls[0][4]).toEqual({ title: 'Elternabend' });
    await waitFor(() => expect(screen.getByTestId('call-invite-url')).toBeTruthy());
    expect(screen.getByTestId('call-invite-pass').textContent).toContain('Elternabend');
  });

  it('shows a pass title in its row, and only the time for an untitled pass', async () => {
    listCallPasses.mockResolvedValue([
      {
        id: 'p1',
        pubkey: ME,
        created_at: 2,
        tags: [
          ['h', 'g1'],
          ['title', 'Sprechstunde']
        ]
      },
      { id: 'p2', pubkey: ME, created_at: 1, tags: [['h', 'g1']] }
    ]);
    render(CallInviteDialog, { props });
    await waitFor(() => expect(screen.getAllByTestId('call-invite-pass')).toHaveLength(2));
    const [titled, untitled] = screen.getAllByTestId('call-invite-pass');
    expect(titled.querySelector('[data-testid="call-invite-pass-title"]').textContent).toBe(
      'Sprechstunde'
    );
    expect(untitled.querySelector('[data-testid="call-invite-pass-title"]')).toBeNull();
    // Task 19 review: the user's own title stays selectable, the meta is a label.
    const title = titled.querySelector('[data-testid="call-invite-pass-title"]');
    expect(title.closest('.select-none')).toBeNull();
    const meta = titled.querySelector('[data-testid="call-invite-pass-meta"]');
    expect(meta.classList.contains('select-none')).toBe(true);
    expect(meta.classList.contains('cursor-default')).toBe(true);
  });

  it('lists my existing link and revokes it', async () => {
    const pass = { id: 'p1', pubkey: ME, created_at: 1, tags: [['h', 'g1']] };
    listCallPasses.mockResolvedValue([pass]);
    passLinkFor.mockResolvedValue('https://x/call/p#C');
    revokeCallPass.mockResolvedValue(undefined);
    render(CallInviteDialog, { props });
    await fireEvent.click(await screen.findByTestId('call-invite-revoke'));
    await confirmRevoke();
    await waitFor(() =>
      expect(revokeCallPass).toHaveBeenCalledWith({ url: props.pointer.relay }, pass, props.user, {
        asAdmin: false
      })
    );
    await waitFor(() => expect(screen.queryByTestId('call-invite-pass')).toBeNull());
  });

  it('offers revoke on someone else’s link only to an admin', async () => {
    listCallPasses.mockResolvedValue([
      { id: 'p2', pubkey: 'b'.repeat(64), created_at: 1, tags: [['h', 'g1']] }
    ]);
    const { unmount } = render(CallInviteDialog, { props });
    await screen.findByTestId('call-invite-pass');
    expect(screen.queryByTestId('call-invite-revoke')).toBeNull();
    unmount();
    render(CallInviteDialog, { props: { ...props, isAdmin: true } });
    expect(await screen.findByTestId('call-invite-revoke')).toBeTruthy();
  });

  it('says in the dialog when the relay refuses because the call is not running yet (QA B1)', async () => {
    createCallLink.mockRejectedValue(new Error('blocked: no call is running'));
    render(CallInviteDialog, { props });
    await fireEvent.click(screen.getByTestId('call-invite-create'));
    const err = await screen.findByTestId('call-invite-create-error');
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent.trim()).toBe(m.groups_call_invite_not_running());
    expect(screen.getByTestId('call-invite-create')).toBeTruthy();
  });

  it('shows any other refusal reason in the dialog and clears it on the next success', async () => {
    createCallLink.mockRejectedValueOnce(new Error('blocked: rate limited'));
    render(CallInviteDialog, { props });
    await fireEvent.click(screen.getByTestId('call-invite-create'));
    const err = await screen.findByTestId('call-invite-create-error');
    expect(err.textContent.trim()).toBe(
      m.groups_call_invite_failed({ reason: 'blocked: rate limited' })
    );
    createCallLink.mockResolvedValueOnce({
      code: 'C',
      url: 'https://x/call/p#C',
      event: { id: 'p1', pubkey: ME, created_at: 1, tags: [['h', 'g1']] }
    });
    await fireEvent.click(screen.getByTestId('call-invite-create'));
    await screen.findByTestId('call-invite-url');
    expect(screen.queryByTestId('call-invite-create-error')).toBeNull();
  });

  it('shows an inline error when listing fails, but creating a link still works', async () => {
    listCallPasses.mockRejectedValue(new Error('relay timeout'));
    render(CallInviteDialog, { props });
    expect(await screen.findByTestId('call-invite-list-error')).toBeTruthy();
    expect(screen.getByTestId('call-invite-create')).toBeTruthy();
  });

  it('keeps a link created after a listing failure revokable, alongside the error line', async () => {
    listCallPasses.mockRejectedValue(new Error('relay timeout'));
    createCallLink.mockResolvedValue({
      code: 'C',
      url: 'https://x/call/p#C',
      event: { id: 'p1', pubkey: ME, created_at: 1, tags: [['h', 'g1']] }
    });
    render(CallInviteDialog, { props });
    await screen.findByTestId('call-invite-list-error');
    await fireEvent.click(screen.getByTestId('call-invite-create'));
    expect(await screen.findByTestId('call-invite-revoke')).toBeTruthy();
    expect(screen.getByTestId('call-invite-list-error')).toBeTruthy();
  });

  it('clears the latest-url input only when that specific pass is revoked, keeping other rows', async () => {
    const passB = { id: 'pB', pubkey: ME, created_at: 1, tags: [['h', 'g1']] };
    listCallPasses.mockResolvedValue([passB]);
    passLinkFor.mockResolvedValue('https://x/call/p#B');
    createCallLink.mockResolvedValue({
      code: 'A',
      url: 'https://x/call/p#A',
      event: { id: 'pA', pubkey: ME, created_at: 2, tags: [['h', 'g1']] }
    });
    revokeCallPass.mockResolvedValue(undefined);

    render(CallInviteDialog, { props });
    await screen.findByTestId('call-invite-pass'); // B listed
    await fireEvent.click(screen.getByTestId('call-invite-create'));
    await waitFor(() =>
      expect(screen.getByTestId('call-invite-url').value).toBe('https://x/call/p#A')
    );

    // A is unshifted to the front of the rows list.
    const revokeButtons = screen.getAllByTestId('call-invite-revoke');
    await fireEvent.click(revokeButtons[0]);
    await confirmRevoke();
    await waitFor(() => expect(screen.queryByTestId('call-invite-url')).toBeNull());
    // B's row is still there.
    expect(screen.getByTestId('call-invite-pass')).toBeTruthy();
    expect(screen.queryByTestId('call-invite-revoke')).toBeTruthy();
  });

  it('keeps a link created while the initial listing is still in flight (no clobber on resolve)', async () => {
    let resolveList;
    listCallPasses.mockReturnValue(new Promise((r) => (resolveList = r)));
    createCallLink.mockResolvedValue({
      code: 'A',
      url: 'https://x/call/p#A',
      event: { id: 'pA', pubkey: ME, created_at: 2, tags: [['h', 'g1']] }
    });
    render(CallInviteDialog, { props });
    await fireEvent.click(screen.getByTestId('call-invite-create'));
    await waitFor(() =>
      expect(screen.getByTestId('call-invite-url').value).toBe('https://x/call/p#A')
    );

    resolveList([]);
    await waitFor(() => expect(screen.queryByTestId('call-invite-pass')).toBeTruthy());
    expect(screen.getAllByTestId('call-invite-pass')).toHaveLength(1);
  });

  it('does not revoke twice on a double-click of the same pass', async () => {
    const pass = { id: 'p1', pubkey: ME, created_at: 1, tags: [['h', 'g1']] };
    listCallPasses.mockResolvedValue([pass]);
    passLinkFor.mockResolvedValue('https://x/call/p#C');
    let resolveRevoke;
    revokeCallPass.mockImplementation(() => new Promise((resolve) => (resolveRevoke = resolve)));
    render(CallInviteDialog, { props });
    const revokeButton = await screen.findByTestId('call-invite-revoke');
    await fireEvent.click(revokeButton);
    await confirmRevoke();
    await fireEvent.click(revokeButton);
    expect(screen.queryByTestId('call-invite-revoke-confirm')).toBeNull();
    resolveRevoke();
    await waitFor(() => expect(screen.queryByTestId('call-invite-pass')).toBeNull());
    expect(revokeCallPass).toHaveBeenCalledTimes(1);
  });

  // QA round 2 C-new-2
  it('asks before revoking, and cancelling keeps the link', async () => {
    const pass = { id: 'p1', pubkey: ME, created_at: 1, tags: [['h', 'g1']] };
    listCallPasses.mockResolvedValue([pass]);
    revokeCallPass.mockResolvedValue(undefined);
    render(CallInviteDialog, { props });
    await fireEvent.click(await screen.findByTestId('call-invite-revoke'));
    const confirm = await screen.findByTestId('call-invite-revoke-dialog');
    expect(confirm.textContent).toContain(m.groups_call_invite_revoke_confirm_title());
    expect(confirm.textContent).toContain(m.groups_call_invite_revoke_confirm_text());
    expect(screen.getByTestId('call-invite-revoke-confirm').className).toContain('btn-error');
    expect(revokeCallPass).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByTestId('call-invite-revoke-cancel'));
    expect(screen.queryByTestId('call-invite-revoke-dialog')).toBeNull();
    expect(revokeCallPass).not.toHaveBeenCalled();
    expect(screen.getByTestId('call-invite-pass')).toBeTruthy();
  });

  // QA round 2 C-new-4
  it('says under the empty list that links end with the call', async () => {
    render(CallInviteDialog, { props });
    expect(await screen.findByText(m.groups_call_invite_none())).toBeTruthy();
    expect(screen.getByText(m.groups_call_invite_scope_hint())).toBeTruthy();
  });

  // QA round 2 K-new-2
  it('lists the link time as a 24-hour HH:MM', async () => {
    const evening = Math.floor(new Date(2026, 5, 3, 21, 5).getTime() / 1000);
    listCallPasses.mockResolvedValue([
      { id: 'p1', pubkey: ME, created_at: evening, tags: [['h', 'g1']] }
    ]);
    render(CallInviteDialog, { props });
    const row = await screen.findByTestId('call-invite-pass');
    expect(row.textContent).toContain('21:05');
    expect(row.textContent).not.toMatch(/AM|PM/);
  });

  // QA round 2 K-new-4
  it('keeps the name field after creating, so a second link needs no reopen', async () => {
    createCallLink
      .mockResolvedValueOnce({
        code: 'A',
        url: 'https://x/call/p#A',
        event: { id: 'pA', pubkey: ME, created_at: 1, tags: [['h', 'g1']] }
      })
      .mockResolvedValueOnce({
        code: 'B',
        url: 'https://x/call/p#B',
        event: { id: 'pB', pubkey: ME, created_at: 2, tags: [['h', 'g1']] }
      });
    render(CallInviteDialog, { props });
    await fireEvent.click(screen.getByTestId('call-invite-create'));
    await waitFor(() =>
      expect(screen.getByTestId('call-invite-url').value).toBe('https://x/call/p#A')
    );
    expect(screen.getByTestId('call-invite-title').value).toBe('');
    await fireEvent.click(screen.getByTestId('call-invite-create'));
    await waitFor(() =>
      expect(screen.getByTestId('call-invite-url').value).toBe('https://x/call/p#B')
    );
    expect(screen.getAllByTestId('call-invite-pass')).toHaveLength(2);
  });

  // Task 15 review, B1 webhook window: the relay learns about the call
  // from LiveKit's webhook a moment after the client is connected.
  it('retries a "no call is running" refusal once after a moment while connected', async () => {
    callState.connected = true;
    createCallLink
      .mockRejectedValueOnce(new Error('blocked: no call is running'))
      .mockResolvedValueOnce({
        code: 'A',
        url: 'https://x/call/p#A',
        event: { id: 'pA', pubkey: ME, created_at: 1, tags: [['h', 'g1']] }
      });
    render(CallInviteDialog, { props });
    await fireEvent.click(screen.getByTestId('call-invite-create'));
    await waitFor(
      () => expect(screen.getByTestId('call-invite-url').value).toBe('https://x/call/p#A'),
      { timeout: 3000 }
    );
    expect(createCallLink).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('call-invite-create-error')).toBeNull();
  });
  it('shows the error when the retry is refused too', async () => {
    callState.connected = true;
    createCallLink.mockRejectedValue(new Error('blocked: no call is running'));
    render(CallInviteDialog, { props });
    await fireEvent.click(screen.getByTestId('call-invite-create'));
    const err = await screen.findByTestId('call-invite-create-error', {}, { timeout: 3000 });
    expect(err.textContent.trim()).toBe(m.groups_call_invite_not_running());
    expect(createCallLink).toHaveBeenCalledTimes(2);
  });
  // Task 16 review: closing the dialog must not create a link 1.5 s later.
  it('drops the pending retry when the dialog closes', async () => {
    callState.connected = true;
    createCallLink.mockRejectedValueOnce(new Error('blocked: no call is running'));
    const { unmount } = render(CallInviteDialog, { props });
    await fireEvent.click(screen.getByTestId('call-invite-create'));
    await waitFor(() => expect(createCallLink).toHaveBeenCalledTimes(1));
    unmount();
    await new Promise((r) => setTimeout(r, 1800));
    expect(createCallLink).toHaveBeenCalledTimes(1);
  });
});
