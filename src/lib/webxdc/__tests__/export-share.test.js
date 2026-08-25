/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { stashExport, takeExport, exportTitle } from '../export-share.js';

describe('export-share handoff', () => {
  it('stash → take is one-shot', () => {
    stashExport({ name: 'Sitzung.txt', plainText: '# Notizen' });
    expect(takeExport()).toEqual({ name: 'Sitzung.txt', plainText: '# Notizen' });
    expect(takeExport()).toBe(null);
  });
  it('survives junk', () => {
    sessionStorage.setItem('webxdc:export', '{broken');
    expect(takeExport()).toBe(null);
  });
  it('strips the extension for the title', () => {
    expect(exportTitle('Sitzung.txt')).toBe('Sitzung');
    expect(exportTitle('no-extension')).toBe('no-extension');
  });
});
