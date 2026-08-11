/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  buildCreateGroupTemplate,
  buildEditGroupMetadataTemplate,
  buildPutUserTemplate,
  buildRemoveUserTemplate,
  buildDeleteGroupTemplate,
  generateGroupId
} from '$lib/groups/group-management.js';

const ID = 'abc123def456aa00';
const PK = 'f'.repeat(64);

describe('group management templates', () => {
  it('create-group is a kind 9007 with only the h tag', () => {
    const t = buildCreateGroupTemplate(ID);
    expect(t.kind).toBe(9007);
    expect(t.tags).toEqual([['h', ID]]);
    expect(t.content).toBe('');
    expect(t.created_at).toBeTypeOf('number');
  });

  it('edit-metadata carries fields and BOTH-side markers', () => {
    const t = buildEditGroupMetadataTemplate(ID, {
      name: 'Study group',
      about: 'notes',
      picture: 'https://x/y.png',
      isPublic: false,
      isOpen: false
    });
    expect(t.kind).toBe(9002);
    expect(t.tags).toEqual([
      ['h', ID],
      ['name', 'Study group'],
      ['about', 'notes'],
      ['picture', 'https://x/y.png'],
      ['private'],
      ['closed']
    ]);
  });

  it('edit-metadata skips empty fields and flips markers', () => {
    const t = buildEditGroupMetadataTemplate(ID, { name: '  ', isPublic: true, isOpen: true });
    expect(t.tags).toEqual([['h', ID], ['public'], ['open']]);
  });

  it('put-user matches applesauce shape with and without roles', () => {
    expect(buildPutUserTemplate(ID, PK, ['admin']).tags).toEqual([
      ['h', ID],
      ['p', PK, 'admin']
    ]);
    expect(buildPutUserTemplate(ID, PK).tags).toEqual([
      ['h', ID],
      ['p', PK]
    ]);
    expect(buildPutUserTemplate(ID, PK).kind).toBe(9000);
  });

  it('remove-user and delete-group', () => {
    expect(buildRemoveUserTemplate(ID, PK)).toMatchObject({
      kind: 9001,
      tags: [
        ['h', ID],
        ['p', PK]
      ]
    });
    expect(buildDeleteGroupTemplate(ID)).toMatchObject({ kind: 9008, tags: [['h', ID]] });
  });

  it('generateGroupId yields 16 lowercase hex chars, unique-ish', () => {
    const a = generateGroupId();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(generateGroupId()).not.toBe(a);
  });
});
