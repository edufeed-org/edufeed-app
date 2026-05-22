/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/helpers/event-factory.js', async () => {
  const { EventFactory } = await import('applesauce-core/event-factory');
  return {
    createAppEventFactory: vi.fn((/** @type {any} */ opts) => new EventFactory(opts))
  };
});

import {
  getEdufeedMembershipForm,
  createEdufeedMembershipForm,
  buildFormTemplateTags,
  parseFormTemplate
} from '$lib/helpers/forms.js';

describe('forms — getEdufeedMembershipForm', () => {
  it('returns the edufeed-membership form with the expected fields', () => {
    const form = getEdufeedMembershipForm();

    expect(form.dTag).toBe('edufeed-membership');
    expect(form.name).toBeTruthy();
    expect(form.fields).toHaveLength(5);

    const byId = Object.fromEntries(form.fields.map((f) => [f.id, f]));

    expect(byId.wished_handle).toBeDefined();
    expect(byId.wished_handle.type).toBe('text');
    expect(byId.wished_handle.options?.required).toBe(true);
    expect(byId.wished_handle.options?.pattern).toBe('^[a-z0-9._-]+$');
    expect(byId.wished_handle.options?.min).toBe(2);
    expect(byId.wished_handle.options?.max).toBe(30);

    expect(byId.full_name).toBeDefined();
    expect(byId.full_name.type).toBe('text');
    expect(byId.full_name.options?.required).toBe(true);

    expect(byId.affiliation).toBeDefined();
    expect(byId.affiliation.type).toBe('text');
    expect(byId.affiliation.options?.required).toBeFalsy();

    expect(byId.role).toBeDefined();
    expect(byId.role.type).toBe('text');
    expect(byId.role.options?.required).toBeFalsy();

    expect(byId.motivation).toBeDefined();
    expect(byId.motivation.type).toBe('textarea');
    expect(byId.motivation.options?.required).toBe(true);
  });

  it('roundtrips through buildFormTemplateTags + parseFormTemplate', () => {
    const form = getEdufeedMembershipForm();
    const tags = buildFormTemplateTags(form.dTag, form.fields, { name: form.name });
    const mockEvent = { kind: 30168, pubkey: 'abc', tags, content: '', created_at: 1 };
    const parsed = parseFormTemplate(mockEvent);

    expect(parsed.dTag).toBe('edufeed-membership');
    expect(parsed.fields).toHaveLength(5);
    expect(parsed.fields.map((f) => f.id).sort()).toEqual(
      ['affiliation', 'full_name', 'motivation', 'role', 'wished_handle'].sort()
    );
  });
});

describe('forms — createEdufeedMembershipForm', () => {
  it('returns a signed kind 30168 event with d-tag edufeed-membership', async () => {
    const { generateSecretKey } = await import('nostr-tools');
    const { PrivateKeySigner } = await import('applesauce-signers');
    const sk = generateSecretKey();
    const signer = new PrivateKeySigner(sk);

    const event = await createEdufeedMembershipForm(signer);

    expect(event.kind).toBe(30168);
    expect(event.sig).toBeTruthy();
    expect(event.pubkey).toBeTruthy();

    const dTag = event.tags.find((t) => t[0] === 'd');
    expect(dTag?.[1]).toBe('edufeed-membership');

    const parsed = parseFormTemplate(event);
    expect(parsed.fields).toHaveLength(5);
  });
});
