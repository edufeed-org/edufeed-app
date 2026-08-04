export const ssr = false;

/** Decode the `host'id` pointer from the URL. Parsing/validation happens in
 *  the page component so an invalid pointer renders an in-app error instead
 *  of a 500. @type {import('./$types').PageLoad} */
export function load({ params }) {
  return { rawPointer: decodeURIComponent(params.pointer) };
}
