// JSDoc-only: the Termi item shapes shared by server, window and history codec.

/**
 * A knowledge tool's result item (server shape, `date`).
 * @typedef {{
 *   type: 'community'|'event'|'resource'|'person'|'passage',
 *   id: string, title: string, subtitle?: string, description?: string,
 *   href?: string, sourceUrl?: string, license?: string, licenseUrl?: string, creator?: string,
 *   publisher?: string, picture?: string, date?: string, end?: string,
 *   allDay?: boolean, location?: string,
 *   bot?: boolean, relay?: string, score?: number, weak?: boolean,
 *   pubkey?: string
 * }} Item
 */

/**
 * An Item as stored in conversation history (`start` instead of `date`).
 * @typedef {{ type: string, id: string, title: string, href?: string, pubkey?: string,
 *   picture?: string, start?: string, end?: string, location?: string, creator?: string,
 *   publisher?: string, license?: string, licenseUrl?: string, sourceUrl?: string }} SlimItem
 */

export {};
