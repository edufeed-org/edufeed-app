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
  openCount: 0,
  available: false
});

export function openTermi() {
  termiLauncher.open = true;
}

export function closeTermi() {
  termiLauncher.open = false;
  termiLauncher.expanded = false;
}
