import { loadReplaceablePointer } from '$lib/helpers/loadReplaceablePointer.js';

export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export const load = (ctx) => loadReplaceablePointer(ctx, 'boards');
