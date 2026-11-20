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
  // the full view for a long chat (chat list beside a centred column); closing keeps it, so the
  // next open of this page session returns to it
  full: false,
  // the full-screen Werkbank (a lesson series or a document beside the chat)
  workbench: false,
  // a draft the window should open once its history is ready (openDraft)
  pendingId: /** @type {string | null} */ (null),
  // what the window should start once it is up (the tour's "try it now")
  pendingStart: /** @type {'material' | 'lesson' | 'import' | null} */ (null),
  // the conversation the window showed last, and whether the Werkbank was open: the next open of
  // this page session returns to it (module state, so a reload starts a new chat)
  lastId: /** @type {string | null} */ (null),
  lastWorkbench: false,
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
  termiLauncher.lastWorkbench = termiLauncher.workbench;
  termiLauncher.open = false;
  termiLauncher.expanded = false;
  termiLauncher.workbench = false;
}
