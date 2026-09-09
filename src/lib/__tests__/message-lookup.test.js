/**
 * message-lookup — registry-driven Paraglide messages.
 *
 * Config registries (resource-form variants, extension namespace labels, the
 * Konfi step-4 sub-steps) refer to messages by key string. Resolving those by
 * indexing the whole `import * as m` namespace (`m[key]`) defeats rollup's
 * tree-shaking: every one of the ~3.5k compiled messages, in every locale, gets
 * kept in one ~340KB chunk. `resolveMessage()` goes through an explicit static
 * table instead, so only the listed messages are bundled.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import * as m from '$lib/paraglide/messages';
import { resolveMessage } from '$lib/helpers/message-lookup.js';
import { ALL_VARIANTS, EXTENSION_NAMESPACE_LABELS } from '$lib/config/resource-form-variants.js';
import { BILDUNGSBEREICHE } from '$lib/helpers/educational/bildungsbereich.js';

/** Every message key a registry can hand to resolveMessage(). */
function registryKeys() {
  /** @type {string[]} */
  const keys = [];
  for (const v of ALL_VARIANTS) {
    keys.push(v.labelKey, v.descriptionKey);
    if (v.extensionLabels?.sectionKey) keys.push(v.extensionLabels.sectionKey);
    keys.push(...Object.values(v.extensionLabels?.facets ?? {}));
  }
  for (const ns of Object.values(EXTENSION_NAMESPACE_LABELS)) {
    if (ns.sectionKey) keys.push(ns.sectionKey);
    keys.push(...Object.values(ns.facets ?? {}));
  }
  for (const bb of Object.values(BILDUNGSBEREICHE)) {
    for (const step of /** @type {any} */ (bb).step4SubSteps ?? []) {
      keys.push(step.titleKey);
      for (const f of step.fields) {
        keys.push(f.labelKey);
        if (f.customLabelKey) keys.push(f.customLabelKey);
      }
    }
  }
  return [...new Set(keys)];
}

describe('resolveMessage', () => {
  it('returns the localized string for a registered key', () => {
    expect(resolveMessage('konfi_field_zielgruppen')).toBe(m.konfi_field_zielgruppen());
  });

  it('returns undefined for a key that is not registered', () => {
    expect(resolveMessage('common_login')).toBeUndefined();
    expect(resolveMessage('does_not_exist')).toBeUndefined();
  });

  it('is never fooled by Object.prototype members', () => {
    expect(resolveMessage('constructor')).toBeUndefined();
    expect(resolveMessage('toString')).toBeUndefined();
  });

  it('covers every message key the config registries reference (drift catcher)', () => {
    const missing = registryKeys().filter((key) => resolveMessage(key) === undefined);
    expect(missing).toEqual([]);
  });
});

describe('no dynamic indexing of the Paraglide namespace', () => {
  const sources = import.meta.glob('/src/**/*.{js,svelte}', {
    query: '?raw',
    import: 'default',
    eager: true
  });

  it('no source file indexes `m` by a runtime key', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes('__tests__') && !path.includes('/paraglide/'))
      .filter(([, src]) => /paraglide\/messages/.test(/** @type {string} */ (src)))
      .filter(([, src]) => /\(m\)\s*\[|\bmessages\[key\]/.test(/** @type {string} */ (src)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
