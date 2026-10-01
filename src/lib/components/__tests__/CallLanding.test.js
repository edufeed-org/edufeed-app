// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';

const checkCallPass = vi.fn();
vi.mock('$lib/groups/call-passes.js', async (orig) => ({
  ...(await orig()),
  checkCallPass: (...a) => checkCallPass(...a)
}));
const callState = {
  activeKey: null,
  phase: 'idle',
  error: null,
  token: null,
  serverUrl: null,
  code: null,
  isActiveFor: () => false
};
const joinGroupCall = vi.fn(async () => {});
vi.mock('$lib/groups/group-call.svelte.js', () => ({
  getGroupCallState: () => callState,
  joinGroupCall: (...a) => joinGroupCall(...a),
  leaveGroupCall: vi.fn(async () => {}),
  callErrorMessage: () => 'err-msg',
  registerCallStageView: () => () => {}
}));
let activeUser = null;
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => activeUser,
  manager: {}
}));
const createGuestAccount = vi.fn(
  async (_name) => (activeUser = { pubkey: 'a'.repeat(64), signer: {} })
);
vi.mock('$lib/groups/guest-account.js', () => ({
  createGuestAccount: (...a) => createGuestAccount(...a),
  isCallGuest: () => true,
  forgetGuestAccount: vi.fn()
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: { openModal: vi.fn() } }));

const { default: CallLanding } = await import('$lib/components/groups/call/CallLanding.svelte');
const POINTER = { id: 'g1', relay: 'wss://groups.example/' };
const CODE = 'C'.repeat(22);

beforeEach(() => {
  vi.clearAllMocks();
  activeUser = null;
  callState.phase = 'idle';
  callState.isActiveFor = () => false;
  window.location.hash = '#' + CODE;
});

describe('CallLanding', () => {
  it('rejects a link without a valid code without asking the relay', async () => {
    window.location.hash = '#short';
    render(CallLanding, { props: { pointer: POINTER } });
    expect(await screen.findByTestId('call-landing-invalid')).toBeTruthy();
    expect(checkCallPass).not.toHaveBeenCalled();
  });
  it('explains an ended call / revoked link', async () => {
    checkCallPass.mockResolvedValue({ valid: false, reason: 'call_ended', liveCount: 0 });
    render(CallLanding, { props: { pointer: POINTER } });
    expect(await screen.findByTestId('call-landing-invalid')).toBeTruthy();
  });
  it('lets a newcomer join with a name: guest account, then join with the code', async () => {
    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', name: 'Weekly', liveCount: 4 });
    render(CallLanding, { props: { pointer: POINTER } });
    await fireEvent.input(await screen.findByTestId('call-landing-name'), {
      target: { value: 'Ada' }
    });
    await fireEvent.click(screen.getByTestId('call-landing-join'));
    await waitFor(() => expect(createGuestAccount).toHaveBeenCalledWith('Ada'));
    expect(joinGroupCall).toHaveBeenCalledWith(
      POINTER,
      activeUser,
      expect.objectContaining({ code: CODE })
    );
  });
  it('lets a logged-in person join with their own account and offers the channel', async () => {
    activeUser = { pubkey: 'b'.repeat(64), signer: {} };
    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 1 });
    render(CallLanding, { props: { pointer: POINTER } });
    await fireEvent.click(await screen.findByTestId('call-landing-join-as'));
    expect(createGuestAccount).not.toHaveBeenCalled();
    expect(joinGroupCall).toHaveBeenCalledWith(
      POINTER,
      activeUser,
      expect.objectContaining({ code: CODE })
    );
    expect(screen.getByTestId('call-landing-channel').getAttribute('href')).toContain('/groups/');
  });
  it('shows the start time for a link that is not open yet', async () => {
    checkCallPass.mockResolvedValue({
      valid: false,
      reason: 'not_yet',
      notBefore: 2_000_000_000,
      liveCount: 0
    });
    render(CallLanding, { props: { pointer: POINTER } });
    expect(await screen.findByTestId('call-landing-not-yet')).toBeTruthy();
  });
  it('shows a name-required message and does not join when the name is blank', async () => {
    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', name: 'Weekly', liveCount: 4 });
    createGuestAccount.mockRejectedValueOnce(new Error('name-required'));
    render(CallLanding, { props: { pointer: POINTER } });
    await fireEvent.click(await screen.findByTestId('call-landing-join'));
    await waitFor(() => expect(createGuestAccount).toHaveBeenCalled());
    expect(joinGroupCall).not.toHaveBeenCalled();
    expect(screen.getByText(m.call_landing_name_required())).toBeTruthy();
  });
});
