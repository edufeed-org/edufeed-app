/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { decideEnrichment } from '$lib/helpers/educational/decideEnrichment.js';

describe('decideEnrichment', () => {
  it('returns "skip-amb" when AMB JSON-LD is already present (regardless of mode)', () => {
    expect(decideEnrichment({ mode: 'smart', fetchSource: 'amb' })).toBe('skip-amb');
    expect(decideEnrichment({ mode: 'manual', fetchSource: 'amb' })).toBe('skip-amb');
  });

  it('returns "call-llm" when mode is smart and fetch produced only OG / nothing', () => {
    expect(decideEnrichment({ mode: 'smart', fetchSource: 'opengraph' })).toBe('call-llm');
    expect(decideEnrichment({ mode: 'smart', fetchSource: 'none' })).toBe('call-llm');
  });

  it('returns "skip-manual" when mode is manual and no AMB short-circuit applies', () => {
    expect(decideEnrichment({ mode: 'manual', fetchSource: 'opengraph' })).toBe('skip-manual');
    expect(decideEnrichment({ mode: 'manual', fetchSource: 'none' })).toBe('skip-manual');
  });

  it('defaults to "skip-manual" for unknown modes (defensive — never silently call LLM)', () => {
    expect(decideEnrichment({ mode: /** @type {any} */ ('???'), fetchSource: 'opengraph' })).toBe(
      'skip-manual'
    );
  });

  it('treats unknown fetchSource as non-AMB (so mode decides)', () => {
    expect(decideEnrichment({ mode: 'smart', fetchSource: /** @type {any} */ ('weird') })).toBe(
      'call-llm'
    );
    expect(decideEnrichment({ mode: 'manual', fetchSource: /** @type {any} */ ('weird') })).toBe(
      'skip-manual'
    );
  });
});
