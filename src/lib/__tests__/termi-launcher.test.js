/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { termiLauncher, closeTermi } from '$lib/stores/termi-launcher.svelte.js';

describe('termiLauncher remembers the window for the next open of this page session', () => {
  it('closing keeps the conversation id and whether the Werkbank was open, and resets the window', () => {
    Object.assign(termiLauncher, { open: true, workbench: true, lastId: 'c1' });
    closeTermi();
    expect(termiLauncher).toMatchObject({
      open: false,
      workbench: false,
      lastId: 'c1',
      lastWorkbench: true
    });
  });

  it('closing keeps the full view, so the next open returns to it', () => {
    Object.assign(termiLauncher, { open: true, expanded: true, full: true });
    closeTermi();
    expect(termiLauncher).toMatchObject({ open: false, expanded: false, full: true });
  });
});
