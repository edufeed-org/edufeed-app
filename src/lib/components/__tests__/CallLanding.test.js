// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
import { formatTimestamp, formatTimeOfDay, formatTimeZoneName } from '$lib/helpers/dates.js';
import { hashPassCode } from '$lib/groups/call-passes.js';

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
  connected: false,
  endReason: null,
  chatBeside: true,
  isActiveFor: () => false
};
const registerCallStageView = vi.fn(() => () => {});
const toggleChatBeside = vi.fn(() => {
  callState.chatBeside = !callState.chatBeside;
});
const joinGroupCall = vi.fn(async () => {});
const leaveGroupCall = vi.fn(async () => {});
vi.mock('$lib/groups/group-call.svelte.js', () => ({
  getGroupCallState: () => callState,
  joinGroupCall: (...a) => joinGroupCall(...a),
  leaveGroupCall: (...a) => leaveGroupCall(...a),
  callErrorMessage: () => 'err-msg',
  registerCallStageView: (...a) => registerCallStageView(...a),
  toggleChatBeside: () => toggleChatBeside()
}));
let activeUser = null;
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => activeUser,
  manager: {}
}));
const forgetGuestAccount = vi.fn();
const createGuestAccount = vi.fn(
  async (_name) => (activeUser = { pubkey: 'a'.repeat(64), signer: {} })
);
vi.mock('$lib/groups/guest-account.js', () => ({
  createGuestAccount: (...a) => createGuestAccount(...a),
  isCallGuest: () => true,
  forgetGuestAccount: (...a) => forgetGuestAccount(...a)
}));
const mockModalStore = { openModal: vi.fn() };
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: mockModalStore }));
const getProfile = vi.fn(() => null);
vi.mock('$lib/stores/user-profile.svelte.js', () => ({ useUserProfile: () => getProfile }));
vi.mock(
  '$lib/components/groups/call/GroupCallStage.svelte',
  () => import('./fixtures/GroupCallStageStub.svelte')
);
vi.mock(
  '$lib/components/groups/call/CallChatPanel.svelte',
  () => import('./fixtures/CallChatPanelStub.svelte')
);

const { default: CallLanding } = await import('$lib/components/groups/call/CallLanding.svelte');
const POINTER = { id: 'g1', relay: 'wss://groups.example/' };
const CODE = 'C'.repeat(22);

beforeEach(() => {
  vi.clearAllMocks();
  activeUser = null;
  callState.phase = 'idle';
  callState.connected = false;
  callState.endReason = null;
  callState.isActiveFor = () => false;
  callState.chatBeside = true;
  registerCallStageView.mockImplementation(() => () => {});
  getProfile.mockReturnValue(null);
  window.location.hash = '#' + CODE;
  sessionStorage.clear();
  setWide(false);
});

/** md+ (768 px) or a phone: the landing reads window.matchMedia. */
function setWide(wide) {
  window.matchMedia = vi.fn(() => ({
    matches: wide,
    addEventListener: () => {},
    removeEventListener: () => {}
  }));
}

/** Render, connect, and wait for the stage. */
async function renderInCall() {
  checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 1 });
  activeUser = { pubkey: 'h'.repeat(64), signer: {} };
  const view = render(CallLanding, { props: { pointer: POINTER } });
  callState.phase = 'ready';
  callState.connected = true;
  callState.isActiveFor = () => true;
  await view.rerender({ pointer: { ...POINTER } });
  await screen.findByTestId('group-call-stage-stub');
  return view;
}

describe('CallLanding', () => {
  it('rejects a link without a valid code without asking the relay', async () => {
    window.location.hash = '#short';
    render(CallLanding, { props: { pointer: POINTER } });
    expect(await screen.findByTestId('call-landing-invalid')).toBeTruthy();
    expect(checkCallPass).not.toHaveBeenCalled();
  });
  // QA K6: an unknown code took ~2.5 s with only a blank card first.
  it('says the link is being checked while the pass check runs', async () => {
    /** @type {(v: any) => void} */
    let resolve = () => {};
    checkCallPass.mockReturnValue(new Promise((r) => (resolve = r)));
    render(CallLanding, { props: { pointer: POINTER } });
    const checking = await screen.findByTestId('call-landing-checking');
    expect(checking.getAttribute('role')).toBe('status');
    expect(checking.textContent).toContain(m.call_landing_checking());
    resolve({ valid: false, reason: 'unknown', liveCount: 0 });
    expect(await screen.findByTestId('call-landing-invalid')).toBeTruthy();
    expect(screen.queryByTestId('call-landing-checking')).toBeNull();
  });
  // QA K-new-5: the page left document.title empty ("untitled page").
  it('titles the page "Einladung: <call name>"', async () => {
    document.title = '';
    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', name: 'Weekly', liveCount: 1 });
    render(CallLanding, { props: { pointer: POINTER } });
    await screen.findByTestId('call-landing-name');
    await waitFor(() =>
      expect(document.title.startsWith(m.call_page_title({ name: 'Weekly' }))).toBe(true)
    );
  });
  // Fix round 1: never the raw group id — "Einladung — <APP>" until the pass
  // check names the call, and for a pass without a name.
  it('keeps the plain "Einladung" title while checking and for a nameless pass', async () => {
    document.title = '';
    /** @type {(v: any) => void} */
    let resolve = () => {};
    checkCallPass.mockReturnValue(new Promise((r) => (resolve = r)));
    render(CallLanding, { props: { pointer: POINTER } });
    await screen.findByTestId('call-landing-checking');
    await waitFor(() => expect(document.title.startsWith(m.call_page_title_plain())).toBe(true));
    expect(document.title).not.toContain(POINTER.id);
    resolve({ valid: true, reason: 'ok', liveCount: 1 });
    await screen.findByTestId('call-landing-name');
    expect(document.title.startsWith(m.call_page_title_plain())).toBe(true);
    expect(document.title).not.toContain(POINTER.id);
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
  it('shows the meeting start (notBefore + 15 min), not the guest-window open time', async () => {
    checkCallPass.mockResolvedValue({
      valid: false,
      reason: 'not_yet',
      notBefore: 2_000_000_000,
      expiration: 2_000_010_000,
      name: 'Elternabend',
      liveCount: 0
    });
    render(CallLanding, { props: { pointer: POINTER } });
    await screen.findByTestId('call-landing-not-yet');
    // QA round 3 C2: start AND end, and the zone.
    const start = 2_000_000_000 + 900;
    const end = 2_000_010_000 - 1800;
    const expected = m.call_landing_when({
      date: formatTimestamp(start, { day: '2-digit', month: '2-digit', year: 'numeric' }),
      start: formatTimeOfDay(start),
      end: formatTimeOfDay(end),
      zone: formatTimeZoneName(start)
    });
    expect(screen.getByText(expected)).toBeTruthy();
  });

  // QA round 3 K2: no coordinate on the guest side — the UID is derived from
  // the pass, so re-downloading the same link updates the same entry.
  it('the guest .ics UID is stable per link (derived from the pass hash)', async () => {
    checkCallPass.mockResolvedValue({
      valid: false,
      reason: 'not_yet',
      notBefore: 2_000_000_000,
      expiration: 2_000_010_000,
      name: 'Elternabend',
      liveCount: 0
    });
    const blobs = [];
    URL.createObjectURL = vi.fn((b) => (blobs.push(b), 'blob:ics'));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(CallLanding, { props: { pointer: POINTER } });
    const button = await screen.findByTestId('call-landing-ics');
    await new Promise((r) => setTimeout(r, 20)); // the hash is computed once, async
    await fireEvent.click(button);
    click.mockRestore();
    const text = await blobs[0].text();
    const hash = await hashPassCode(CODE);
    expect(text).toContain(`UID:pass-${hash.slice(0, 32)}@edufeed`);
  });

  describe('meeting pass in its join window (QA round 3 C3/C2)', () => {
    const now = () => Math.floor(Date.now() / 1000);
    it('before the start: "Beginnt um … · du kannst schon beitreten", never "Läuft gerade"', async () => {
      const start = now() + 600;
      checkCallPass.mockResolvedValue({
        valid: true,
        reason: 'ok',
        notBefore: start - 900,
        expiration: start + 3600 + 1800,
        name: 'Elternabend',
        liveCount: 2
      });
      render(CallLanding, { props: { pointer: POINTER } });
      await screen.findByTestId('call-landing-join');
      expect(screen.getByText(m.call_landing_early({ time: formatTimeOfDay(start) }))).toBeTruthy();
      expect(screen.queryByText(m.call_landing_live({ count: 2 }))).toBeNull();
      expect(screen.getByTestId('call-landing-when')).toBeTruthy();
    });
    it('after the start: "Läuft gerade" only with people in the call', async () => {
      const start = now() - 120;
      checkCallPass.mockResolvedValue({
        valid: true,
        reason: 'ok',
        notBefore: start - 900,
        expiration: start + 3600 + 1800,
        liveCount: 0
      });
      const view = render(CallLanding, { props: { pointer: POINTER } });
      await screen.findByTestId('call-landing-join');
      expect(screen.queryByText(m.call_landing_live_empty())).toBeNull();
      view.unmount();
      checkCallPass.mockResolvedValue({
        valid: true,
        reason: 'ok',
        notBefore: start - 900,
        expiration: start + 3600 + 1800,
        liveCount: 1
      });
      render(CallLanding, { props: { pointer: POINTER } });
      expect(await screen.findByText(m.call_landing_live_one())).toBeTruthy();
    });
  });

  // QA round 3 C4: an open lobby kept saying "Live now" after the meeting
  // was deleted, and Join then offered a retry that could never work.
  describe('a link revoked while the lobby is open', () => {
    afterEach(() => vi.useRealTimers());
    it('the ready view re-checks every 60 s and turns invalid', async () => {
      vi.useFakeTimers();
      checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', name: 'Weekly', liveCount: 1 });
      render(CallLanding, { props: { pointer: POINTER } });
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByTestId('call-landing-join')).toBeTruthy();
      checkCallPass.mockResolvedValue({ valid: false, reason: 'unknown', liveCount: 0 });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(screen.getByTestId('call-landing-invalid')).toBeTruthy();
    });
    // Review M8 fix 1: a ready-view recheck still in flight when the relay
    // refuses the join must not flip the page back to "ready".
    it('a recheck in flight when the join is refused cannot bring "ready" back', async () => {
      vi.useFakeTimers();
      checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 0 });
      activeUser = { pubkey: 'd'.repeat(64), signer: {} };
      const view = render(CallLanding, { props: { pointer: POINTER } });
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByTestId('call-landing-join-as')).toBeTruthy();
      /** @type {(v: any) => void} */
      let resolveLate = () => {};
      checkCallPass.mockReturnValue(new Promise((r) => (resolveLate = r)));
      await vi.advanceTimersByTimeAsync(60_000); // the 60 s recheck is now in flight
      // A new pointer object (only to re-render the plain-object call state)
      // re-runs the initial check too: keep that one silent.
      checkCallPass.mockReturnValue(new Promise(() => {}));
      leaveGroupCall.mockImplementation(async () => {
        callState.phase = 'idle';
        callState.error = null;
        callState.isActiveFor = () => false;
      });
      callState.phase = 'error';
      callState.error = { reason: 'pass' };
      callState.isActiveFor = () => true;
      try {
        await view.rerender({ pointer: { ...POINTER } });
        await vi.advanceTimersByTimeAsync(0);
        expect(screen.getByTestId('call-landing-invalid')).toBeTruthy();
        expect(leaveGroupCall).toHaveBeenCalled();
        // The call state is gone now; the late "ok" lands afterwards.
        await view.rerender({ pointer: { ...POINTER } });
        resolveLate({ valid: true, reason: 'ok', liveCount: 0 });
        await vi.advanceTimersByTimeAsync(0);
        expect(screen.getByTestId('call-landing-invalid')).toBeTruthy();
      } finally {
        leaveGroupCall.mockImplementation(async () => {});
        callState.error = null;
      }
    });

    it('a join the relay refuses for the pass shows the invalid view, not a retry', async () => {
      checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 0 });
      activeUser = { pubkey: 'd'.repeat(64), signer: {} };
      callState.phase = 'error';
      callState.error = { reason: 'pass' };
      callState.isActiveFor = () => true;
      try {
        render(CallLanding, { props: { pointer: POINTER } });
        expect(await screen.findByTestId('call-landing-invalid')).toBeTruthy();
        expect(screen.queryByTestId('call-landing-retry')).toBeNull();
        expect(leaveGroupCall).toHaveBeenCalled();
      } finally {
        callState.error = null;
      }
    });
  });
  it('offers an .ics download once the meeting end is known too', async () => {
    checkCallPass.mockResolvedValueOnce({
      valid: false,
      reason: 'not_yet',
      notBefore: 2_000_000_000,
      liveCount: 0
    });
    const { rerender } = render(CallLanding, { props: { pointer: POINTER } });
    await screen.findByTestId('call-landing-not-yet');
    expect(screen.queryByTestId('call-landing-ics')).toBeNull();

    URL.createObjectURL = vi.fn(() => 'blob:ics');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    checkCallPass.mockResolvedValue({
      valid: false,
      reason: 'not_yet',
      notBefore: 2_000_000_000,
      expiration: 2_000_010_000,
      name: 'Elternabend',
      liveCount: 0
    });
    // A new pointer identity re-triggers the initial pass check (same
    // pattern as `renderInCall`'s rerender below), landing the richer
    // not_yet result with `expiration` this time.
    await rerender({ pointer: { ...POINTER } });
    await waitFor(() => expect(screen.getByTestId('call-landing-ics')).toBeTruthy());
    await fireEvent.click(screen.getByTestId('call-landing-ics'));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  describe('not_yet auto-switch timer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('lets a guest type their name ahead of the join window; the join form keeps it', async () => {
      checkCallPass.mockResolvedValueOnce({
        valid: false,
        reason: 'not_yet',
        notBefore: Math.floor(Date.now() / 1000) + 5,
        liveCount: 0
      });
      render(CallLanding, { props: { pointer: POINTER } });
      await vi.advanceTimersByTimeAsync(0);
      const earlyName = screen.getByTestId('call-landing-name-early');
      await fireEvent.input(earlyName, { target: { value: 'Ada' } });

      checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', name: 'Weekly', liveCount: 0 });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(screen.getByTestId('call-landing-join')).toBeTruthy();
      expect(/** @type {HTMLInputElement} */ (screen.getByTestId('call-landing-name')).value).toBe(
        'Ada'
      );
    });

    it('auto-switches to the join screen at the pass not-before, without a reload', async () => {
      checkCallPass.mockResolvedValueOnce({
        valid: false,
        reason: 'not_yet',
        notBefore: Math.floor(Date.now() / 1000) + 10,
        liveCount: 0
      });
      render(CallLanding, { props: { pointer: POINTER } });
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByTestId('call-landing-not-yet')).toBeTruthy();

      checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', name: 'Weekly', liveCount: 2 });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(screen.getByTestId('call-landing-join')).toBeTruthy();
    });

    it('falls back to a 60s interval recheck when no exact timer is scheduled', async () => {
      checkCallPass.mockResolvedValueOnce({
        valid: false,
        reason: 'not_yet',
        liveCount: 0
      });
      render(CallLanding, { props: { pointer: POINTER } });
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByTestId('call-landing-not-yet')).toBeTruthy();

      checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', name: 'Weekly', liveCount: 2 });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(screen.getByTestId('call-landing-join')).toBeTruthy();
    });

    it('schedules the exact recheck for a wait beyond the old (buggy) 24h cap', async () => {
      // 25h: exceeds the OLD `24 * 3600 * 1000` cap but is far under the
      // real limit (setTimeout's own ~24.8-day/2^31-1 ms ceiling) — with the
      // bug this delay would never get an exact setTimeout at all, only the
      // 60s fallback interval.
      const delayS = 25 * 3600;
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      checkCallPass.mockResolvedValue({
        valid: false,
        reason: 'not_yet',
        notBefore: Math.floor(Date.now() / 1000) + delayS,
        liveCount: 0
      });
      render(CallLanding, { props: { pointer: POINTER } });
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByTestId('call-landing-not-yet')).toBeTruthy();

      const longDelayCall = setTimeoutSpy.mock.calls.find(
        ([, ms]) => typeof ms === 'number' && ms > 24 * 3600 * 1000
      );
      expect(longDelayCall).toBeTruthy();
      expect(longDelayCall[1]).toBeLessThanOrEqual(2 ** 31 - 1);
      setTimeoutSpy.mockRestore();
    });

    it('applies only the latest of two in-flight rechecks (stale response discarded)', async () => {
      checkCallPass.mockResolvedValueOnce({
        valid: false,
        reason: 'not_yet',
        notBefore: Math.floor(Date.now() / 1000) + 60,
        liveCount: 0
      });
      render(CallLanding, { props: { pointer: POINTER } });
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByTestId('call-landing-not-yet')).toBeTruthy();

      // The 60s fallback interval and the exact 60s timer both fire at the
      // same instant, both calling checkCallPass. The stale (first-sent, but
      // slower) response must not clobber the fresher one, whichever settles
      // last.
      let resolveStale;
      let resolveFresh;
      let call = 0;
      checkCallPass.mockImplementation(
        () =>
          new Promise((r) => {
            call += 1;
            if (call === 1) resolveStale = r;
            else resolveFresh = r;
          })
      );
      await vi.advanceTimersByTimeAsync(60_000);
      expect(call).toBe(2);
      // Fresh (latest) resolves first with 'ok'; the stale one resolves
      // after with a 'not_yet' that must be ignored.
      resolveFresh({ valid: true, reason: 'ok', name: 'Weekly', liveCount: 1 });
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByTestId('call-landing-join')).toBeTruthy();
      resolveStale({
        valid: false,
        reason: 'not_yet',
        notBefore: Math.floor(Date.now() / 1000) + 60,
        liveCount: 0
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByTestId('call-landing-join')).toBeTruthy();
      expect(screen.queryByTestId('call-landing-not-yet')).toBeNull();
    });

    it('cleans up timers on unmount (no stray recheck after the component is gone)', async () => {
      checkCallPass.mockResolvedValueOnce({
        valid: false,
        reason: 'not_yet',
        notBefore: Math.floor(Date.now() / 1000) + 10,
        liveCount: 0
      });
      const { unmount } = render(CallLanding, { props: { pointer: POINTER } });
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByTestId('call-landing-not-yet')).toBeTruthy();
      const callsBeforeUnmount = checkCallPass.mock.calls.length;

      unmount();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(checkCallPass.mock.calls.length).toBe(callsBeforeUnmount);
    });
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
  it('shows a retry and a back button when already in a failed call for this pointer', async () => {
    callState.phase = 'error';
    callState.isActiveFor = () => true;
    activeUser = { pubkey: 'd'.repeat(64), signer: {} };
    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 0 });
    render(CallLanding, { props: { pointer: POINTER } });
    expect(await screen.findByTestId('call-landing-error')).toBeTruthy();

    await fireEvent.click(screen.getByTestId('call-landing-retry'));
    expect(joinGroupCall).toHaveBeenCalledWith(
      POINTER,
      activeUser,
      expect.objectContaining({ code: CODE })
    );

    await fireEvent.click(screen.getByTestId('call-landing-back'));
    expect(leaveGroupCall).toHaveBeenCalled();
  });
  it('tells an unreachable relay apart from an invalid/revoked link, and offers a recheck', async () => {
    checkCallPass.mockResolvedValue({ valid: false, reason: 'unreachable', liveCount: 0 });
    render(CallLanding, { props: { pointer: POINTER } });
    expect(await screen.findByTestId('call-landing-unreachable')).toBeTruthy();
    expect(screen.queryByTestId('call-landing-invalid')).toBeNull();

    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 2 });
    await fireEvent.click(screen.getByTestId('call-landing-recheck'));
    expect(await screen.findByTestId('call-landing-join')).toBeTruthy();
  });

  it('disables the recheck button while in flight and ignores a stale result after unmount', async () => {
    checkCallPass.mockResolvedValueOnce({ valid: false, reason: 'unreachable', liveCount: 0 });
    const { unmount } = render(CallLanding, { props: { pointer: POINTER } });
    await screen.findByTestId('call-landing-unreachable');

    let resolveRecheck;
    checkCallPass.mockReturnValueOnce(new Promise((r) => (resolveRecheck = r)));
    const recheckButton = screen.getByTestId('call-landing-recheck');
    await fireEvent.click(recheckButton);
    expect(/** @type {HTMLButtonElement} */ (recheckButton).disabled).toBe(true);
    await fireEvent.click(recheckButton); // double-click guard: no second request
    expect(checkCallPass).toHaveBeenCalledTimes(2);

    unmount();
    resolveRecheck({ valid: true, reason: 'ok', liveCount: 1 });
    await new Promise((r) => setTimeout(r, 0)); // must not throw on the unmounted component
  });

  it('requires confirmation before forgetting a guest stuck on a failed join', async () => {
    callState.phase = 'error';
    callState.isActiveFor = () => true;
    activeUser = { pubkey: 'f'.repeat(64), signer: {} };
    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 0 });
    render(CallLanding, { props: { pointer: POINTER } });
    const forgetButton = await screen.findByTestId('call-landing-forget');

    await fireEvent.click(forgetButton);
    expect(forgetGuestAccount).not.toHaveBeenCalled();
    expect(screen.getByTestId('call-landing-forget-confirm')).toBeTruthy();

    await fireEvent.click(screen.getByTestId('call-landing-forget-cancel'));
    expect(screen.queryByTestId('call-landing-forget-confirm')).toBeNull();
    expect(forgetGuestAccount).not.toHaveBeenCalled();

    await fireEvent.click(await screen.findByTestId('call-landing-forget'));
    await fireEvent.click(screen.getByTestId('call-landing-forget-confirm'));
    expect(forgetGuestAccount).toHaveBeenCalledWith(activeUser.pubkey);
  });

  it('shows an inline message and a login button when the active account cannot sign', async () => {
    activeUser = { pubkey: 'h'.repeat(64), signer: null };
    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 2 });
    render(CallLanding, { props: { pointer: POINTER } });
    expect(await screen.findByTestId('call-landing-no-signer')).toBeTruthy();
    expect(screen.queryByTestId('call-landing-join-as')).toBeNull();

    await fireEvent.click(screen.getByTestId('call-landing-switch-login'));
    expect(mockModalStore.openModal).toHaveBeenCalledWith('login');
  });

  it.each([
    [0, () => m.call_landing_live_empty()],
    [1, () => m.call_landing_live_one()],
    [4, () => m.call_landing_live({ count: 4 })]
  ])('shows the live-count copy for %i participant(s)', async (count, expected) => {
    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: count });
    render(CallLanding, { props: { pointer: POINTER } });
    await screen.findByTestId('call-landing-join');
    expect(screen.getByText(expected())).toBeTruthy();
  });

  it('offers "Profil vervollständigen" with the active account\'s kind-0 name when the input is empty', async () => {
    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 1 });
    activeUser = { pubkey: 'g'.repeat(64), signer: {} };
    getProfile.mockReturnValue({ name: 'Ada Account' });

    const { rerender } = render(CallLanding, { props: { pointer: POINTER } });

    // Actually connect (phase 'ready' AND connected) ...
    callState.phase = 'ready';
    callState.connected = true;
    callState.isActiveFor = () => true;
    await rerender({ pointer: { ...POINTER } });
    await screen.findByTestId('group-call-stage-stub');

    // ... then leave: only now does the post-call screen latch.
    callState.isActiveFor = () => false;
    callState.phase = 'idle';
    await rerender({ pointer: { ...POINTER } });

    await fireEvent.click(await screen.findByTestId('call-landing-complete'));
    expect(mockModalStore.openModal).toHaveBeenCalledWith('signup', {
      externalSignup: true,
      initialName: 'Ada Account'
    });
  });

  it('a guest removed from the call (revoked link) leaves the stage for the end screen and is told why', async () => {
    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 1 });
    activeUser = { pubkey: 'h'.repeat(64), signer: {} };
    const { rerender } = render(CallLanding, { props: { pointer: POINTER } });

    callState.phase = 'ready';
    callState.connected = true;
    callState.isActiveFor = () => true;
    await rerender({ pointer: { ...POINTER } });
    await screen.findByTestId('group-call-stage-stub');

    // The relay removed the guest: the store ends the call (still active
    // for this channel until left).
    callState.phase = 'ended';
    callState.connected = false;
    callState.endReason = 'removed';
    await rerender({ pointer: { ...POINTER } });

    expect(await screen.findByTestId('call-landing-ended')).toBeTruthy();
    expect(screen.queryByTestId('group-call-stage-stub')).toBeNull();
    expect(screen.getByTestId('call-landing-removed').textContent).toContain(
      m.call_landing_removed()
    );
    // still offered the guest's keep/forget choices
    expect(screen.getByTestId('call-landing-backup')).toBeTruthy();
    expect(screen.getByTestId('call-landing-forget')).toBeTruthy();
  });

  it('a dropped connection shows the end screen without the removal note', async () => {
    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 1 });
    activeUser = { pubkey: 'h'.repeat(64), signer: {} };
    const { rerender } = render(CallLanding, { props: { pointer: POINTER } });
    callState.phase = 'ready';
    callState.connected = true;
    callState.isActiveFor = () => true;
    await rerender({ pointer: { ...POINTER } });
    await screen.findByTestId('group-call-stage-stub');
    callState.phase = 'ended';
    callState.connected = false;
    callState.endReason = 'dropped';
    await rerender({ pointer: { ...POINTER } });
    expect(await screen.findByTestId('call-landing-ended')).toBeTruthy();
    expect(screen.queryByTestId('call-landing-removed')).toBeNull();
  });

  // QA round 2 N1: at 390 the chat squeezed the stage into a 30 px strip.
  it('on a phone the call chat replaces the stage, and the chat bar brings it back', async () => {
    await renderInCall();
    await fireEvent.click(screen.getByTestId('group-call-stage-stub-chat'));
    expect(await screen.findByTestId('call-chat-panel')).toBeTruthy();
    expect(screen.queryByTestId('group-call-stage-stub')).toBeNull();
    expect(toggleChatBeside).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByTestId('call-landing-chat-back'));
    expect(await screen.findByTestId('group-call-stage-stub')).toBeTruthy();
    expect(screen.queryByTestId('call-chat-panel')).toBeNull();
  });
  it("the landing's call view stays registered as on screen while the chat replaces the stage (no dock)", async () => {
    let live = 0;
    registerCallStageView.mockImplementation(() => {
      live++;
      let done = false;
      return () => {
        if (!done) live--;
        done = true;
      };
    });
    await renderInCall();
    await fireEvent.click(screen.getByTestId('group-call-stage-stub-chat'));
    await screen.findByTestId('call-chat-panel');
    expect(screen.queryByTestId('group-call-stage-stub')).toBeNull();
    expect(live).toBeGreaterThan(0);
  });
  it('registers the in-call view with the landing href for the stage, failure and spinner phases', async () => {
    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 1 });
    activeUser = { pubkey: 'h'.repeat(64), signer: {} };
    callState.phase = 'requesting';
    callState.isActiveFor = () => true;
    render(CallLanding, { props: { pointer: POINTER } });
    await screen.findByTestId('call-landing-in-call');
    expect(registerCallStageView).toHaveBeenCalledWith(
      `${window.location.pathname}${window.location.hash}`
    );
  });
  // QA round 2 C-new-3: wide screens open the chat beside the stage.
  it('on md+ the call chat opens beside the stage by default (chatBeside pref)', async () => {
    setWide(true);
    await renderInCall();
    expect(await screen.findByTestId('call-chat-panel')).toBeTruthy();
    expect(screen.getByTestId('group-call-stage-stub').dataset.chatOpen).toBe('true');
    expect(screen.queryByTestId('call-landing-chat-back')).toBeNull();
    await fireEvent.click(screen.getByTestId('group-call-stage-stub-chat'));
    expect(toggleChatBeside).toHaveBeenCalled();
  });
  it('on md+ a closed chatBeside pref keeps the chat closed', async () => {
    setWide(true);
    callState.chatBeside = false;
    await renderInCall();
    expect(screen.queryByTestId('call-chat-panel')).toBeNull();
  });
  // QA round 2 N2: the relay deletes call-scoped passes when the call ends.
  it('an unknown pass says the call ended or the link was revoked', async () => {
    checkCallPass.mockResolvedValue({ valid: false, reason: 'unknown', liveCount: 0 });
    render(CallLanding, { props: { pointer: POINTER } });
    const card = await screen.findByTestId('call-landing-invalid');
    expect(card.textContent).toContain(m.call_landing_invalid());
  });
  it('keeps the specific copy for call_ended and expired', async () => {
    checkCallPass.mockResolvedValue({ valid: false, reason: 'expired', liveCount: 0 });
    render(CallLanding, { props: { pointer: POINTER } });
    expect((await screen.findByTestId('call-landing-invalid')).textContent).toContain(
      m.call_landing_expired()
    );
  });
  // QA round 2 C-new-5: rejoin while the pass still works.
  it('the end screen re-checks the pass and offers "Wieder beitreten" only while it is ok', async () => {
    const { rerender } = await renderInCall();
    checkCallPass.mockClear();
    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 2 });
    callState.isActiveFor = () => false;
    callState.phase = 'idle';
    callState.connected = false;
    await rerender({ pointer: { ...POINTER } });
    await fireEvent.click(await screen.findByTestId('call-landing-rejoin'));
    expect(checkCallPass).toHaveBeenCalled();
    expect(joinGroupCall).toHaveBeenCalledWith(
      POINTER,
      activeUser,
      expect.objectContaining({ code: CODE })
    );
  });
  it('no "Wieder beitreten" once the pass is gone', async () => {
    const { rerender } = await renderInCall();
    checkCallPass.mockResolvedValue({ valid: false, reason: 'unknown', liveCount: 0 });
    callState.isActiveFor = () => false;
    callState.phase = 'idle';
    callState.connected = false;
    await rerender({ pointer: { ...POINTER } });
    await screen.findByTestId('call-landing-ended');
    await waitFor(() => expect(checkCallPass.mock.calls.length).toBeGreaterThan(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('call-landing-rejoin')).toBeNull();
  });
  it('after "Vergessen" it says the identity was deleted from this browser', async () => {
    const { rerender } = await renderInCall();
    callState.isActiveFor = () => false;
    callState.phase = 'idle';
    callState.connected = false;
    await rerender({ pointer: { ...POINTER } });
    await fireEvent.click(await screen.findByTestId('call-landing-forget'));
    await fireEvent.click(screen.getByTestId('call-landing-forget-confirm'));
    expect(forgetGuestAccount).toHaveBeenCalledWith('h'.repeat(64));
    expect((await screen.findByTestId('call-landing-forgotten')).textContent).toContain(
      m.call_landing_forgotten()
    );
  });
  // QA round 2 C-new-6
  it('a removed guest\'s end screen is titled neutrally, not "thanks for joining"', async () => {
    const { rerender } = await renderInCall();
    callState.phase = 'ended';
    callState.connected = false;
    callState.endReason = 'removed';
    await rerender({ pointer: { ...POINTER } });
    const ended = await screen.findByTestId('call-landing-ended');
    expect(ended.textContent).toContain(m.call_landing_removed_title());
    expect(ended.textContent).not.toContain(m.call_landing_after_title());
  });
  // Live 2026-10-02: removing the account re-mounts the route, which lost
  // the in-component "forgotten" state and showed the invalid-link page.
  it('the "identity deleted" note survives the re-mount that removing the account causes', async () => {
    const first = await renderInCall();
    callState.isActiveFor = () => false;
    callState.phase = 'idle';
    callState.connected = false;
    await first.rerender({ pointer: { ...POINTER } });
    await fireEvent.click(await screen.findByTestId('call-landing-forget'));
    await fireEvent.click(screen.getByTestId('call-landing-forget-confirm'));
    first.unmount();
    activeUser = null;
    checkCallPass.mockResolvedValue({ valid: false, reason: 'unknown', liveCount: 0 });
    const second = render(CallLanding, { props: { pointer: POINTER } });
    expect(await screen.findByTestId('call-landing-forgotten')).toBeTruthy();
    second.unmount();
    // only once: a later visit starts fresh
    render(CallLanding, { props: { pointer: POINTER } });
    expect(await screen.findByTestId('call-landing-invalid')).toBeTruthy();
  });
  // Task 16 review: the relay keeps a removed guest out even while the
  // link stays valid ("blocked: you were removed").
  it('no "Wieder beitreten" for a guest who was removed, even while the pass is ok', async () => {
    const { rerender } = await renderInCall();
    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 2 });
    callState.phase = 'ended';
    callState.connected = false;
    callState.endReason = 'removed';
    await rerender({ pointer: { ...POINTER } });
    await screen.findByTestId('call-landing-removed');
    await waitFor(() => expect(checkCallPass.mock.calls.length).toBeGreaterThan(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('call-landing-rejoin')).toBeNull();
  });
  it('"Wieder beitreten" joins only once on a double click', async () => {
    const { rerender } = await renderInCall();
    checkCallPass.mockResolvedValue({ valid: true, reason: 'ok', liveCount: 2 });
    callState.isActiveFor = () => false;
    callState.phase = 'idle';
    callState.connected = false;
    await rerender({ pointer: { ...POINTER } });
    let finish = () => {};
    joinGroupCall.mockClear();
    joinGroupCall.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const button = await screen.findByTestId('call-landing-rejoin');
    await fireEvent.click(button);
    await fireEvent.click(button);
    expect(joinGroupCall).toHaveBeenCalledTimes(1);
    finish();
  });
});
