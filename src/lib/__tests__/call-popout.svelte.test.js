// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * call-popout.svelte.js — the running call in its own always-on-top window
 * (Document Picture-in-Picture, Chromium only). The pop-out is a second VIEW
 * of the one call: it mounts the call stage into the window's document and
 * registers it as on screen (so the dock steps aside), and closing the
 * window — by the user, by "back to tab" or because the call ended — puts
 * everything back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

const requestGroupCallToken = vi.fn();
const lkListener = vi.hoisted(() => ({ cb: /** @type {any} */ (null) }));
vi.mock('$lib/groups/livekit.js', async (importOriginal) => ({
  .../** @type {any} */ (await importOriginal()),
  requestGroupCallToken: (/** @type {any[]} */ ...args) => requestGroupCallToken(...args)
}));
vi.mock('$lib/services/livekit-connection.svelte.js', () => ({
  disconnectFromRoom: async () => {},
  connectToRoom: async () => {},
  onRoomDisconnected: (/** @type {any} */ cb) => {
    lkListener.cb = cb;
    return () => {};
  },
  isRemovalReason: () => true
}));
vi.mock('$lib/paraglide/messages', () => ({}));
vi.mock(
  '$lib/components/groups/CallLeaveConfirmModal.svelte',
  () => import('../components/__tests__/fixtures/CallLeaveConfirmStub.svelte')
);
vi.mock(
  '$lib/components/groups/call/GroupCallStage.svelte',
  () => import('../components/__tests__/fixtures/GroupCallStageStub.svelte')
);

const { joinGroupCall, leaveGroupCall, getGroupCallState } = await import(
  '$lib/groups/group-call.svelte.js'
);
const { canPopOutCall, popOutCall, popInCall, getCallPopoutState } = await import(
  '$lib/groups/call-popout.svelte.js'
);

const P1 = { id: 'room-1', relay: 'wss://groups.example/' };
const USER = { pubkey: 'a'.repeat(64), signer: { signEvent: vi.fn() } };
const VIEW = { title: 'Standup', identityToPubkey: (/** @type {string} */ id) => id };

/** A Document PiP window as far as the module uses it. */
function fakePipWindow() {
  const doc = document.implementation.createHTMLDocument('');
  const win = Object.assign(new EventTarget(), {
    document: doc,
    close: vi.fn(() => win.dispatchEvent(new Event('pagehide')))
  });
  return win;
}

/** @type {ReturnType<typeof fakePipWindow>} */
let pip;
const requestWindow = vi.fn();

beforeEach(async () => {
  await leaveGroupCall();
  pip = fakePipWindow();
  requestWindow.mockReset();
  requestWindow.mockImplementation(async () => pip);
  window.documentPictureInPicture = { requestWindow };
  requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://lk', participantToken: 'jwt' });
  await joinGroupCall(P1, USER);
});

afterEach(() => {
  popInCall();
  delete window.documentPictureInPicture;
  document.head.querySelectorAll('[data-test-style]').forEach((n) => n.remove());
});

describe('canPopOutCall', () => {
  it('only where the browser has Document Picture-in-Picture', () => {
    expect(canPopOutCall()).toBe(true);
    delete window.documentPictureInPicture;
    expect(canPopOutCall()).toBe(false);
  });
});

describe('popOutCall', () => {
  it('mounts the call stage in the new window and counts it as on screen', async () => {
    await popOutCall(VIEW);
    expect(requestWindow).toHaveBeenCalledTimes(1);
    expect(getCallPopoutState().open).toBe(true);
    const stage = pip.document.querySelector('[data-testid="group-call-stage-stub"]');
    expect(stage?.textContent).toContain('Standup');
    // no chat and no second pop-out from inside the pop-out, but a way back
    expect(pip.document.querySelector('[data-testid="group-call-stage-stub-chat"]')).toBeNull();
    expect(pip.document.querySelector('[data-testid="group-call-stage-stub-popout"]')).toBeNull();
    expect(pip.document.querySelector('[data-testid="group-call-stage-stub-popin"]')).toBeTruthy();
    expect(getGroupCallState().stageViews).toBe(1);
  });

  it("carries the app's styles and theme into the window", async () => {
    const style = document.createElement('style');
    style.dataset.testStyle = '';
    style.textContent = '.probe { color: red; }';
    document.head.append(style);
    document.documentElement.setAttribute('data-theme', 'stil');
    try {
      await popOutCall(VIEW);
      expect(pip.document.head.innerHTML).toContain('.probe { color: red; }');
      expect(pip.document.documentElement.getAttribute('data-theme')).toBe('stil');
    } finally {
      document.documentElement.removeAttribute('data-theme');
    }
  });

  it('opens one window at a time', async () => {
    await popOutCall(VIEW);
    await popOutCall(VIEW);
    expect(requestWindow).toHaveBeenCalledTimes(1);
  });

  it('does nothing without the API', async () => {
    delete window.documentPictureInPicture;
    await popOutCall(VIEW);
    expect(getCallPopoutState().open).toBe(false);
  });
});

describe('closing the pop-out', () => {
  it('the user closing the window unmounts the stage and hands back to the page', async () => {
    await popOutCall(VIEW);
    pip.dispatchEvent(new Event('pagehide'));
    expect(getCallPopoutState().open).toBe(false);
    expect(getGroupCallState().stageViews).toBe(0);
    expect(pip.document.querySelector('[data-testid="group-call-stage-stub"]')).toBeNull();
  });

  it('"back to tab" closes the window', async () => {
    await popOutCall(VIEW);
    pip.document.querySelector('[data-testid="group-call-stage-stub-popin"]').click();
    expect(pip.close).toHaveBeenCalled();
    expect(getCallPopoutState().open).toBe(false);
  });

  it('the server ending the call closes the window (the channel shows why)', async () => {
    await popOutCall(VIEW);
    lkListener.cb?.(4);
    flushSync();
    expect(getGroupCallState().phase).toBe('ended');
    expect(pip.close).toHaveBeenCalled();
    expect(getCallPopoutState().open).toBe(false);
  });

  it('leaving the call closes the window', async () => {
    await popOutCall(VIEW);
    await leaveGroupCall();
    flushSync();
    expect(pip.close).toHaveBeenCalled();
    expect(getCallPopoutState().open).toBe(false);
  });

  // Task 19: the opener's modal layer is invisible from the pop-out, so the
  // "Anruf verlassen?" confirm is mounted into the window itself.
  describe('leaving from inside the pop-out asks in the window', () => {
    const q = (id) => pip.document.querySelector(`[data-testid="${id}"]`);
    const settle = () => new Promise((r) => setTimeout(r, 0));

    it('Cancel keeps the call and the window', async () => {
      await popOutCall(VIEW);
      q('group-call-stage-stub-leave').click();
      await vi.waitFor(() => expect(q('call-leave-confirm-stub')).toBeTruthy());
      expect(document.querySelector('[data-testid="call-leave-confirm-stub"]')).toBeNull();
      q('call-leave-confirm-stub-cancel').click();
      await settle();
      expect(q('call-leave-confirm-stub')).toBeNull();
      expect(getGroupCallState().phase).toBe('ready');
      expect(getCallPopoutState().open).toBe(true);
    });

    it('Leave leaves the call (and the window closes with it)', async () => {
      await popOutCall(VIEW);
      q('group-call-stage-stub-leave').click();
      await vi.waitFor(() => expect(q('call-leave-confirm-stub')).toBeTruthy());
      q('call-leave-confirm-stub-confirm').click();
      await vi.waitFor(() => expect(getGroupCallState().phase).toBe('idle'));
      flushSync();
      expect(getCallPopoutState().open).toBe(false);
    });

    it('closing the window while it asks counts as cancel', async () => {
      await popOutCall(VIEW);
      q('group-call-stage-stub-leave').click();
      await vi.waitFor(() => expect(q('call-leave-confirm-stub')).toBeTruthy());
      pip.dispatchEvent(new Event('pagehide'));
      await settle();
      expect(getGroupCallState().phase).toBe('ready');
    });
  });
});
