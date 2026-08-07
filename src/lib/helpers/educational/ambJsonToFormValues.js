import { nip19 } from 'nostr-tools';

const CONCEPT_PROPS = new Set(['about', 'learningResourceType', 'educationalLevel', 'audience']);

/** @param {any} c */
const toConcept = (c) => ({ id: c.id, labels: c.prefLabel || {} });

/**
 * @param {any} prop
 * @returns {any[]}
 */
const asArray = (prop) => (Array.isArray(prop) ? prop : prop != null ? [prop] : []);

/**
 * Decode a `nostr:npub…` / `nostr:nprofile…` creator id back to a pubkey.
 * @param {string} id
 * @returns {string | undefined}
 */
function decodeCreatorPubkey(id) {
  try {
    const decoded = nip19.decode(id.slice('nostr:'.length));
    if (decoded.type === 'npub') return /** @type {string} */ (decoded.data);
    if (decoded.type === 'nprofile') return /** @type {{pubkey: string}} */ (decoded.data).pubkey;
  } catch {
    // fall through — treat as unrecoverable
  }
  return undefined;
}

/**
 * Decode a `nostr:naddr…` relation id back to a coordinate + relay hint.
 * @param {string} id
 * @returns {{ coordinate: string, relayHint?: string } | undefined}
 */
function decodeRelation(id) {
  try {
    const decoded = nip19.decode(id.slice('nostr:'.length));
    if (decoded.type !== 'naddr') return undefined;
    const { kind, pubkey, identifier, relays } = /** @type {any} */ (decoded.data);
    return {
      coordinate: `${kind}:${pubkey}:${identifier}`,
      ...(relays && relays[0] ? { relayHint: relays[0] } : {})
    };
  } catch {
    return undefined;
  }
}

/**
 * Inverse of `formValuesToAmbJson`: reads an `AmbLearningResource` (as produced by
 * `nostrToAmb`) back into form values + selected concepts for edit-prefill.
 * Pure — does not mutate `amb` or `form`.
 *
 * @param {any} amb
 * @param {{ pubkey: string, dTag: string, fields: any[] }} form
 * @returns {{ values: Record<string, any>, selectedConcepts: Record<string, any> }}
 */
export function ambJsonToFormValues(amb, form) {
  /** @type {Record<string, any>} */
  const values = {};
  /** @type {Record<string, any>} */
  const selectedConcepts = {};

  for (const field of form.fields) {
    const out = field.output || `amb:${field.id}`;

    if (field.type === 'external-urls') {
      const prop = out.startsWith('amb:') ? out.slice(4) : field.id;
      values[field.id] = Array.isArray(amb?.[prop]) ? amb[prop] : [];
      continue;
    }

    if (field.type === 'creator') {
      values[field.id] = asArray(amb?.creator).map((c) => {
        if (typeof c?.id === 'string' && c.id.startsWith('nostr:')) {
          const pubkey = decodeCreatorPubkey(c.id);
          if (pubkey) return { pubkey, name: c.name || '', type: c.type || 'Person' };
        }
        return {
          name: c?.name || '',
          type: c?.type || 'Person',
          ...(c?.honorificPrefix ? { honorificPrefix: c.honorificPrefix } : {}),
          ...(c?.id ? { orcid: c.id } : {}),
          ...(c?.affiliation?.name ? { affiliationName: c.affiliation.name } : {})
        };
      });
      continue;
    }

    if (field.type === 'amb-relation') {
      const role = out === 'amb:isPartOf' ? 'isPartOf' : 'hasPart';
      values[field.id] = asArray(amb?.[role])
        .filter((r) => typeof r?.id === 'string' && r.id.startsWith('nostr:'))
        .map((r) => decodeRelation(r.id))
        .filter(Boolean);
      continue;
    }

    if (out === 'ext') {
      const items = amb?.ext?.[form.dTag]?.[field.id];
      if (field.vocab) {
        selectedConcepts[field.id] = asArray(items)
          .filter((c) => c?.id)
          .map(toConcept);
      } else {
        values[field.id] = Array.isArray(items) ? items : [];
      }
      continue;
    }

    const prop = out.startsWith('amb:') ? out.slice(4) : field.id;

    if (field.vocab || CONCEPT_PROPS.has(prop)) {
      selectedConcepts[field.id] = asArray(amb?.[prop])
        .filter((c) => c?.id)
        .map(toConcept);
      continue;
    }
    if (prop === 'id') {
      values[field.id] = amb?.id ?? '';
      continue;
    }
    if (prop === 'license') {
      values[field.id] = amb?.license?.id ?? '';
      continue;
    }
    if (prop === 'isAccessibleForFree') {
      values[field.id] = amb?.isAccessibleForFree === true;
      continue;
    }
    if (prop === 'keywords') {
      values[field.id] = Array.isArray(amb?.keywords) ? amb.keywords : [];
      continue;
    }
    if (prop === 'inLanguage') {
      const arr = asArray(amb?.inLanguage);
      values[field.id] = field.type === 'text-array' ? arr : (arr[0] ?? '');
      continue;
    }
    // plain scalars: name, description, image, datePublished, dateCreated, …
    values[field.id] = amb?.[prop] ?? '';
  }

  return { values, selectedConcepts };
}
