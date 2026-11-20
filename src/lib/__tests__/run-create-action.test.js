// @ts-nocheck
/**
 * runCreateAction — the FAB's create-action body, shared with Termi.
 * Readonly accounts get the upgrade prompt and never run the action;
 * anonymous users keep the existing per-action login-prompt behavior.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const showToast = vi.fn();
vi.mock('$lib/helpers/toast.js', () => ({ showToast: (...args) => showToast(...args) }));
vi.mock('$lib/paraglide/messages', () => ({
  readonly_sign_prompt: () => 'read-only prompt'
}));

const mockOpenModal = vi.fn();
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { openModal: (...args) => mockOpenModal(...args) }
}));

const mockStartResourceCreation = vi.fn();
vi.mock('$lib/helpers/contentCreation.js', () => ({
  startResourceCreation: (...args) => mockStartResourceCreation(...args)
}));

const accountState = vi.hoisted(() => ({ active: /** @type {any} */ (null) }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: accountState
}));

describe('runCreateAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountState.active = null;
  });

  it('blocks a readonly active account and never calls action.run', async () => {
    const { runCreateAction } = await import('../helpers/run-create-action.js');
    accountState.active = { type: 'readonly' };
    const run = vi.fn();
    const goto = vi.fn();
    const resolve = vi.fn();

    const result = runCreateAction({ run }, { communityPubkey: 'abc', goto, resolve });

    expect(result).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('read-only prompt', 'warning');
  });

  it('runs the action with communityPubkey undefined for an anonymous user', async () => {
    const { runCreateAction } = await import('../helpers/run-create-action.js');
    accountState.active = null;
    const run = vi.fn();
    const goto = vi.fn();
    const resolve = vi.fn();

    const result = runCreateAction({ run }, { goto, resolve });

    expect(result).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    const ctx = run.mock.calls[0][0];
    expect(ctx.communityPubkey).toBeUndefined();
    expect(ctx.goto).toBe(goto);
    expect(ctx.resolve).toBe(resolve);
    expect(typeof ctx.openModal).toBe('function');
    expect(typeof ctx.startResourceCreation).toBe('function');
  });

  it('runs the action for a signing account, passing communityPubkey through', async () => {
    const { runCreateAction } = await import('../helpers/run-create-action.js');
    accountState.active = { type: 'extension' };
    const run = vi.fn();
    const goto = vi.fn();
    const resolve = vi.fn();

    const result = runCreateAction({ run }, { communityPubkey: 'deadbeef', goto, resolve });

    expect(result).toBe(true);
    const ctx = run.mock.calls[0][0];
    expect(ctx.communityPubkey).toBe('deadbeef');
  });

  it('ctx.openModal delegates to modalStore.openModal', async () => {
    const { runCreateAction } = await import('../helpers/run-create-action.js');
    const run = vi.fn();
    runCreateAction({ run }, { goto: vi.fn(), resolve: vi.fn() });
    const ctx = run.mock.calls[0][0];
    ctx.openModal('createPoll', { foo: 1 });
    expect(mockOpenModal).toHaveBeenCalledWith('createPoll', { foo: 1 });
  });

  it('ctx.startResourceCreation delegates with communityPubkey', async () => {
    const { runCreateAction } = await import('../helpers/run-create-action.js');
    const run = vi.fn();
    runCreateAction({ run }, { communityPubkey: 'cp', goto: vi.fn(), resolve: vi.fn() });
    const ctx = run.mock.calls[0][0];
    ctx.startResourceCreation();
    expect(mockStartResourceCreation).toHaveBeenCalledWith({ communityPubkey: 'cp' });
  });
});
