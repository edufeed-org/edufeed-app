/**
 * Env lookup for the nope-mcp integration (formerly amb-mcp — the service was
 * renamed, but existing deployments may still only set the old names).
 *
 * Reads `NOPE_MCP_<suffix>` first, falling back to the legacy
 * `AMB_MCP_<suffix>` name. An empty string counts as unset so a blank
 * override never shadows a configured fallback.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} suffix - e.g. 'URL', 'TOKEN_URL', 'CLIENT_ID', 'CLIENT_SECRET', 'SCOPE'
 * @returns {string | undefined}
 */
export function nopeMcpEnv(env, suffix) {
  const nope = env[`NOPE_MCP_${suffix}`];
  if (nope) return nope;
  const amb = env[`AMB_MCP_${suffix}`];
  if (amb) return amb;
  return undefined;
}
