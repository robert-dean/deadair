import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * A programme the station carries, as one installed plugin describes it
 * generated from [StationShow](../../../../data/contracts/podcasts/podcasts.types.ck)
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
 * generated from [StationEpisode](../../../../data/contracts/podcasts/podcasts.types.ck)
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
 * A show a podcast plugin's directory knows about, which the station may or may not carry
 * generated from [StationDirectoryEntry](../../../../data/contracts/podcasts/podcasts.types.ck)
 */
export const StationDirectoryEntry = z.strictObject({
    id: z.string().min(1).max(400).describe("The directory's own id for the show. A key in a list, and nothing more"),
    pluginId: z.string().min(1).max(200).describe('The plugin whose directory answered, which is the plugin a subscription would go to'),
    title: z.string().min(1).max(600),
    feedUrl: z.string().min(1).max(2000).describe("Where the show's feed is, which is what subscribing needs"),
    author: z.string().max(600).optional(),
    description: z.string().max(4000).optional(),
    artworkUrl: z.string().max(2000).optional(),
    homeUrl: z.string().max(2000).optional(),
    categories: z.array(z.string().min(1).max(200)).optional(),
    explicit: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
});
export type StationDirectoryEntry = z.infer<typeof StationDirectoryEntry>;

/**
 * generated from [StationDirectoryQuery](../../../../data/contracts/podcasts/podcasts.types.ck)
 */
export const StationDirectoryQuery = z.strictObject({
    query: z.string().min(1).max(200).describe('Words to look a show up by: its name, its publisher, its subject'),
    limit: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(50)).optional(),
});
export type StationDirectoryQuery = z.infer<typeof StationDirectoryQuery>;

/**
 * generated from [StationEpisodeQuery](../../../../data/contracts/podcasts/podcasts.types.ck)
 */
export const StationEpisodeQuery = z.strictObject({
    showId: z.string().max(400).optional().describe("One show's episodes, or absent for every show's, newest first"),
    limit: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(200)).optional(),
});
export type StationEpisodeQuery = z.infer<typeof StationEpisodeQuery>;

/**
 * A show the station makes for itself: a saved recipe for a podcast, whose every episode is a production
 * generated from [OwnShow](../../../../data/contracts/podcasts/podcasts.types.ck)
 */
export const OwnShow = z.strictObject({
    id: z.string().min(1).max(100),
    title: z.string().min(1).max(200).describe("What the show is called. Each episode's title starts with it"),
    description: z.string().max(2000).optional().describe('What the show is, for the console. Never read out'),
    subject: z.string().max(4000).optional().describe('What an episode is about when it is asked for with no subject of its own'),
    personaId: z.string().max(100).optional().describe('Who presents it. Absent is whoever is presenting when it is made'),
    targetMs: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(60000).max(7200000))
        .optional()
        .describe("How long an episode runs. Absent is the station's production length"),
    writingMode: z
        .enum(['quick', 'outlined', 'polished'])
        .optional()
        .describe("How much of the model an episode is worth. Absent is the station's default"),
    newsFeedIds: z
        .array(z.string().min(1).max(400))
        .max(20)
        .optional()
        .describe("The station's news feeds an episode reads, by their qualified ids. Absent or empty is a show that does not read the news"),
    newsHours: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(168))
        .optional()
        .describe('How many hours of news an episode reads. Absent is a day'),
    createdAt: _ZodDatetime,
});
export type OwnShow = z.infer<typeof OwnShow>;

export const OwnShowInput = z.strictObject({
    title: z.string().min(1).max(200).describe("What the show is called. Each episode's title starts with it"),
    description: z.string().max(2000).optional().describe('What the show is, for the console. Never read out'),
    subject: z.string().max(4000).optional().describe('What an episode is about when it is asked for with no subject of its own'),
    personaId: z.string().max(100).optional().describe('Who presents it. Absent is whoever is presenting when it is made'),
    targetMs: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(60000).max(7200000))
        .optional()
        .describe("How long an episode runs. Absent is the station's production length"),
    writingMode: z
        .enum(['quick', 'outlined', 'polished'])
        .optional()
        .describe("How much of the model an episode is worth. Absent is the station's default"),
    newsFeedIds: z
        .array(z.string().min(1).max(400))
        .max(20)
        .optional()
        .describe("The station's news feeds an episode reads, by their qualified ids. Absent or empty is a show that does not read the news"),
    newsHours: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(168))
        .optional()
        .describe('How many hours of news an episode reads. Absent is a day'),
});
export type OwnShowInput = z.infer<typeof OwnShowInput>;

/**
 * Asks one of the station's own shows for an episode. Everything is optional: a show with a standing subject needs nothing
 * generated from [OwnEpisodeRequest](../../../../data/contracts/podcasts/podcasts.types.ck)
 */
export const OwnEpisodeRequest = z.strictObject({
    topic: z.string().max(4000).optional().describe("What this episode is about. Absent is the show's own subject"),
    url: z.string().max(2000).optional().describe('A page for it to read first, by its address. The episode states only what it can find there'),
    sourceTitle: z.string().max(300).optional().describe('What the pasted text is called'),
    text: z
        .string()
        .max(20000)
        .optional()
        .describe(
            'Something for it to read first. The episode states only what it can find in this. Given text, a show that reads the news reads this instead',
        ),
    airAt: _ZodDatetime.optional().describe('When it should air. Absent is as soon as it is made'),
});
export type OwnEpisodeRequest = z.infer<typeof OwnEpisodeRequest>;

/**
 * generated from [StationShowList](../../../../data/contracts/podcasts/podcasts.types.ck)
 */
export const StationShowList = z.strictObject({
    shows: z.array(StationShow),
});
export type StationShowList = z.infer<typeof StationShowList>;

/**
 * generated from [StationEpisodePage](../../../../data/contracts/podcasts/podcasts.types.ck)
 */
export const StationEpisodePage = z.strictObject({
    episodes: z.array(StationEpisode).describe('Newest first. Empty when the station knows of none, which is not an error'),
});
export type StationEpisodePage = z.infer<typeof StationEpisodePage>;

/**
 * generated from [StationDirectoryPage](../../../../data/contracts/podcasts/podcasts.types.ck)
 */
export const StationDirectoryPage = z.strictObject({
    results: z.array(StationDirectoryEntry).describe('Empty when nothing matched or no directory could be asked, which is not an error'),
});
export type StationDirectoryPage = z.infer<typeof StationDirectoryPage>;

/**
 * generated from [OwnShowList](../../../../data/contracts/podcasts/podcasts.types.ck)
 */
export const OwnShowList = z.strictObject({
    shows: z.array(OwnShow),
});
export type OwnShowList = z.infer<typeof OwnShowList>;

export const OwnShowListInput = z.strictObject({
    shows: z.array(OwnShowInput),
});
export type OwnShowListInput = z.infer<typeof OwnShowListInput>;
