/** @vitest-environment node */
/**
 * "1 Ergebnisse gefunden" — the result count under /discover searches
 * (Personen, Communities, filter bar) needs a singular. Paraglide plural
 * variants on the one message keep every call site unchanged.
 */
import { describe, it, expect } from 'vitest';
import { discover_results_count } from '$lib/paraglide/messages';

describe('discover_results_count', () => {
  it('uses the singular for one result', () => {
    expect(discover_results_count({ count: 1 }, { locale: 'de' })).toBe('1 Ergebnis gefunden');
    expect(discover_results_count({ count: 1 }, { locale: 'en' })).toBe('1 result found');
  });

  it('keeps the plural for none and many', () => {
    expect(discover_results_count({ count: 0 }, { locale: 'de' })).toBe('0 Ergebnisse gefunden');
    expect(discover_results_count({ count: 22 }, { locale: 'de' })).toBe('22 Ergebnisse gefunden');
    expect(discover_results_count({ count: 22 }, { locale: 'en' })).toBe('22 results found');
  });
});
