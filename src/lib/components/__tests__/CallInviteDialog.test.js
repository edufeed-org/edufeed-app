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
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ pool: { relay: (url) => ({ url }) } }));
vi.mock('$lib/services/wrapped-dm.js', () => ({ sendWrappedDm: vi.fn(async () => {}) }));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));
vi.mock('$lib/components/shared/ContactSearchInput.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));

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
  listCallPasses.mockResolvedValue([]);
  passLinkFor.mockResolvedValue(null);
});

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
  });

  it('lists my existing link and revokes it', async () => {
    const pass = { id: 'p1', pubkey: ME, created_at: 1, tags: [['h', 'g1']] };
    listCallPasses.mockResolvedValue([pass]);
    passLinkFor.mockResolvedValue('https://x/call/p#C');
    revokeCallPass.mockResolvedValue(undefined);
    render(CallInviteDialog, { props });
    await fireEvent.click(await screen.findByTestId('call-invite-revoke'));
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
    await fireEvent.click(revokeButton);
    resolveRevoke();
    await waitFor(() => expect(screen.queryByTestId('call-invite-pass')).toBeNull());
    expect(revokeCallPass).toHaveBeenCalledTimes(1);
  });
});
