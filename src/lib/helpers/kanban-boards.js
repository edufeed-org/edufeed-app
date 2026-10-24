/**
 * Kanban board (kind 30301) display helpers.
 *
 * Boards are authored in the external Kanban editor, which names a new board
 * "Untitled Board" and a shared copy "Shared <number>" until the owner renames
 * it. Most never are, and a feed card showing only that placeholder carries
 * no information for a reader, so the feeds drop them (laoc, 2026-10-24).
 */
export const UNTITLED_BOARD = 'Untitled Board';

/** Dependency-free tag read: this helper is also used by the SSR OG-tag path. */
const tag = (/** @type {{ tags?: string[][] }} */ event, /** @type {string} */ name) =>
  event.tags?.find((t) => t[0] === name)?.[1];

/**
 * The board's title: `title` tag, then `name` tag, else the Untitled fallback.
 * @param {{ tags?: string[][] }} board
 */
export function getBoardTitle(board) {
  return tag(board, 'title') || tag(board, 'name') || UNTITLED_BOARD;
}

/**
 * Whether the board only carries the editor's placeholder name.
 * @param {{ tags?: string[][] }} board
 */
export function isPlaceholderBoard(board) {
  const title = getBoardTitle(board).trim();
  return title === '' || /^untitled board$/i.test(title) || /^shared \d+$/i.test(title);
}

/**
 * Events without placeholder boards; other kinds pass through untouched and
 * the same array is returned when nothing was dropped.
 * @template {{ kind: number, tags?: string[][] }} T
 * @param {T[]} events
 * @returns {T[]}
 */
export function withoutPlaceholderBoards(events) {
  const kept = events.filter((e) => e.kind !== 30301 || !isPlaceholderBoard(e));
  return kept.length === events.length ? events : kept;
}
