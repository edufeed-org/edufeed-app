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
});
