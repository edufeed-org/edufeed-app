/**
 * Shared open/closed state of the Termi assistant. On desktop the floating
 * launcher in TermiAssistant opens the chat window; on phones the launcher
 * lives in the headers (Navbar, /c mobile header) and opens it through this
 * store. `available` is set by TermiAssistant while it is mounted, so header
 * launchers vanish on pages where the assistant is not rendered (chat views).
 */
export const termiLauncher = $state({
  open: false,
  expanded: false,
  // the full-screen Werkbank (a lesson series or a document beside the chat)
  workbench: false,
  // a draft the window should open once its history is ready (openDraft)
  pendingId: /** @type {string | null} */ (null),
  openCount: 0,
  available: false
});

export function openTermi() {
  termiLauncher.open = true;
}

/** Opens the window on a stored draft; the Werkbank follows once it really opened as one. @param {string} id */
export function openDraft(id) {
  termiLauncher.open = true;
  termiLauncher.pendingId = id;
}

export function closeTermi() {
  termiLauncher.pendingId = null;
  termiLauncher.open = false;
  termiLauncher.expanded = false;
  termiLauncher.workbench = false;
}
