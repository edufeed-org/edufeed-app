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

  it('stashes a file at the size cap and reports success', () => {
    const plainText = 'a'.repeat(2_000_000);
    expect(stashExport({ name: 'big.txt', plainText })).toBe(true);
    expect(takeExport()).toEqual({ name: 'big.txt', plainText });
  });

  it('refuses to stash an export over the size cap, and stashes nothing', () => {
    const plainText = 'a'.repeat(2_000_001);
    expect(stashExport({ name: 'huge.txt', plainText })).toBe(false);
    expect(takeExport()).toBe(null);
  });
});
