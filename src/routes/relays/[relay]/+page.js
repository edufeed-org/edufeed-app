export const ssr = false;

/** Decode the relay URL from the route. Validation happens in the page so a
 *  malformed URL renders an in-app message instead of a 500.
 *  @type {import('./$types').PageLoad} */
export function load({ params }) {
  return { rawRelay: decodeURIComponent(params.relay) };
}
