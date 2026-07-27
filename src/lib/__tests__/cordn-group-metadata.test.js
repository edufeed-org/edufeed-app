/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  decodeGroupMetadata,
  findGroupMetadata,
  CORDN_GROUP_METADATA_EXTENSION_TYPE
} from '$lib/cordn/group-metadata.js';

const ADMIN_A = 'a'.repeat(64);
const ADMIN_B = 'b'.repeat(64);

/** Build a spec/01 §3 CordnGroupMetadata payload (uint16 version + five 2-byte-length-prefixed vectors). */
function encodeFixture({
  version = 1,
  name = '',
  description = '',
  adminHexKeys = [],
  icon = '',
  imageUrl = ''
}) {
  const encoder = new TextEncoder();
  const adminBytes = new Uint8Array(adminHexKeys.length * 32);
  adminHexKeys.forEach((hex, i) => {
    for (let j = 0; j < 32; j++) adminBytes[i * 32 + j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16);
  });
  const vectors = [
    encoder.encode(name),
    encoder.encode(description),
    adminBytes,
    encoder.encode(icon),
    encoder.encode(imageUrl)
  ];
  const total = 2 + vectors.reduce((sum, v) => sum + 2 + v.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, version);
  let offset = 2;
  for (const v of vectors) {
    view.setUint16(offset, v.length);
    out.set(v, offset + 2);
    offset += 2 + v.length;
  }
  return out;
}

describe('decodeGroupMetadata (spec/01)', () => {
  it('decodes name, description, admins, icon, imageUrl', () => {
    const bytes = encodeFixture({
      name: 'Nostr',
      description: 'A group to talk about nostr',
      adminHexKeys: [ADMIN_A, ADMIN_B],
      icon: '🦤',
      imageUrl: 'https://example.com/x.png'
    });
    expect(decodeGroupMetadata(bytes)).toEqual({
      name: 'Nostr',
      description: 'A group to talk about nostr',
      adminPubkeys: [ADMIN_A, ADMIN_B],
      icon: '🦤',
      imageUrl: 'https://example.com/x.png'
    });
  });

  it('decodes empty fields (egalitarian mode = empty adminPubkeys)', () => {
    const decoded = decodeGroupMetadata(encodeFixture({}));
    expect(decoded).toEqual({
      name: '',
      description: '',
      adminPubkeys: [],
      icon: '',
      imageUrl: ''
    });
  });

  it('rejects version 0 and unknown short buffers', () => {
    expect(decodeGroupMetadata(encodeFixture({ version: 0 }))).toBeUndefined();
    expect(decodeGroupMetadata(new Uint8Array([0, 1, 0]))).toBeUndefined();
  });

  it('rejects admin vectors that are not a multiple of 32 bytes', () => {
    const bytes = encodeFixture({ name: 'x' });
    // Corrupt: admin vector length 1 with 1 junk byte spliced in.
    const broken = encodeFixture({});
    broken[broken.length - 5] = 0; // keep parse structure valid but admins invalid
    const custom = encodeFixture({ adminHexKeys: [ADMIN_A] });
    custom[2 + 2 + 0 + 2 + 0 + 1] = 31; // shrink admin length to 31
    expect(decodeGroupMetadata(custom)).toBeUndefined();
    expect(decodeGroupMetadata(bytes)).toBeDefined();
  });

  it('findGroupMetadata picks the 0xC04D extension from a group context', () => {
    const bytes = encodeFixture({ name: 'Team' });
    const state = {
      groupContext: {
        extensions: [
          { extensionType: 1, extensionData: new Uint8Array([1]) },
          { extensionType: CORDN_GROUP_METADATA_EXTENSION_TYPE, extensionData: bytes }
        ]
      }
    };
    expect(findGroupMetadata(state)?.name).toBe('Team');
    expect(findGroupMetadata({ groupContext: { extensions: [] } })).toBeUndefined();
  });
});
