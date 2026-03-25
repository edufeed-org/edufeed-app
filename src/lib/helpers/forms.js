/**
 * @typedef {Object} FormField
 * @property {string} id
 * @property {string} type - text|textarea|number|email|url|select|checkbox|radio|date
 * @property {string} label
 * @property {string} [defaultValue]
 * @property {Record<string, any>} [options] - { required, min, max, options, placeholder }
 */

/**
 * @typedef {Object} ParsedFormTemplate
 * @property {string} dTag
 * @property {string} name
 * @property {string} description
 * @property {FormField[]} fields
 * @property {boolean} isPublic
 * @property {string} confirmationMessage
 * @property {boolean} autoResponse
 */

/**
 * Build tags for a form template event (kind 30168).
 * @param {string} dTag
 * @param {FormField[]} fields
 * @param {{ name?: string, description?: string, public?: boolean, confirmationMessage?: string, autoResponse?: boolean }} options
 * @returns {string[][]}
 */
export function buildFormTemplateTags(dTag, fields, options = {}) {
  /** @type {string[][]} */
  const tags = [['d', dTag]];

  if (options.name) tags.push(['name', options.name]);
  if (options.description) tags.push(['description', options.description]);

  for (const field of fields) {
    tags.push([
      'field',
      field.id,
      field.type,
      field.label,
      field.defaultValue || '',
      JSON.stringify(field.options || {})
    ]);
  }

  if (options.public) tags.push(['public']);
  if (options.confirmationMessage) tags.push(['confirmation_message', options.confirmationMessage]);
  if (options.autoResponse) tags.push(['auto_response', 'true']);

  return tags;
}

/**
 * Parse a form template event into structured data.
 * @param {{ kind: number, pubkey: string, tags: string[][], content: string, created_at: number }} event
 * @returns {ParsedFormTemplate}
 */
export function parseFormTemplate(event) {
  const tags = event.tags || [];

  const dTag = tags.find((t) => t[0] === 'd')?.[1] || '';
  const name = tags.find((t) => t[0] === 'name')?.[1] || '';
  const description = tags.find((t) => t[0] === 'description')?.[1] || '';
  const isPublic = tags.some((t) => t[0] === 'public');
  const confirmationMessage = tags.find((t) => t[0] === 'confirmation_message')?.[1] || '';
  const autoResponse = tags.find((t) => t[0] === 'auto_response')?.[1] === 'true';

  /** @type {FormField[]} */
  const fields = tags
    .filter((t) => t[0] === 'field' && t.length >= 4)
    .map((t) => {
      let options = {};
      try {
        options = t[5] ? JSON.parse(t[5]) : {};
      } catch {
        options = {};
      }
      return {
        id: t[1],
        type: t[2],
        label: t[3],
        defaultValue: t[4] || '',
        options
      };
    });

  return { dTag, name, description, fields, isPublic, confirmationMessage, autoResponse };
}

/**
 * Generate a unique field ID from a label.
 * @param {string} label
 * @param {string[]} existingIds
 * @returns {string}
 */
export function generateFieldId(label, existingIds) {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const isFallback = !base;
  if (!base) base = 'field';

  if (!isFallback) {
    if (!existingIds.includes(base)) return base;
  }

  let suffix = isFallback ? 1 : 2;
  while (existingIds.includes(`${base}-${suffix}`)) {
    suffix++;
  }
  return `${base}-${suffix}`;
}
