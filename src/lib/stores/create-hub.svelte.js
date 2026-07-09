/**
 * Cross-tree signal to open the GlobalFAB create hub from anywhere
 * (e.g. the Home view's "create content" quick action). GlobalFAB
 * watches `requested` and resets it after opening its sheet.
 */
export const createHub = $state({ requested: false });

export function openCreateHub() {
  createHub.requested = true;
}
