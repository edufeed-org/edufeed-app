// The client's model choice: labels, which offered id a request carries, and the
// fallback an answer reports. Pure: storage and fetching live in the controller.
import { parseModelId, serviceOf } from './model-id.js';

/** localStorage keys, read and written by the controller only. */
export const CHOICE_KEY = 'termi.model';
export const OUTSIDE_OK_KEY = 'termi.model.outsideOk';

/** @typedef {{ id: string, name: string, state?: 'ready'|'busy'|'down' }} ModelEntry */
/**
 * The models endpoint's answer.
 * @typedef {{ default: string, models: ModelEntry[], external?: { models: ModelEntry[], left?: number, total?: number } }} ModelList
 */

/** @param {unknown} id */
export const isOutside = (id) => serviceOf(id) === 'anthropic';

/** Proper names, not translated. @param {unknown} id */
export const serviceLabel = (id) => (isOutside(id) ? 'Anthropic (USA)' : 'SAIA (GWDG)');

/** @param {string} id @param {Record<string, string>} names id → display name */
export const modelLabel = (id, names) => names[id] ?? parseModelId(id)?.model ?? id;

/** @param {ModelList} list */
const offered = (list) => [...list.models, ...(list.external?.models ?? [])].map((x) => x.id);

/**
 * The id a request carries: the stored one while the list still offers it, else the default.
 * @param {string | null} stored @param {ModelList} list @returns {string}
 */
export const effectiveChoice = (stored, list) =>
  stored && offered(list).includes(stored) ? stored : list.default;

/**
 * The id the next request carries: an outside choice only after her confirm on this device.
 * @param {string | null} stored @param {ModelList} list @param {boolean} outsideOk @returns {string}
 */
export function chosenModel(stored, list, outsideOk) {
  const id = effectiveChoice(stored, list);
  return isOutside(id) && !outsideOk ? list.default : id;
}

/** id → display name of every offered model. @param {ModelList | null} list @returns {Record<string, string>} */
export const namesOf = (list) =>
  Object.fromEntries(
    [...(list?.models ?? []), ...(list?.external?.models ?? [])].map((x) => [x.id, x.name])
  );

/** Something to choose: two SAIA models, or an outside group. @param {ModelList | null} list */
export const hasChoice = (list) =>
  !!list && (list.models.length > 1 || !!list.external?.models?.length);

/**
 * The model the server tries after the chosen `id`: it tries the chosen one first,
 * then the other SAIA models in list order. Never one for an outside choice.
 * @param {string} id @param {ModelList} list @returns {string | undefined}
 */
export const nextCandidate = (id, list) =>
  isOutside(id) ? undefined : list.models.find((x) => x.id !== id && x.state !== 'down')?.id;

const REASONS = ['capacity', 'no_start'];

/**
 * Wire metadata `{ chosen, reason }` (null = absent) → the turn's `{ from, reason }`.
 * @param {any} metadata @returns {{ from: string, reason: 'capacity'|'no_start' } | undefined}
 */
export function fallbackOf(metadata) {
  const from = metadata?.chosen;
  const reason = metadata?.reason;
  return parseModelId(from) && REASONS.includes(reason) ? { from, reason } : undefined;
}

/**
 * A stored or streamed model id: a prefixed one as is; a record from before the
 * prefix holds a bare SAIA id (`glm-5.3`) and reads as `saia:glm-5.3` — or a bare
 * `claude-*` id from the removed dev opt-in, read as `anthropic:`; else nothing.
 * @param {unknown} v @returns {string | undefined}
 */
export function normalizeStoredModel(v) {
  if (parseModelId(v)) return /** @type {string} */ (v);
  if (typeof v !== 'string' || v.includes(':')) return undefined;
  const id = `${v.startsWith('claude-') ? 'anthropic' : 'saia'}:${v}`;
  return parseModelId(id) ? id : undefined;
}
