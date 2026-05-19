/**
 * Wizard browser-history integration.
 *
 * Mouse-back / browser-back should walk wizard steps (not leave the wizard)
 * until the user is past step 1, at which point the browser navigates away
 * normally. `attachWizardHistoryNav` wires that up against `window.history`.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attachWizardHistoryNav } from '$lib/helpers/educational/wizardHistoryNav.js';

/**
 * Build a popstate event with state shaped like the helper's own entries.
 * Used to simulate what the browser fires when popping back to a wizard
 * entry without depending on jsdom's async history.back() behavior.
 *
 * @param {string} instanceId
 * @param {{ step: number, subStep: string | null }} wizardState
 */
function popWizard(instanceId, wizardState) {
  window.dispatchEvent(
    new PopStateEvent('popstate', { state: { wizardInstanceId: instanceId, wizardState } })
  );
}

describe('attachWizardHistoryNav', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('stamps the current history entry with an instance id on init', () => {
    attachWizardHistoryNav({
      initial: { step: 1, subStep: null },
      onPop: () => {}
    });
    expect(window.history.state?.wizardInstanceId).toMatch(/^comcal:wizard:/);
    expect(window.history.state?.wizardState).toEqual({ step: 1, subStep: null });
  });

  it('pushIfChanged adds a new history entry per distinct step', () => {
    const before = window.history.length;
    const nav = attachWizardHistoryNav({
      initial: { step: 1, subStep: null },
      onPop: () => {}
    });
    nav.pushIfChanged({ step: 2, subStep: null });
    nav.pushIfChanged({ step: 3, subStep: null });
    expect(window.history.length).toBe(before + 2);
  });

  it('pushIfChanged is a no-op when the state matches the last push', () => {
    const nav = attachWizardHistoryNav({
      initial: { step: 1, subStep: null },
      onPop: () => {}
    });
    nav.pushIfChanged({ step: 2, subStep: null });
    const after = window.history.length;
    nav.pushIfChanged({ step: 2, subStep: null });
    expect(window.history.length).toBe(after);
  });

  it('treats sub-step changes as distinct entries', () => {
    const nav = attachWizardHistoryNav({
      initial: { step: 4, subStep: '4a' },
      onPop: () => {}
    });
    const before = window.history.length;
    nav.pushIfChanged({ step: 4, subStep: '4b' });
    nav.pushIfChanged({ step: 4, subStep: '4c' });
    expect(window.history.length).toBe(before + 2);
  });

  it('fires onPop when popstate carries this instance’s wizard state', () => {
    const onPop = vi.fn();
    attachWizardHistoryNav({
      initial: { step: 1, subStep: null },
      onPop
    });
    const id = window.history.state.wizardInstanceId;

    popWizard(id, { step: 2, subStep: null });

    expect(onPop).toHaveBeenCalledWith({ step: 2, subStep: null });
  });

  it('ignores popstate from another wizard instance', () => {
    const onPop = vi.fn();
    attachWizardHistoryNav({
      initial: { step: 1, subStep: null },
      onPop
    });
    popWizard('comcal:wizard:someone-else', { step: 2, subStep: null });
    expect(onPop).not.toHaveBeenCalled();
  });

  it('ignores popstate from a non-wizard history entry (so route nav still works)', () => {
    const onPop = vi.fn();
    attachWizardHistoryNav({
      initial: { step: 1, subStep: null },
      onPop
    });
    window.dispatchEvent(new PopStateEvent('popstate', { state: { sveltekit: true } }));
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    expect(onPop).not.toHaveBeenCalled();
  });

  it('does not re-push after a popstate-driven state change', () => {
    const onPop = vi.fn();
    const nav = attachWizardHistoryNav({
      initial: { step: 1, subStep: null },
      onPop
    });
    const id = window.history.state.wizardInstanceId;
    nav.pushIfChanged({ step: 2, subStep: null });
    nav.pushIfChanged({ step: 3, subStep: null });

    // Simulate browser back to step 2 — handler runs synchronously.
    popWizard(id, { step: 2, subStep: null });
    const lenAfterPop = window.history.length;

    // Caller mirrors the popstate state into component state and re-runs the
    // push effect. That second push must be skipped (we just got there via
    // popstate; pushing would corrupt the back stack).
    nav.pushIfChanged({ step: 2, subStep: null });
    expect(window.history.length).toBe(lenAfterPop);
  });

  it('destroy() detaches the popstate listener', () => {
    const onPop = vi.fn();
    const nav = attachWizardHistoryNav({
      initial: { step: 1, subStep: null },
      onPop
    });
    const id = window.history.state.wizardInstanceId;
    nav.destroy();
    popWizard(id, { step: 1, subStep: null });
    expect(onPop).not.toHaveBeenCalled();
  });

  it('preserves any pre-existing history.state keys (e.g. SvelteKit)', () => {
    window.history.replaceState({ sveltekit: { route: '/x' } }, '', '/x');
    const nav = attachWizardHistoryNav({
      initial: { step: 1, subStep: null },
      onPop: () => {}
    });
    expect(window.history.state?.sveltekit).toEqual({ route: '/x' });

    nav.pushIfChanged({ step: 2, subStep: null });
    expect(window.history.state?.sveltekit).toEqual({ route: '/x' });
    expect(window.history.state?.wizardState).toEqual({ step: 2, subStep: null });
  });
});
