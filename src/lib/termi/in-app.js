/** An in-app target: `/path`, never protocol-relative `//host`. Its own tiny module so the markdown helper can use it without pulling in the Termi link rules. */
export const IN_APP = /^\/(?!\/)/;
