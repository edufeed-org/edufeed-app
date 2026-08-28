// Relative import (not $lib) so this module stays importable from plain
// node scripts (scripts/publish-edufeed-forms.mjs) outside the Vite alias.
import { unique, uniqueBy } from '../unique.js';

/** Kind for form template events */
export const FORM_TEMPLATE_KIND = 30168;
/** Kind for form response events */
export const FORM_RESPONSE_KIND = 1069;

/**
 * @typedef {Object} FormFieldOption
 * @property {string} id
 * @property {string} label
 * @property {string} [nextSection]
 *
 * @typedef {Object} FormField
 * @property {string} id
 * @property {string} type - rich type: text|textarea|text-array|number|email|url|select|checkbox|radio|date
 * @property {string} label
 * @property {string} [defaultValue]
 * @property {Record<string, any>} [options] - { required?, placeholder?, min?, max?, multiple?, allowCustom?, customLabel?, customButtonLabel?, customPlaceholder?, displayIf?, options?: FormFieldOption[] }
 * @property {{ address: string, relay: string }} [vocab] - kind-39737 ConceptScheme binding
 * @property {string} [output] - 'amb:<property>' or 'ext'. Defaults to 'amb:<id>' at parse time.
 *
 * @typedef {Object} FormSection
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string[]} questionIds
 * @property {number} [order]
 *
 * @typedef {Object} ParsedFormTemplate
 * @property {string} dTag
 * @property {string} name
 * @property {string} description
 * @property {FormField[]} fields
 * @property {boolean} isPublic
 * @property {string} confirmationMessage
 * @property {boolean} autoResponse
 * @property {FormSection[]} sections
 * @property {{ address: string, relay: string }} [forkOf] - parent form this one was forked from
 */

/**
 * Shared slugifier for field and option ids.
 * @param {string} label
 * @param {string[]} existingIds
 * @param {string} fallbackBase
 * @returns {string}
 */
function slugId(label, existingIds, fallbackBase) {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const isFallback = !base;
  if (!base) base = fallbackBase;
  if (!isFallback && !existingIds.includes(base)) return base;
  let suffix = isFallback ? 1 : 2;
  while (existingIds.includes(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

/**
 * Generate a unique field ID from a label.
 * @param {string} label
 * @param {string[]} existingIds
 */
export function generateFieldId(label, existingIds) {
  return slugId(label, existingIds, 'field');
}

/**
 * Generate a unique option ID from a label.
 * @param {string} label
 * @param {string[]} existingIds
 */
export function generateOptionId(label, existingIds) {
  return slugId(label, existingIds, 'option');
}

/**
 * Build tags for a form template event (kind 30168) — NIP-101 base encoding
 * plus edufeed extension tags (field-vocab / field-output / forkOf).
 * @param {string} dTag
 * @param {FormField[]} fields
 * @param {{ name?: string, description?: string, public?: boolean, confirmationMessage?: string, autoResponse?: boolean, forkOf?: { address: string, relay: string }, sections?: FormSection[] }} options
 * @returns {string[][]}
 */
export function buildFormTemplateTags(dTag, fields, options = {}) {
  /** @type {string[][]} */
  const tags = [['d', dTag]];
  if (options.name) tags.push(['name', options.name]);

  /** @type {Record<string, any>} */
  const settings = {};
  if (options.description) settings.description = options.description;
  if (options.public) settings.publicForm = true;
  if (options.confirmationMessage) settings.confirmationMessage = options.confirmationMessage;
  if (options.autoResponse) settings.autoResponse = true;
  if (options.sections?.length) settings.sections = options.sections;
  tags.push(['settings', JSON.stringify(settings)]);

  if (options.forkOf?.address) {
    tags.push(['a', options.forkOf.address, options.forkOf.relay || '', 'forkOf']);
  }

  for (const field of fields) {
    const { options: choiceOptions, ...fieldSettings } = field.options || {};
    const isOptionType = (field.type === 'select' || field.type === 'radio') && !field.vocab;
    /** @type {FormFieldOption[]} */
    const optionsList = choiceOptions || [];
    const optionEntries = isOptionType
      ? optionsList.map((o) =>
          o.nextSection
            ? [o.id, o.label, JSON.stringify({ nextSection: o.nextSection })]
            : [o.id, o.label]
        )
      : [];
    /** @type {Record<string, any>} */
    const fs = { renderElement: field.type, ...fieldSettings };
    if (field.defaultValue) fs.defaultValue = field.defaultValue;

    tags.push([
      'field',
      field.id,
      isOptionType ? 'option' : 'text',
      field.label,
      JSON.stringify(optionEntries),
      JSON.stringify(fs)
    ]);
    if (field.vocab)
      tags.push(['field-vocab', field.id, 'a', field.vocab.address, field.vocab.relay]);
    if (field.output) tags.push(['field-output', field.id, field.output]);
  }

  return tags;
}

/**
 * Foreign renderElement vocabulary (Formstr et al.) → our canonical field types.
 * Our own type names are absent here and pass through unchanged; unknown names
 * pass through too (FieldsRenderer degrades them to a text input, per NIP-101).
 * `checkboxes` is Formstr's MULTI-select choice → our `select` with multiple=true
 * (NOT our boolean `checkbox`); handled specially in parseFormTemplate.
 * @type {Record<string, string>}
 */
export const RENDER_ELEMENT_SYNONYMS = {
  shortText: 'text',
  longText: 'textarea',
  paragraph: 'textarea',
  radioButton: 'radio',
  dropdown: 'select',
  checkboxes: 'select' // + multiple=true, applied in parseFormTemplate
};

/** @param {string} name @returns {string} */
export function normalizeRenderElement(name) {
  // renderElement is untrusted event-tag input: own-property lookup only, so a
  // crafted name ('constructor', 'toString', …) can't leak an inherited member.
  return typeof name === 'string' && Object.hasOwn(RENDER_ELEMENT_SYNONYMS, name)
    ? RENDER_ELEMENT_SYNONYMS[name]
    : name;
}

/** @param {string} raw @returns {any} */
function safeJson(raw) {
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse a form template event. Detects the encoding: events with a `settings`
 * tag use the NIP-101 layout; everything else falls back to the legacy
 * edufeed dialect (pre-2026-07). Never throws on foreign/garbage events.
 * @param {{ kind: number, pubkey: string, tags: string[][], content: string, created_at: number }} event
 * @returns {ParsedFormTemplate}
 */
export function parseFormTemplate(event) {
  const tags = event.tags || [];
  const settingsTag = tags.find((t) => t[0] === 'settings');
  if (!settingsTag) return parseLegacyFormTemplate(event);

  const settings = safeJson(settingsTag[1]) || {};
  const dTag = tags.find((t) => t[0] === 'd')?.[1] || '';
  const name = tags.find((t) => t[0] === 'name')?.[1] || '';

  /** @type {FormField[]} */
  const fields = tags
    .filter((t) => t[0] === 'field' && t.length >= 4)
    .map((t) => {
      const rawOptions = safeJson(t[4]);
      const fs = safeJson(t[5]) || {};
      const { renderElement, defaultValue, ...rest } = fs;
      /** @type {Record<string, any>} */
      const opts = { ...rest };
      if (Array.isArray(rawOptions) && rawOptions.length > 0) {
        const parsedOptions = rawOptions
          .filter((o) => Array.isArray(o) && o[0] !== undefined)
          .map((o) => {
            /** @type {FormFieldOption} */
            const entry = { id: String(o[0]), label: String(o[1] ?? o[0]) };
            const cfg = typeof o[2] === 'string' ? safeJson(o[2]) : o[2];
            if (cfg?.nextSection) entry.nextSection = String(cfg.nextSection);
            return entry;
          });
        opts.options = uniqueBy(parsedOptions, (o) => o.id);
      }
      if (renderElement === 'checkboxes') opts.multiple = true;
      return {
        id: t[1],
        type: normalizeRenderElement(renderElement || (t[2] === 'option' ? 'select' : 'text')),
        label: t[3],
        defaultValue: defaultValue || '',
        options: opts
      };
    });

  attachExtensions(fields, tags);

  const forkTag = tags.find((t) => t[0] === 'a' && t[3] === 'forkOf' && t[1]?.startsWith('30168:'));
  return {
    dTag,
    name,
    description: settings.description || '',
    fields: uniqueBy(fields, (f) => f.id),
    isPublic: !!settings.publicForm,
    confirmationMessage: settings.confirmationMessage || '',
    autoResponse: !!settings.autoResponse,
    sections: uniqueBy(
      // Non-object entries would throw on s.id below — never throw on garbage.
      (Array.isArray(settings.sections) ? settings.sections : []).filter(
        (s) => s && typeof s === 'object'
      ),
      (s) => s.id
    ),
    forkOf: forkTag ? { address: forkTag[1], relay: forkTag[2] || '' } : undefined
  };
}

/**
 * Attach field-vocab / field-output extension tags to parsed fields.
 * @param {FormField[]} fields
 * @param {string[][]} tags
 */
function attachExtensions(fields, tags) {
  for (const field of fields) {
    const vt = tags.find((t) => t[0] === 'field-vocab' && t[1] === field.id && t[2] === 'a');
    if (vt) field.vocab = { address: vt[3], relay: vt[4] || '' };
    const ot = tags.find((t) => t[0] === 'field-output' && t[1] === field.id);
    field.output = ot?.[2] || `amb:${field.id}`;
  }
}

/**
 * Legacy dialect parser (pre-NIP-101): field tag positions
 * [field, id, type, label, defaultValue, optionsObjectJSON], discrete
 * description/public/confirmation_message/auto_response tags. Option strings
 * become {id: label, label} so old label-valued responses still resolve.
 * @param {{ tags: string[][] }} event
 * @returns {ParsedFormTemplate}
 */
function parseLegacyFormTemplate(event) {
  const tags = event.tags || [];
  const fields = tags
    .filter((t) => t[0] === 'field' && t.length >= 4)
    .map((t) => {
      const opts = safeJson(t[5]) || {};
      if (Array.isArray(opts.options)) {
        opts.options = unique(opts.options.map(String)).map((s) => ({ id: s, label: s }));
      }
      return { id: t[1], type: t[2], label: t[3], defaultValue: t[4] || '', options: opts };
    });

  attachExtensions(fields, tags);

  const forkTag = tags.find((t) => t[0] === 'a' && t[3] === 'forkOf' && t[1]?.startsWith('30168:'));
  return {
    dTag: tags.find((t) => t[0] === 'd')?.[1] || '',
    name: tags.find((t) => t[0] === 'name')?.[1] || '',
    description: tags.find((t) => t[0] === 'description')?.[1] || '',
    fields: uniqueBy(fields, (f) => f.id),
    isPublic: tags.some((t) => t[0] === 'public'),
    confirmationMessage: tags.find((t) => t[0] === 'confirmation_message')?.[1] || '',
    autoResponse: tags.find((t) => t[0] === 'auto_response')?.[1] === 'true',
    sections: [],
    forkOf: forkTag ? { address: forkTag[1], relay: forkTag[2] || '' } : undefined
  };
}
