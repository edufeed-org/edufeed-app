export const ssr = false;
export const prerender = false;

/** @param {{ params: { topic: string } }} context */
export function load({ params }) {
  return { topic: params.topic };
}
