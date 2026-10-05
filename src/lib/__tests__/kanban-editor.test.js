/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { KANBAN_EDITOR_URL, getKanbanEditorBoardUrl } from '$lib/helpers/kanban-editor.js';

describe('kanban editor URLs', () => {
  it('points at the edufeed kanban editor root', () => {
    expect(KANBAN_EDITOR_URL).toBe('https://kanban.edufeed.org/');
  });

  it('builds the editor URL for an existing board', () => {
    expect(getKanbanEditorBoardUrl('naddr1abc')).toBe(
      'https://kanban.edufeed.org/cardsboard/naddr1abc'
    );
  });

  it('returns null without an naddr', () => {
    expect(getKanbanEditorBoardUrl(null)).toBeNull();
    expect(getKanbanEditorBoardUrl('')).toBeNull();
  });
});
