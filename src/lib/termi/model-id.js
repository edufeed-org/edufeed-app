const MODEL = /^(saia|anthropic):([A-Za-z0-9_.:-]{1,80})$/;

/**
 * Splits a `service:model` id; only the `saia:` and `anthropic:` prefixes exist.
 * @param {unknown} id
 * @returns {{ service: 'saia' | 'anthropic', model: string } | null}
 */
export function parseModelId(id) {
  const m = typeof id === 'string' ? MODEL.exec(id) : null;
  return m ? { service: /** @type {'saia' | 'anthropic'} */ (m[1]), model: m[2] } : null;
}

/** @param {unknown} id */
export const serviceOf = (id) => parseModelId(id)?.service ?? null;
