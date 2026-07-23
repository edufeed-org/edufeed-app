/**
 * Pure branching logic for NIP-101 forms: conditional field visibility
 * (displayIf rule trees, Formstr-compatible) and section routing.
 *
 * @typedef {Object} ConditionGroup
 * @property {string} [questionId]
 * @property {string | string[]} [value]
 * @property {'equals'|'notEquals'|'contains'|'startsWith'|'endsWith'|'greaterThan'|'lessThan'|'greaterThanEqual'|'lessThanEqual'} [operator]
 * @property {'AND'|'OR'} [nextLogic]
 * @property {ConditionGroup[]} [rules]
 */

/**
 * Evaluate one leaf rule against the answers map.
 * Multi-select answers are semicolon-joined optionId strings.
 * @param {ConditionGroup} rule
 * @param {Record<string, any>} values
 * @returns {boolean}
 */
function evaluateLeaf(rule, values) {
  const answered = rule.questionId ? values[rule.questionId] : undefined;
  if (answered === undefined || answered === null || answered === '') return false;
  const answer = String(answered);
  const expected = Array.isArray(rule.value) ? rule.value.join(';') : String(rule.value ?? '');

  switch (rule.operator || 'equals') {
    case 'equals':
      return answer === expected;
    case 'notEquals':
      return answer !== expected;
    case 'contains': {
      // multi-select answers are ';'-joined optionIds → exact membership;
      // plain text answers keep substring semantics
      const parts = answer.split(';');
      if (parts.length > 1) return parts.includes(expected);
      return answer.includes(expected);
    }
    case 'startsWith':
      return answer.startsWith(expected);
    case 'endsWith':
      return answer.endsWith(expected);
    case 'greaterThan':
      return Number(answer) > Number(expected);
    case 'lessThan':
      return Number(answer) < Number(expected);
    case 'greaterThanEqual':
      return Number(answer) >= Number(expected);
    case 'lessThanEqual':
      return Number(answer) <= Number(expected);
    default:
      return false;
  }
}

/**
 * Evaluate a rule list with AND/OR chaining (Formstr semantics: each rule's
 * nextLogic joins it to the NEXT rule; default AND). Nested groups recurse.
 * @param {ConditionGroup[]} rules
 * @param {Record<string, any>} values
 * @returns {boolean}
 */
function evaluateRules(rules, values) {
  if (!rules || rules.length === 0) return true;
  let result = evaluateOne(rules[0], values);
  for (let i = 1; i < rules.length; i++) {
    const joiner = rules[i - 1].nextLogic || 'AND';
    const next = evaluateOne(rules[i], values);
    result = joiner === 'OR' ? result || next : result && next;
  }
  return result;
}

/** @param {ConditionGroup} rule @param {Record<string, any>} values */
function evaluateOne(rule, values) {
  if (Array.isArray(rule.rules) && rule.rules.length > 0) return evaluateRules(rule.rules, values);
  return evaluateLeaf(rule, values);
}

/**
 * @param {{ rules?: ConditionGroup[] } | undefined} displayIf
 * @param {Record<string, any>} values
 * @returns {boolean} true when the field should be shown
 */
export function evaluateDisplayIf(displayIf, values) {
  if (!displayIf?.rules?.length) return true;
  return evaluateRules(displayIf.rules, values);
}

/**
 * @param {import('./format.js').FormField[]} fields
 * @param {Record<string, any>} values
 * @returns {import('./format.js').FormField[]}
 */
export function visibleFields(fields, values) {
  return fields.filter((f) => evaluateDisplayIf(f.options?.displayIf, values));
}

/**
 * Sections sorted by `order` (array index fallback), with any field ids not
 * assigned to a section collected into a trailing implicit '__rest' section.
 * Templates without sections return [] (renderer falls back to single-page).
 * @param {{ sections?: import('./format.js').FormSection[], fields: import('./format.js').FormField[] }} template
 * @returns {import('./format.js').FormSection[]}
 */
export function orderedSections(template) {
  const rawSections = template.sections || [];
  if (rawSections.length === 0) return [];
  // Defense-in-depth: parseFormTemplate already dedupes, but callers may pass
  // a hand-built template, and a duplicate id would crash a keyed {#each}.
  const seen = new Set();
  const sections = rawSections.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  const sorted = [...sections].sort(
    (a, b) => (a.order ?? sections.indexOf(a)) - (b.order ?? sections.indexOf(b))
  );
  const assigned = new Set(sorted.flatMap((s) => s.questionIds || []));
  const stray = template.fields.map((f) => f.id).filter((id) => !assigned.has(id));
  if (stray.length > 0) sorted.push({ id: '__rest', title: '', questionIds: stray });
  return sorted;
}

/**
 * Next section after `currentSectionId`: an option-routing rule on the
 * selected option of an option field in the current section wins; otherwise
 * linear order; null after the last section.
 * @param {string} currentSectionId
 * @param {import('./format.js').FormSection[]} sections - output of orderedSections
 * @param {import('./format.js').FormField[]} fields
 * @param {Record<string, any>} values
 * @returns {string | null}
 */
export function resolveNextSectionId(currentSectionId, sections, fields, values) {
  const idx = sections.findIndex((s) => s.id === currentSectionId);
  if (idx === -1) return sections[0]?.id ?? null;

  const current = sections[idx];
  for (const fieldId of current.questionIds || []) {
    const field = fields.find((f) => f.id === fieldId);
    const answer = values[fieldId];
    if (!field?.options?.options?.length || !answer) continue;
    const options = /** @type {import('./format.js').FormFieldOption[]} */ (field.options.options);
    const selected = options.find((o) => o.id === String(answer));
    if (selected?.nextSection && sections.some((s) => s.id === selected.nextSection)) {
      return selected.nextSection;
    }
  }
  return sections[idx + 1]?.id ?? null;
}
