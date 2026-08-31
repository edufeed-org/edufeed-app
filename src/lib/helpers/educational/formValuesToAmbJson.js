import { nip19 } from 'nostr-tools';

/** @param {Array<{id?: string, labels?: Record<string, string>}> | undefined} concepts */
const conceptList = (concepts) =>
  (concepts || [])
    .filter((c) => c?.id)
    .map((c) => ({
      id: c.id,
      type: 'Concept',
      ...(c.labels && Object.keys(c.labels).length ? { prefLabel: c.labels } : {})
    }));

/**
 * @param {{ pubkey: string, dTag: string, fields: any[] }} form
 * @param {Record<string, any>} values
 * @param {Record<string, any>} selectedConcepts
 * @returns {{ amb: any, extras: { externalUrls: string[] } }}
 */
export function formValuesToAmbJson(form, values, selectedConcepts) {
  /** @type {any} */
  const amb = { type: ['LearningResource'] };
  const externalUrls = [];
  const CONCEPT_PROPS = new Set(['about', 'learningResourceType', 'educationalLevel', 'audience']);

  for (const field of form.fields) {
    const out = field.output || `amb:${field.id}`;
    const raw = values[field.id];

    if (field.type === 'external-urls') {
      if (Array.isArray(raw)) externalUrls.push(...raw.filter(Boolean));
      continue;
    }
    if (field.type === 'creator') {
      amb.creator = (Array.isArray(raw) ? raw : []).map((c) =>
        c.pubkey
          ? {
              name: c.name || '',
              type: c.type || 'Person',
              id: 'nostr:' + nip19.npubEncode(c.pubkey)
            }
          : {
              name: c.name || '',
              type: c.type || 'Person',
              ...(c.honorificPrefix ? { honorificPrefix: c.honorificPrefix } : {}),
              ...(c.orcid ? { id: c.orcid } : {}),
              ...(c.affiliationName
                ? { affiliation: { type: 'Organization', name: c.affiliationName } }
                : {})
            }
      );
      continue;
    }
    if (field.type === 'amb-relation') {
      const role = out === 'amb:isPartOf' ? 'isPartOf' : 'hasPart';
      amb[role] = (Array.isArray(raw) ? raw : [])
        .filter((r) => r?.coordinate)
        .map((r) => ({
          id: 'nostr:' + coordToNaddr(r.coordinate, r.relayHint),
          type: 'LearningResource'
        }));
      continue;
    }
    if (out === 'ext') {
      const ns = form.dTag;
      (amb.ext ??= {})[ns] ??= {};
      amb.ext[ns][field.id] = field.vocab
        ? conceptList(selectedConcepts[field.id])
        : Array.isArray(raw)
          ? raw
          : raw != null && raw !== ''
            ? [String(raw)]
            : [];
      continue;
    }
    const prop = out.startsWith('amb:') ? out.slice(4) : field.id;
    if (field.vocab || CONCEPT_PROPS.has(prop)) {
      const c = conceptList(selectedConcepts[field.id]);
      if (c.length) amb[prop] = c;
      continue;
    }
    if (prop === 'id') {
      if (raw) amb.id = String(raw);
      continue;
    }
    if (prop === 'license') {
      if (raw) amb.license = { id: String(raw) };
      continue;
    }
    if (prop === 'isAccessibleForFree') {
      // Untouched checkbox arrives as '' (FormRenderer's initial value for a
      // field with no default) — omit the tag entirely in that case, matching
      // the retired amb-emitters.js booleanEmitter and the NIP-101 spec
      // (docs/nips/nip-101-edu.md:204). Explicitly checked/unchecked values
      // arrive as the strings 'true'/'false' and emit true/false respectively.
      if (raw !== undefined && raw !== null && raw !== '') {
        amb.isAccessibleForFree = raw === true || raw === 'true';
      }
      continue;
    }
    if (prop === 'keywords') {
      if (Array.isArray(raw) && raw.length) amb.keywords = raw.filter(Boolean);
      continue;
    }
    if (prop === 'inLanguage') {
      if (raw) amb.inLanguage = Array.isArray(raw) ? raw : [String(raw)];
      continue;
    }
    // plain scalars: name, description, image, datePublished, dateCreated, …
    if (raw != null && raw !== '') amb[prop] = String(raw);
  }
  if (!amb.id) amb.id = `${form.pubkey}/${form.dTag}`; // ambToNostr needs an id → d; caller reconciles the real d-tag
  return { amb, extras: { externalUrls } };
}

/** @param {string} coordinate "30142:pub:d" @param {string} [relayHint] */
function coordToNaddr(coordinate, relayHint) {
  const [kind, pubkey, ...rest] = coordinate.split(':');
  return nip19.naddrEncode({
    kind: Number(kind),
    pubkey,
    identifier: rest.join(':'),
    relays: relayHint ? [relayHint] : []
  });
}
