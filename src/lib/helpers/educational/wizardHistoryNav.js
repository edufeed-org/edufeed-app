/**
 * Wire `window.history` so the browser back/forward buttons walk wizard steps
 * instead of leaving the wizard.
 *
 * Behaviour:
 *  - On init, stamps the current history entry with a per-instance marker so
 *    we can recognise our own entries when popstate fires.
 *  - `pushIfChanged(state)` pushes a new history entry whenever the wizard
 *    advances to a step the user hasn't seen yet in this navigation chain.
 *    De-dupes against the last entry we pushed.
 *  - On popstate to one of our entries, calls `onPop(state)` so the caller
 *    can mirror it into component state. Popping *past* the initial wizard
 *    entry yields a popstate with state from some other (non-wizard) entry,
 *    which we ignore so the default route handler can navigate away.
 *
 * The caller is expected to update component state inside `onPop` and then
 * call `pushIfChanged` from a reactive effect; the popstate-driven update
 * deliberately bumps `last` so the immediate follow-up push is suppressed.
 *
 * @param {object} args
 * @param {WizardNavState} args.initial
 * @param {(state: WizardNavState) => void} args.onPop
 * @param {Window} [args.win]
 * @returns {WizardHistoryNav}
 */
export function attachWizardHistoryNav({ initial, onPop, win = window }) {
  const instanceId = `comcal:wizard:${Math.random().toString(36).slice(2)}`;

  // Stamp the current entry so popping to it later is recognisable. Preserve
  // any state SvelteKit (or another owner) already wrote there.
  win.history.replaceState(
    { ...(win.history.state ?? {}), wizardInstanceId: instanceId, wizardState: { ...initial } },
    ''
  );

  let last = { ...initial };

  /** @param {PopStateEvent} e */
  function onPopState(e) {
    const s = /** @type {any} */ (e.state);
    if (!s || s.wizardInstanceId !== instanceId) return;
    last = { ...s.wizardState };
    onPop({ ...s.wizardState });
  }

  win.addEventListener('popstate', onPopState);

  return {
    /** @param {WizardNavState} state */
    pushIfChanged(state) {
      if (state.step === last.step && state.subStep === last.subStep) return;
      win.history.pushState(
        {
          ...(win.history.state ?? {}),
          wizardInstanceId: instanceId,
          wizardState: { ...state }
        },
        ''
      );
      last = { ...state };
    },
    destroy() {
      win.removeEventListener('popstate', onPopState);
    }
  };
}

/**
 * @typedef {{ step: number, subStep: string | null }} WizardNavState
 */

/**
 * @typedef {{
 *   pushIfChanged: (state: WizardNavState) => void,
 *   destroy: () => void
 * }} WizardHistoryNav
 */
