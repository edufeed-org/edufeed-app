/**
 * What the host app gives Termi. Host-free: no `$lib/helpers` imports, so a
 * second host (browser extension, WordPress plugin) only has to provide this.
 * Actions take the WebMCP tool shape; no browser bridge yet.
 */

/**
 * @typedef {Object} HostAction
 * @property {string} name
 * @property {string} description
 * @property {object} inputSchema
 * @property {(input?: object) => unknown} execute
 * @property {{ readOnlyHint?: boolean, consequentialHint?: boolean }} [annotations]
 */

/**
 * @typedef {Object} TermiHost
 * @property {(href: string) => void} navigate
 * @property {() => HostAction[]} actions
 */

/**
 * One action per navigate/create skill. `toAction` is the host's own skill →
 * button logic (href building, create lookup); a null result (profile link
 * without a user, unknown create action) skips the skill.
 *
 * @param {Array<{ id: string, kind: string, phrases: { de: string[] } }>} skills
 * @param {{
 *   navigate: (href: string) => void,
 *   toAction: (skill: any) => { href?: string, run?: () => void } | null
 * }} host
 * @returns {HostAction[]}
 */
export function skillsAsHostActions(skills, { navigate, toAction }) {
  /** @type {HostAction[]} */
  const out = [];
  for (const skill of skills) {
    if (skill.kind !== 'navigate' && skill.kind !== 'create') continue;
    const action = toAction(skill);
    if (!action) continue;
    const open = skill.kind === 'navigate';
    out.push({
      name: `${open ? 'open' : 'create'}_${skill.id}`,
      description: skill.phrases.de[0],
      inputSchema: { type: 'object', properties: {} },
      execute: () => (action.href !== undefined ? navigate(action.href) : action.run?.()),
      annotations: open ? { readOnlyHint: true } : { consequentialHint: true }
    });
  }
  return out;
}
