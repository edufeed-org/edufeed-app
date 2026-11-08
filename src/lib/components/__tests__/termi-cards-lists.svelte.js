// Stand-ins for the blocked / hidden-calendar lists in TermiCards.test.js:
// plain (non-reactive) key arrays like the real lists, plus a reactive version.
export const blocked = /** @type {string[]} */ ([]);
export const hidden = /** @type {string[]} */ ([]);
export const versions = $state({ blocked: 0, hidden: 0 });
