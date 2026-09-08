/**
 * A feed one installed plugin offers
 * generated from [StationFeed](../../../../../apps/api/data/contracts/news/news.types.ck#L7)
 */
export interface StationFeed {
    /** Unique across the station: the plugin's own id for the feed, qualified with the plugin that offered it. Two services both calling something `world` stay distinct */
    id: string;
    pluginId: string;
    name: string;
    /** Broad subject, in the publisher's own word for it */
    category?: string;
    /** ISO 639-1, when the plugin knows */
    language?: string;
    description?: string;
}

/**
 * One published entry
 * generated from [NewsStory](../../../../../apps/api/data/contracts/news/news.types.ck#L20)
 */
export interface NewsStory {
    /** Stable for the same entry across calls, which is what lets a reader tell an arrival from something it has already seen */
    id: string;
    /** Qualified, matching `StationFeed.id` */
    feedId: string;
    feedName: string;
    title: string;
    /** The publisher's own teaser, as plain text. Never markup: this is written to be read out */
    summary?: string;
    /** The story itself, as the publisher's own paragraphs. Absent when the plugin could not read one, which is ordinary: an entry that links to audio, or a page nothing could be extracted from */
    content?: string;
    url?: string;
    /** ISO-8601 */
    publishedAt?: string;
    categories?: string[];
}

/**
 * generated from [NewsQuery](../../../../../apps/api/data/contracts/news/news.types.ck#L32)
 */
export interface NewsQuery {
    /** One feed, or absent for every feed the station can see, merged newest first */
    feedId?: string;
    limit?: number;
    /** Only entries published after this ISO-8601 instant */
    since?: string;
    /** Answer with headlines and teasers alone, skipping the story behind each one. A story is read from the publisher's own page, which is by far the slowest thing this route does, so a caller that will not use `content` should say so */
    headlinesOnly?: boolean;
}

/**
 * generated from [StationFeedList](../../../../../apps/api/data/contracts/news/news.types.ck#L16)
 */
export interface StationFeedList {
    feeds: StationFeed[];
}

/**
 * generated from [NewsPage](../../../../../apps/api/data/contracts/news/news.types.ck#L39)
 */
export interface NewsPage {
    /** Newest first. Empty when nothing could be read, which is deliberately not an error: the news is something the station may talk about, never something it needs to air */
    stories: NewsStory[];
}
