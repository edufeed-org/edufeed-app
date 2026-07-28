/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  getFormReferenceFromResource,
  resolveResourceDTag
} from '../../helpers/educational/formReference.js';

describe('getFormReferenceFromResource', () => {
  it('extracts the form back-reference a-tag', () => {
    const event = {
      id: 'evt',
      pubkey: 'author',
      kind: 30142,
      created_at: 0,
      sig: '',
      content: '',
      tags: [
        ['d', 'resource-id'],
        ['name', 'Pythagoras-Video'],
        ['a', '30168:edupub:amb-basic', 'wss://relay.example', 'form']
      ]
    };

    const ref = getFormReferenceFromResource(event);
    expect(ref).toEqual({ address: '30168:edupub:amb-basic', relay: 'wss://relay.example' });
  });

  it('returns null for events without a form back-ref', () => {
    const event = {
      id: 'evt',
      pubkey: 'author',
      kind: 30142,
      created_at: 0,
      sig: '',
      content: '',
      tags: [
        ['d', 'resource-id'],
        ['name', 'No form']
      ]
    };
    expect(getFormReferenceFromResource(event)).toBeNull();
  });
});

describe('resolveResourceDTag', () => {
  it('create mode: uses the emitted d tag (e.g. from an amb:id url field) when present', () => {
    expect(
      resolveResourceDTag({
        isEditMode: false,
        emittedD: 'https://x/1',
        generateId: () => 'unused-uuid'
      })
    ).toBe('https://x/1');
  });

  it('create mode: falls back to a generated id when no d tag was emitted', () => {
    expect(
      resolveResourceDTag({
        isEditMode: false,
        emittedD: undefined,
        generateId: () => 'fresh-uuid'
      })
    ).toBe('fresh-uuid');
  });

  it('edit mode: keeps the resource existing d tag, ignoring any emitted d (addressable stability)', () => {
    expect(
      resolveResourceDTag({
        isEditMode: true,
        existingDTag: 'existing-resource-id',
        emittedD: 'https://x/1',
        generateId: () => 'unused-uuid'
      })
    ).toBe('existing-resource-id');
  });

  it('edit mode: falls back to a generated id when the resource somehow has no existing d tag', () => {
    expect(
      resolveResourceDTag({
        isEditMode: true,
        existingDTag: undefined,
        generateId: () => 'fresh-uuid'
      })
    ).toBe('fresh-uuid');
  });
});
