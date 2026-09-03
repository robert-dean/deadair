import { z } from 'zod';

/**
 * A feed one installed plugin offers
 * generated from [StationFeed](file://./../../../../data/contracts/news/news.types.ck#L7)
 */
export const StationFeed = z.strictObject({
    id: z
        .string()
        .min(1)
        .max(400)
        .describe(
            "Unique across the station: the plugin's own id for the feed, qualified with the plugin that offered it. Two services both calling something `world` stay distinct",
        ),
    pluginId: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    category: z.string().max(200).optional().describe("Broad subject, in the publisher's own word for it"),
    language: z.string().max(10).optional().describe('ISO 639-1, when the plugin knows'),
    description: z.string().max(2000).optional(),
});
export type StationFeed = z.infer<typeof StationFeed>;

/**
 * One published entry
 * generated from [NewsStory](file://./../../../../data/contracts/news/news.types.ck#L20)
 */
export const NewsStory = z.strictObject({
    id: z
        .string()
        .min(1)
        .max(600)
        .describe('Stable for the same entry across calls, which is what lets a reader tell an arrival from something it has already seen'),
    feedId: z.string().min(1).max(400).describe('Qualified, matching `StationFeed.id`'),
    feedName: z.string().min(1).max(200),
    title: z.string().min(1).max(600),
    summary: z.string().max(2000).optional().describe("The publisher's own teaser, as plain text. Never markup: this is written to be read out"),
    content: z
        .string()
        .max(4000)
        .optional()
        .describe(
            "The story itself, as the publisher's own paragraphs. Absent when the plugin could not read one, which is ordinary: an entry that links to audio, or a page nothing could be extracted from",
        ),
    url: z.string().max(2000).optional(),
    publishedAt: z.string().max(40).optional().describe('ISO-8601'),
    categories: z.array(z.string().min(1).max(200)).optional(),
});
export type NewsStory = z.infer<typeof NewsStory>;

/**
 * generated from [NewsQuery](file://./../../../../data/contracts/news/news.types.ck#L32)
 */
export const NewsQuery = z.strictObject({
    feedId: z.string().max(400).optional().describe('One feed, or absent for every feed the station can see, merged newest first'),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    since: z.string().max(40).optional().describe('Only entries published after this ISO-8601 instant'),
    headlinesOnly: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe(
            "Answer with headlines and teasers alone, skipping the story behind each one. A story is read from the publisher's own page, which is by far the slowest thing this route does, so a caller that will not use `content` should say so",
        ),
});
export type NewsQuery = z.infer<typeof NewsQuery>;

/**
 * generated from [StationFeedList](file://./../../../../data/contracts/news/news.types.ck#L16)
 */
export const StationFeedList = z.strictObject({
    feeds: z.array(StationFeed),
});
export type StationFeedList = z.infer<typeof StationFeedList>;

/**
 * generated from [NewsPage](file://./../../../../data/contracts/news/news.types.ck#L39)
 */
export const NewsPage = z.strictObject({
    stories: z
        .array(NewsStory)
        .describe(
            'Newest first. Empty when nothing could be read, which is deliberately not an error: the news is something the station may talk about, never something it needs to air',
        ),
});
export type NewsPage = z.infer<typeof NewsPage>;
