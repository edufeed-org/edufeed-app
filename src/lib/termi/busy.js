// Which kind of work a running answer is doing, for the bubble's busy line (host-free).
import { toolNameOf } from './tool-registry.js';

/** @typedef {'material'|'curriculum'|'people'|'sheet'|'writing'} BusyGroup */

/** @type {Record<string, 'material'|'curriculum'|'people'|'sheet'>} */
const GROUP = {
  search_content: 'material',
  search_resources: 'material',
  search_passages: 'material',
  search_events: 'material',
  get_content: 'material',
  find_curriculum: 'curriculum',
  search_curriculum: 'curriculum',
  curriculum_competences: 'curriculum',
  find_community: 'people',
  find_people: 'people',
  list_block_types: 'sheet',
  describe_block_types: 'sheet',
  create_sheet: 'sheet',
  change_sheet: 'sheet'
};

/**
 * The group of the latest tool call still running, else 'writing'.
 * @param {any[] | undefined} parts a streaming message's parts
 * @returns {BusyGroup}
 */
export function busyGroup(parts) {
  for (let i = (parts?.length ?? 0) - 1; i >= 0; i--) {
    const p = /** @type {any[]} */ (parts)[i];
    if (p.state !== 'input-streaming' && p.state !== 'input-available') continue;
    const g = GROUP[toolNameOf(p)];
    if (g) return g;
  }
  return 'writing';
}
