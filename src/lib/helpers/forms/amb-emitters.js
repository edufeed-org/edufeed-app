/**
 * Pure NIP-AMB emitter registry: each form field type / output maps to an
 * emitter that serializes a form value to NIP-AMB kind-30142 tags and parses
 * them back. No Svelte imports (usable from node scripts and tests).
 *
 * NIP-AMB grammar (authority: the NIP-AMB spec):
 *  - concept: ["<prop>:id", uri], ["<prop>:prefLabel:<lang>", label]*, ["<prop>:type","Concept"] — NO a-tag
 *  - ext: ["ext:<form-d-tag>:<facet>:<sub>", value] (form-d-tag colon-free, no pubkey)
 *  - keywords: ["t", kw]*   license: ["license:id", uri]   id: ["d", uri]
 *  - description also mirrors into the event content field
 */

/**
 * @typedef {Object} EmitCtx
 * @property {import('./format.js').FormField} field
 * @property {string} prop
 * @property {string} formDTag
 * @property {string} defaultLang
 *
 * @typedef {Object} AmbEmitter
 * @property {(value:any, ctx:EmitCtx) => string[][]} emit
 * @property {(event:import('nostr-tools').NostrEvent, ctx:EmitCtx) => { value:any, concepts?:any[] }} parse
 */

/** @param {any} v */
const asArray = (v) =>
  Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];

/**
 * Flat scalar emitter, keyed by whatever `keyOf(ctx)` resolves to: ["<key>", value],
 * arrays repeat. Option-bound fields (field.options.options) round-trip id↔label:
 * emit maps optionId → label, parse maps label → optionId (';'-joined).
 * @param {(ctx: EmitCtx) => string} keyOf
 * @returns {AmbEmitter}
 */
function flatEmitter(keyOf) {
  return {
    emit: (value, ctx) => {
      const { field } = ctx;
      const key = keyOf(ctx);
      const opts = field.options?.options;
      const byId = opts?.length
        ? new Map(
            opts.map((/** @type {import('./format.js').FormFieldOption} */ o) => [o.id, o.label])
          )
        : null;
      const vals = Array.isArray(value) ? value : byId ? String(value).split(';') : asArray(value);
      return vals
        .filter((/** @type {any} */ v) => v !== undefined && v !== null && v !== '')
        .map((/** @type {any} */ v) => [
          key,
          byId ? (byId.get(String(v)) ?? String(v)) : String(v)
        ]);
    },
    parse: (event, ctx) => {
      const { field } = ctx;
      const key = keyOf(ctx);
      const vals = event.tags.filter((t) => t[0] === key && t[1]).map((t) => t[1]);
      if (vals.length === 0) return { value: '' };
      const opts = field.options?.options;
      if (opts?.length) {
        const byLabel = new Map(
          opts.map((/** @type {import('./format.js').FormFieldOption} */ o) => [o.label, o.id])
        );
        return { value: vals.map((v) => byLabel.get(v) ?? v).join(';') };
      }
      return { value: vals.length === 1 ? vals[0] : vals };
    }
  };
}

/** Default: flat ["<prop>", value] — see flatEmitter for option-label round-trip behavior. */
export const scalarEmitter = flatEmitter(({ prop }) => prop);

/**
 * Scalar `ext` fields (no vocab binding) — flat tag namespaced by the form
 * d-tag: ["ext:<form-d-tag>:<field.id>", value]. Concept-valued `ext` fields
 * (field.vocab set) use extEmitter/conceptEmitter instead.
 */
export const extScalarEmitter = flatEmitter(({ field, formDTag }) => `ext:${formDTag}:${field.id}`);

/** @type {AmbEmitter} */
export const booleanEmitter = {
  emit: (value, { prop }) =>
    value === undefined || value === null || value === ''
      ? []
      : [[prop, value === true || value === 'true' ? 'true' : 'false']],
  parse: (event, { prop }) => {
    const t = event.tags.find((t) => t[0] === prop);
    return { value: t ? t[1] === 'true' : false };
  }
};

/**
 * Emits only the ["description", value] tag. The event `content` field is the
 * publishing route's responsibility (it already sets content from the raw
 * description value) — the emitter must NOT emit a ['content', …] pseudo-tag,
 * which would otherwise land as a malformed tag on the signed kind-30142 event.
 * @type {AmbEmitter}
 */
export const descriptionEmitter = {
  emit: (value, { prop }) => (value ? [[prop, String(value)]] : []),
  parse: (event, { prop }) => {
    const t = event.tags.find((t) => t[0] === prop);
    return { value: t ? t[1] : event.content || '' };
  }
};

/** @type {AmbEmitter} */
export const dtagEmitter = {
  emit: (value) => (value ? [['d', String(value)]] : []),
  parse: (event) => ({ value: event.tags.find((t) => t[0] === 'd')?.[1] || '' })
};

/** @type {AmbEmitter} */
export const licenseEmitter = {
  emit: (value) => (value ? [['license:id', String(value)]] : []),
  parse: (event) => ({ value: event.tags.find((t) => t[0] === 'license:id')?.[1] || '' })
};

/** @type {AmbEmitter} */
export const keywordsEmitter = {
  emit: (value) =>
    asArray(value)
      .filter(Boolean)
      .map((/** @type {any} */ v) => ['t', String(v)]),
  parse: (event) => ({ value: event.tags.filter((t) => t[0] === 't' && t[1]).map((t) => t[1]) })
};

/**
 * keyBase for a concept/ext field: AMB prop, or ext:<form-d-tag>:<facet>.
 * @param {EmitCtx} ctx
 */
function conceptKeyBase({ field, prop, formDTag }) {
  return field.output === 'ext' ? `ext:${formDTag}:${field.id}` : prop;
}

/** @type {AmbEmitter} */
export const conceptEmitter = {
  emit: (concepts, ctx) => {
    const kb = conceptKeyBase(ctx);
    /** @type {string[][]} */
    const out = [];
    for (const c of asArray(concepts)) {
      if (!c?.id) continue;
      out.push([`${kb}:id`, c.id]);
      for (const [lang, label] of Object.entries(c.labels || {}))
        out.push([`${kb}:prefLabel:${lang}`, label]);
      out.push([`${kb}:type`, 'Concept']);
    }
    return out;
  },
  parse: (event, ctx) => {
    const kb = conceptKeyBase(ctx);
    /** @type {{id:string,labels:Record<string,string>,nostrCoord:string,relay:string}[]} */
    const concepts = [];
    /** @type {{id:string,labels:Record<string,string>,nostrCoord:string,relay:string} | null} */
    let current = null;
    for (const t of event.tags) {
      if (t[0] === `${kb}:id` && t[1]) {
        current = { id: t[1], labels: {}, nostrCoord: '', relay: '' };
        concepts.push(current);
      } else if (current && t[0]?.startsWith(`${kb}:prefLabel:`) && t[1]) {
        current.labels[t[0].slice(`${kb}:prefLabel:`.length)] = t[1];
      }
    }
    return { value: concepts.map((c) => c.id), concepts };
  }
};

export const extEmitter = conceptEmitter; // ext concept fields share the concept shape; keyBase differs via conceptKeyBase

/**
 * @param {import('./format.js').FormField} field
 * @returns {AmbEmitter}
 */
export function resolveEmitter(field) {
  // composite field types are registered in Task 2-4 (creator/amb-relation/external-urls)
  const byType = COMPOSITE_EMITTERS[field.type];
  if (byType) return byType;

  // Concept-ness is defined by vocab-boundedness (the field carries a kind-39737
  // ConceptScheme binding), not by AMB prop name or by `ext` output — a plain
  // `select`/`number` field can reuse a concept-shaped prop name (e.g.
  // `amb:educationalLevel`) or `ext` output with hardcoded scalar options and
  // no vocab, in which case it stays a flat scalar tag.
  if (field.output === 'ext') return field.vocab ? extEmitter : extScalarEmitter;
  if (field.vocab) return conceptEmitter;

  const prop = (field.output || `amb:${field.id}`).startsWith('amb:')
    ? (field.output || `amb:${field.id}`).slice(4)
    : field.id;
  if (prop === 'keywords') return keywordsEmitter;
  if (prop === 'isAccessibleForFree') return booleanEmitter;
  if (prop === 'description') return descriptionEmitter;
  if (prop === 'id') return dtagEmitter;
  if (prop === 'license') return licenseEmitter;
  return scalarEmitter;
}

/** Registry for composite field types; populated by Task 2-4 via registerCompositeEmitter. */
export const COMPOSITE_EMITTERS = /** @type {Record<string, AmbEmitter>} */ ({});

/**
 * @param {string} type
 * @param {AmbEmitter} emitter
 */
export function registerCompositeEmitter(type, emitter) {
  COMPOSITE_EMITTERS[type] = emitter;
}

/** NIP-AMB creator/contributor: p-tag when pubkey present, else flattened creator:*. @type {AmbEmitter} */
export const creatorEmitter = {
  emit: (value, { prop }) => {
    const role = prop === 'contributor' ? 'contributor' : 'creator';
    const key = role;
    /** @type {string[][]} */
    const out = [];
    for (const c of asArray(value)) {
      if (!c) continue;
      if (c.pubkey) {
        out.push(['p', c.pubkey, c.relayHint || '', role]);
        continue;
      }
      if (c.orcid) out.push([`${key}:id`, c.orcid]);
      out.push([`${key}:name`, c.name || '']);
      out.push([`${key}:type`, c.type || 'Person']);
      if (c.honorificPrefix) out.push([`${key}:honorificPrefix`, c.honorificPrefix]);
      if (c.affiliationName) {
        out.push([`${key}:affiliation:name`, c.affiliationName]);
        out.push([`${key}:affiliation:type`, 'Organization']);
      }
    }
    return out;
  },
  parse: (event, { prop }) => {
    const role = prop === 'contributor' ? 'contributor' : 'creator';
    const key = role;
    /** @type {any[]} */
    const creators = [];
    for (const t of event.tags) {
      if (t[0] === 'p' && t[3] === role) {
        creators.push({ name: '', type: 'Person', pubkey: t[1], relayHint: t[2] || '' });
      }
    }
    /** @type {any} */
    let current = null;
    /** @type {string | null} */
    let pendingOrcid = null;
    for (const t of event.tags) {
      if (t[0] === `${key}:id`) {
        pendingOrcid = t[1];
      } else if (t[0] === `${key}:name`) {
        current = { name: t[1] || '', type: 'Person' };
        if (pendingOrcid) {
          current.orcid = pendingOrcid;
          pendingOrcid = null;
        }
        creators.push(current);
      } else if (current && t[0] === `${key}:type`) current.type = t[1];
      else if (current && t[0] === `${key}:honorificPrefix`) current.honorificPrefix = t[1];
      else if (current && t[0] === `${key}:affiliation:name`) current.affiliationName = t[1];
    }
    return { value: creators };
  }
};
registerCompositeEmitter('creator', creatorEmitter);

/** NIP-AMB relation (isPartOf/hasPart/isBasedOn) → a-tag to a 30142 coordinate. @type {AmbEmitter} */
export const relationEmitter = {
  emit: (value, { prop }) =>
    asArray(value)
      .filter((r) => r?.coordinate)
      .map((r) => ['a', r.coordinate, r.relayHint || '', prop]),
  parse: (event, { prop }) => ({
    value: event.tags
      .filter((t) => t[0] === 'a' && t[3] === prop && t[1]?.startsWith('30142:'))
      .map((t) => ({ coordinate: t[1], relayHint: t[2] || '' }))
  })
};
registerCompositeEmitter('amb-relation', relationEmitter);

/** External references → Nostr-native r tags (NIP-24). @type {AmbEmitter} */
export const rTagEmitter = {
  emit: (value) =>
    asArray(value)
      .filter(Boolean)
      .map((/** @type {any} */ u) => ['r', String(u)]),
  parse: (event) => ({ value: event.tags.filter((t) => t[0] === 'r' && t[1]).map((t) => t[1]) })
};
registerCompositeEmitter('external-urls', rTagEmitter);

/**
 * Derive the AMB prop for a field ('amb:<prop>' → <prop>, else field id).
 * @param {import('./format.js').FormField} field
 */
export function fieldProp(field) {
  const o = field.output || `amb:${field.id}`;
  return o.startsWith('amb:') ? o.slice(4) : field.id;
}
