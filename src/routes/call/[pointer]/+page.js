export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export function load({ params }) {
  return { rawPointer: decodeURIComponent(params.pointer) };
}
