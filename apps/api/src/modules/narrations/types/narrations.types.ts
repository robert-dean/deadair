import { z } from 'zod';

/**
 * Something the station can read out, as one installed plugin describes it
 * generated from [StationSeries](../../../../data/contracts/narrations/narrations.types.ck#L7)
 */
export const StationSeries = z.strictObject({
    id: z
        .string()
        .min(1)
        .max(400)
        .describe("Unique across the station: the plugin's own id for the series, qualified with the plugin that offered it"),
    pluginId: z.string().min(1).max(200),
    title: z.string().min(1).max(600).describe('What the series is called, which is what a presenter says out loud'),
    order: z
        .enum(['serial', 'latest'])
        .describe('How it is worked through: `serial` from the beginning in order, `latest` its newest piece and nothing once that has aired'),
    author: z.string().max(600).optional(),
    description: z.string().max(4000).optional().describe('What the series says about itself, as plain text'),
    artworkUrl: z.string().max(2000).optional(),
    homeUrl: z.string().max(2000).optional(),
    language: z
        .string()
        .max(40)
        .optional()
        .describe("ISO 639-1, or the source's own tag. Also what the station splits sentences by when it cuts a long piece up"),
});
export type StationSeries = z.infer<typeof StationSeries>;

/**
 * One instalment, and what the station has done with it
 * generated from [StationPiece](../../../../data/contracts/narrations/narrations.types.ck#L23)
 */
export const StationPiece = z.strictObject({
    id: z.string().min(1).max(100).describe("The station's own id for this piece"),
    seriesId: z.string().min(1).max(400).describe('Qualified, matching `StationSeries.id`'),
    pieceId: z.string().min(1).max(1000).describe("The plugin's own id for the piece, stable across refreshes"),
    seriesTitle: z.string().min(1).max(600),
    title: z.string().min(1).max(1000),
    order: z.enum(['serial', 'latest']).describe('How its series is worked through, copied onto the piece by every refresh'),
    author: z.string().max(600).optional(),
    summary: z.string().max(4000).optional().describe('What it is about, as plain text'),
    url: z.string().max(2000).optional().describe("The piece's page, for a person"),
    artworkUrl: z.string().max(2000).optional(),
    ordinal: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .optional()
        .describe('Where it comes in a serial, from 0. Absent for a `latest` series'),
    publishedAt: z.string().max(40).optional().describe('ISO-8601'),
    wordCount: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .optional()
        .describe('Roughly how many words it runs to, as the plugin counted them'),
    seenAt: z.string().max(40).describe('ISO-8601: when a refresh last saw it listed'),
    rendered: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the station has the spoken audio, ready to air'),
    rendering: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the words are being spoken right now'),
    renderRequestedAt: z.string().max(40).optional().describe('ISO-8601: when the station last asked for it to be spoken'),
    renderError: z.string().max(2000).optional().describe('Why the last attempt to speak it failed, when it did'),
    scheduledFor: z.string().max(40).optional().describe('ISO-8601: the slot it was made for'),
    airedAt: z
        .string()
        .max(40)
        .optional()
        .describe(
            "ISO-8601: when a listener could first have heard it. A piece airs once, and for a serial this is also the station's place in the book",
        ),
});
export type StationPiece = z.infer<typeof StationPiece>;

/**
 * generated from [StationPieceQuery](../../../../data/contracts/narrations/narrations.types.ck#L46)
 */
export const StationPieceQuery = z.strictObject({
    seriesId: z.string().max(400).optional().describe("One series' pieces in its own order, or absent for every series' newest first"),
    limit: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(500)).optional(),
});
export type StationPieceQuery = z.infer<typeof StationPieceQuery>;

/**
 * generated from [StationSeriesList](../../../../data/contracts/narrations/narrations.types.ck#L19)
 */
export const StationSeriesList = z.strictObject({
    series: z.array(StationSeries),
});
export type StationSeriesList = z.infer<typeof StationSeriesList>;

/**
 * generated from [StationPiecePage](../../../../data/contracts/narrations/narrations.types.ck#L51)
 */
export const StationPiecePage = z.strictObject({
    pieces: z.array(StationPiece).describe('Empty when the station knows of none, which is not an error'),
});
export type StationPiecePage = z.infer<typeof StationPiecePage>;
