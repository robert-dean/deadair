/**
 * The breaking-news watch's settings, apart from the watch.
 *
 * Their own file so `settings.registry.ts` can declare them without importing the watch, which
 * imports the director and everything behind it. See `BreakingNewsWatch`.
 */

/** The `deadair.settings` keys. In the `bulletins` group beside the bulletin's own. */
export const BREAKING_KEYS = {
    feeds: 'news.breakingFeeds',
    pollMinutes: 'news.breakingPollMinutes',
    cooldownMinutes: 'news.breakingCooldownMinutes',
} as const;

/**
 * How often the breaking feeds are asked, in minutes, and its bounds.
 *
 * Five, which is a story on air within about one record of it being published. The floor is two
 * because every pass is a request to somebody else's server per feed, and conditional GET makes an
 * unchanged feed cheap rather than free.
 */
export const DEFAULT_BREAKING_POLL_MINUTES = 5;
export const MIN_BREAKING_POLL_MINUTES = 2;
export const MAX_BREAKING_POLL_MINUTES = 60;

/**
 * How long one breaking bulletin holds off the next, in minutes, and its bounds.
 *
 * Thirty: a station that breaks into its programme twice an hour for news is a news station, and
 * a breaking feed that posts more often than that is a feed that should be in the ordinary roster.
 */
export const DEFAULT_BREAKING_COOLDOWN_MINUTES = 30;
export const MIN_BREAKING_COOLDOWN_MINUTES = 5;
export const MAX_BREAKING_COOLDOWN_MINUTES = 24 * 60;
