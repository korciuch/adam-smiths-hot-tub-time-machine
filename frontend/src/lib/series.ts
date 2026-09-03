/**
 * Categorical slots available for series color.
 *
 * Eight is a hard ceiling, not a soft one: a 9th hue would have to be generated
 * or recycled, and either way it stops being distinguishable under simulated
 * colour-vision deficiency. Past eight the UI refuses further selections rather
 * than degrading the palette.
 *
 * Kept free of the `'use client'` boundary so both the server component reading
 * `searchParams` and the client chart can import it.
 */
export const MAX_SERIES = 8
