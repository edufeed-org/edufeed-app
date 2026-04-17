export const ssr = false;
export const prerender = false;

export async function load({ params }) {
  return { naddr: params.naddr };
}
