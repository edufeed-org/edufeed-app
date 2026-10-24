// @ts-nocheck
/** @vitest-environment node */
// Kanban boards (kind 30301) that never got a name: the external editor
// creates "Untitled Board" / "Shared 12345" and most of them stay that way.
// They carry no information for a reader, so the feeds leave them out.
import { describe, it, expect } from 'vitest';
import {
  getBoardTitle,
  isPlaceholderBoard,
  withoutPlaceholderBoards
} from '$lib/helpers/kanban-boards.js';

const board = (/** @type {string[][]} */ tags, id = 'b') => ({
  id,
  kind: 30301,
  pubkey: 'a'.repeat(64),
  created_at: 1,
  content: '',
  tags
});

describe('kanban board titles', () => {
  it('reads the title, then the name, else the Untitled fallback', () => {
    expect(getBoardTitle(board([['title', 'Unterrichtsplanung']]))).toBe('Unterrichtsplanung');
    expect(getBoardTitle(board([['name', 'Projektwoche']]))).toBe('Projektwoche');
    expect(getBoardTitle(board([['d', 'x']]))).toBe('Untitled Board');
  });

  it('treats missing, Untitled and "Shared <number>" titles as placeholders', () => {
    expect(isPlaceholderBoard(board([['d', 'x']]))).toBe(true);
    expect(isPlaceholderBoard(board([['title', 'Untitled Board']]))).toBe(true);
    expect(isPlaceholderBoard(board([['title', 'untitled board ']]))).toBe(true);
    expect(isPlaceholderBoard(board([['title', 'Shared 73438']]))).toBe(true);
    expect(isPlaceholderBoard(board([['title', '   ']]))).toBe(true);
    expect(isPlaceholderBoard(board([['title', 'Shared Lesson Ideas']]))).toBe(false);
    expect(isPlaceholderBoard(board([['title', 'Unterrichtsplanung']]))).toBe(false);
  });

  it('withoutPlaceholderBoards drops only placeholder boards and leaves other kinds alone', () => {
    const named = board([['title', 'Kurs']], 'named');
    const untitled = board([['title', 'Untitled Board']], 'untitled');
    const article = { ...board([], 'art'), kind: 30023 };
    expect(withoutPlaceholderBoards([named, untitled, article])).toEqual([named, article]);
    const clean = [named, article];
    expect(withoutPlaceholderBoards(clean)).toBe(clean);
  });
});
