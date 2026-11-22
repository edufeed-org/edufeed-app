/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { priorMessages } from '$lib/termi/prior-turns.js';

describe('priorMessages', () => {
  it('keeps order, summarises tier-1 items as a few titles, skips empty turns', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ title: `T${i}` }));
    const out = priorMessages([
      { role: 'user', text: 'Finde Material zu Demokratie' },
      { role: 'assistant', text: 'Hier entlang:', items },
      { role: 'assistant' }
    ]);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(out[0].parts).toEqual([{ type: 'text', text: 'Finde Material zu Demokratie' }]);
    expect(out[1].parts[0]).toEqual({
      type: 'text',
      text: 'Hier entlang:\n[Treffer: T0; T1; T2; T3; T4]'
    });
  });
});
