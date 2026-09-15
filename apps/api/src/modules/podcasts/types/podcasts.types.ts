import { z } from 'zod';

/**
 * A programme the station carries, as one installed plugin describes it
 * generated from [StationShow](../../../../data/contracts/podcasts/podcasts.types.ck#L7)
 */
export const StationShow = z.strictObject({
    id: z.string().min(1).max(400).describe("Unique across the station: the plugin's own id for the show, qualified with the plugin that offered it"),
    pluginId: z.string().min(1).max(200),
    title: z.string().min(1).max(600).describe('What the show is called, which is what a presenter says out loud'),
    author: z.string().max(600).optional(),
    description: z.string().max(4000).optional().describe('What the show says about itself, as plain text'),
    artworkUrl: z.string().max(2000).optional(),
    homeUrl: z.string().max(2000).optional(),
    feedUrl: z.string().max(2000).optional().describe('Where its feed is, when the plugin reads one'),
    language: z.string().max(40).optional(),
    categories: z.array(z.string().min(1).max(200)).optional(),
    explicit: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe('Whether the publisher marked the whole show explicit. Absent means the publisher did not say, which is not the same as clean'),
});
export type StationShow = z.infer<typeof StationShow>;

/**
 * One episode of a programme the station carries, and what the station has done with it
 * generated from [StationEpisode](../../../../data/contracts/podcasts/podcasts.types.ck#L25)
 */
export const StationEpisode = z.strictObject({
    id: z.string().min(1).max(100).describe("The station's own id for this episode"),
    showId: z.string().min(1).max(400).describe('Qualified, matching `StationShow.id`'),
    episodeId: z.string().min(1).max(1000).describe("The plugin's own id for the episode, stable across refreshes"),
    showTitle: z.string().min(1).max(600),
    title: z.string().min(1).max(1000),
    summary: z.string().max(4000).optional().describe('What the publisher says it is about, as plain text'),
    url: z.string().max(2000).optional().describe("The episode's page, for a person"),
    publishedAt: z.string().max(40).optional().describe('ISO-8601'),
    durationMs: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .optional()
        .describe('How long the publisher says it runs, in milliseconds'),
    artworkUrl: z.string().max(2000).optional(),
    explicit: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
    seenAt: z.string().max(40).describe('ISO-8601: when a refresh last saw it in its feed'),
    fetched: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the station holds its own copy of the audio, ready to air'),
    fetchRequestedAt: z.string().max(40).optional().describe('ISO-8601: when the station last asked for the audio'),
    fetchError: z.string().max(2000).optional().describe('Why the last attempt to fetch the audio failed, when it did'),
    scheduledFor: z.string().max(40).optional().describe('ISO-8601: the slot the audio was fetched for'),
    airedAt: z.string().max(40).optional().describe('ISO-8601: when a listener could first have heard it. An episode airs once'),
});
export type StationEpisode = z.infer<typeof StationEpisode>;

/**
 * generated from [StationEpisodeQuery](../../../../data/contracts/podcasts/podcasts.types.ck#L45)
 */
export const StationEpisodeQuery = z.strictObject({
    showId: z.string().max(400).optional().describe("One show's episodes, or absent for every show's, newest first"),
    limit: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(200)).optional(),
});
export type StationEpisodeQuery = z.infer<typeof StationEpisodeQuery>;

/**
 * generated from [StationShowList](../../../../data/contracts/podcasts/podcasts.types.ck#L21)
 */
export const StationShowList = z.strictObject({
    shows: z.array(StationShow),
});
export type StationShowList = z.infer<typeof StationShowList>;

/**
 * generated from [StationEpisodePage](../../../../data/contracts/podcasts/podcasts.types.ck#L50)
 */
export const StationEpisodePage = z.strictObject({
    episodes: z.array(StationEpisode).describe('Newest first. Empty when the station knows of none, which is not an error'),
});
export type StationEpisodePage = z.infer<typeof StationEpisodePage>;
