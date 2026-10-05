/**
 * Kanban boards (kind 30301) are view-only in the app — creating and editing
 * happens in the external edufeed Kanban editor. Every link into it is built
 * here so the base URL lives in one place.
 */

/** Root of the external Kanban editor (creating a new board starts here). */
export const KANBAN_EDITOR_URL = 'https://kanban.edufeed.org/';

/**
 * Editor URL for an existing board.
 * @param {string | null | undefined} naddr - NIP-19 naddr of the kind 30301 board
 * @returns {string | null}
 */
export function getKanbanEditorBoardUrl(naddr) {
  return naddr ? `${KANBAN_EDITOR_URL}cardsboard/${naddr}` : null;
}
