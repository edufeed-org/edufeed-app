/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { avatarInitial } from '$lib/helpers/avatar-initial.js';

// QA round 2 K-new-3: "[QA] Gast B" showed "[" as its avatar.
describe('avatarInitial', () => {
  it.each([
    ['Ada', 'A'],
    ['  ada lovelace', 'A'],
    ['[QA] Gast B', 'Q'],
    ['„Öko“-AG', 'Ö'],
    ['42 Schüler', '4'],
    ['...émile', 'É']
  ])('%s → %s', (name, initial) => {
    expect(avatarInitial(name, '?')).toBe(initial);
  });
  it.each([[''], ['   '], ['[]'], ['🙂'], [undefined], [null]])(
    'falls back when %s has no letter or digit',
    (name) => {
      expect(avatarInitial(name, '?')).toBe('?');
    }
  );
});
