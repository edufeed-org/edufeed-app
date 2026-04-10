export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export function load({ url }) {
  return {
    to: url.searchParams.get('to') || null
  };
}
