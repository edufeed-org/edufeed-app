export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export function load({ params, url }) {
  return {
    naddr: params.naddr,
    initialTab: url.searchParams.get('tab') || 'preview'
  };
}
