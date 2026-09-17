import { z } from 'zod';

const _ZodBinary = z.custom<Buffer>(val => Buffer.isBuffer(val), { error: 'Must be binary data' });

/**
 * The picture one KIND of break wears -- a weather forecast, a news bulletin -- as the console draws
 * it.
 *
 * Only kinds the station actually holds bytes for are listed. A kind with no picture is a break
 * wearing the station's logo on the mount and nothing in a listener's app, which is what every break
 * did before this existed and is not a row worth drawing
 * generated from [BreakArtwork](../../../../data/contracts/art/art.types.ck#L13)
 */
export const BreakArtwork = z.strictObject({
    kind: z
        .string()
        .min(1)
        .max(64)
        .describe(
            '`segments.kind`, which is what decides which break wears this: `weather`, `news`, or whatever an operator wrote on a format-clock band',
        ),
    url: z
        .string()
        .max(2000)
        .describe("Where the station serves it, as a path under the API root. The same shape and the same route a record's cover uses"),
    source: z.enum(['shipped', 'operator']).describe('Whether these are the bytes this repository ships or ones somebody uploaded over them'),
    hasShipped: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether this repository ships a picture for this kind, which is whether reverting has anywhere to go'),
});
export type BreakArtwork = z.infer<typeof BreakArtwork>;

/**
 * A picture arriving from the browser, as multipart form parts.
 *
 * Documentation rather than validation: a multipart body reaches the service as the raw parser and
 * the generated client types the body as `FormData`, so nothing checks this shape. It says what to
 * send
 * generated from [BreakArtworkUpload](../../../../data/contracts/art/art.types.ck#L30)
 */
export const BreakArtworkUpload = z.strictObject({
    file: _ZodBinary.describe(
        'The image itself. jpeg, png, webp or gif, decided by its BYTES rather than by its name or its declared type, and at most 4 MB',
    ),
});
export type BreakArtworkUpload = z.infer<typeof BreakArtworkUpload>;

/**
 * Every kind the station holds a picture for, kind by kind
 * generated from [BreakArtworkList](../../../../data/contracts/art/art.types.ck#L21)
 */
export const BreakArtworkList = z.strictObject({
    breaks: z.array(BreakArtwork),
});
export type BreakArtworkList = z.infer<typeof BreakArtworkList>;
