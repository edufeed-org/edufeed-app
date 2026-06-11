/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  BILDUNGSBEREICH_NAMESPACE_IRI,
  bildungsbereichToNip32Tags
} from '$lib/helpers/educational/bildungsbereichNamespace.js';

describe('BILDUNGSBEREICH_NAMESPACE_IRI', () => {
  it('exports the canonical IRI', () => {
    expect(BILDUNGSBEREICH_NAMESPACE_IRI).toBe('https://edufeed.org/ns/bildungsbereich#');
  });
});

describe('bildungsbereichToNip32Tags', () => {
  it('emits the NIP-32 L/l pair for konfi', () => {
    expect(bildungsbereichToNip32Tags('konfi')).toEqual([
      ['L', 'https://edufeed.org/ns/bildungsbereich#'],
      ['l', 'konfi', 'https://edufeed.org/ns/bildungsbereich#']
    ]);
  });

  it('emits the NIP-32 L/l pair for schule', () => {
    expect(bildungsbereichToNip32Tags('schule')).toEqual([
      ['L', 'https://edufeed.org/ns/bildungsbereich#'],
      ['l', 'schule', 'https://edufeed.org/ns/bildungsbereich#']
    ]);
  });
});
