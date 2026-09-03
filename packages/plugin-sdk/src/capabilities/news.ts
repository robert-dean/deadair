/**
 * The `news` kind. A news plugin answers "what happened", as entries somebody
 * else published.
 *
 * ## It reports, and it does not schedule
 *
 * Nothing here says anything about a break, a bulletin or a running order. A
 * plugin hands over what its sources published and the station decides whether
 * that is worth saying, when, and in whose voice — the same boundary
 * `capabilities/charts.ts` keeps for the same reason. A source able to put
 * itself on air is a source that can talk over an operator's decisions.
 *
 * ## Several plugins, several newsrooms
 *
 * Unlike `enrichment`, this is not a fan-out that merges: two news services do
 * not produce one better story, they produce two stories. So there is no
 * `priority` here, and the host qualifies every {@link NewsFeedDescriptor.id}
 * with the plugin that offered it — two services will both call something
 * `world`.
 *
 * ## `id` + `publishedAt` + `since` are a de-duplication contract
 *
 * The one rule in this file that is not obvious from the shapes, and the one
 * that anything polling depends on: **a {@link NewsItem.id} is stable for the
 * same entry across calls**, so a caller can tell an arrival from something it
 * has already seen without holding state on the plugin's behalf. A plugin must
 * not renumber, re-order or synthesise ids per call, and must not let a cache
 * of its own hide an entry that {@link NewsQuery.since} asked for. Both are
 * free if the plugin builds its items with `feed.parse.ts`, which is where that
 * ladder lives.
 *
 * Every shape here is JSON-safe.
 */

/**
 * One feed this plugin can serve.
 *
 * `id` is scoped to this plugin and needs to be unique only within it. The host
 * qualifies it before anything outside sees it, so a short flat id is right.
 */
export interface NewsFeedDescriptor {
    id: string;
    /** What to call it in a list an operator reads, e.g. `World news`. */
    name: string;
    /** Broad subject, e.g. `world`, `sport`, `technology`. The publisher's own word for it. */
    category?: string;
    /** ISO 639-1, when the plugin knows what language the entries are in. */
    language?: string;
    description?: string;
    /**
     * How often this source is worth asking, in milliseconds.
     *
     * A hint from the only party that knows: a wire service publishes minute by
     * minute and a weekly column does not. Nothing is obliged to honour it, and
     * a plugin that has no opinion leaves it out rather than inventing one.
     */
    pollHintMs?: number;
}

/** What a news source is asked for. */
export interface NewsQuery {
    /**
     * A {@link NewsFeedDescriptor.id} this plugin offered, or absent for all of
     * them merged newest first.
     *
     * Absent is the common case and is why it is optional: "what is going on"
     * is one question, and making a caller pick a feed first would cost a model
     * a whole round trip to learn ids it has no basis for choosing between.
     */
    feedId?: string;
    /** How many entries to return. A plugin may return fewer; it must not return more. */
    limit: number;
    /**
     * Only entries published after this instant, as an ISO-8601 string. Never a
     * `Date`.
     *
     * How a caller asks what is new since it last looked. A plugin that cannot
     * filter upstream filters what it got rather than ignoring this, because a
     * caller cannot tell "there is nothing new" from "this was not applied".
     */
    since?: string;
    /**
     * `true` when the caller will not read {@link NewsItem.content}, so a plugin
     * that would go and fetch one should not bother.
     *
     * A hint about COST rather than about shape: a plugin that has the story
     * already, because the entry carried it, still sends it. What this asks it
     * to skip is work it would otherwise do on the caller's behalf — for a feed
     * reader that means following each entry's link and reading the publisher's
     * page, which is an order of magnitude more expensive than the feed itself
     * and is why this exists.
     *
     * Absent means the ordinary thing, so a plugin that ignores this is slow
     * rather than wrong, and a caller that forgets it gets stories it does not
     * need. That is the right way round: the console asked for a page of
     * headlines and waited three seconds for article bodies it never drew.
     */
    headlinesOnly?: boolean;
}

/** One published entry. */
export interface NewsItem {
    /** Stable across calls. See the de-duplication contract in this file's header. */
    id: string;
    /** Which feed it came from, as the plugin's own unqualified id. */
    feedId: string;
    /** That feed's name, so a caller reading one merged list can say where a story came from. */
    feedName: string;
    title: string;
    /**
     * The entry's own words, as PLAIN TEXT.
     *
     * Never markup. This ends up in a model's context and possibly in a
     * speaking voice, and a `<p>` reaching either of those is a bug that is
     * only noticed on air. `parseFeed` in `feed.parse.ts` already guarantees it.
     */
    summary?: string;
    /**
     * The story itself, as PLAIN TEXT, when the plugin could read it.
     *
     * Distinct from {@link summary} rather than replacing it, because they are
     * two different things a publisher wrote: a summary is the teaser attached
     * to the entry and this is the article. In practice the teaser is often one
     * sentence restating the title, which is why a caller wanting to say what
     * HAPPENED needs somewhere else to look.
     *
     * Still the publisher's own words in the publisher's own order, never a
     * plugin's paraphrase. A plugin fetches and the host thinks — the same
     * boundary `capabilities/enrichment.ts` keeps with `SourceDocument`, for
     * the same reason: only the host can check a claim against the text it came
     * from, and prose that has been through a plugin's own summariser is prose
     * nothing can check.
     *
     * Absent is entirely ordinary. An entry that links to an audio piece, a
     * page a plugin was refused, and one it had no budget left to read all
     * arrive the same way, and every caller's fallback is the entry's own
     * words. `extractArticle` in `article.parse.ts` is what produces this for
     * a plugin reading pages.
     */
    content?: string;
    url?: string;
    /** ISO-8601. Never a `Date`, and absent when the source published no readable one. */
    publishedAt?: string;
    /** The publisher's own labels, unmapped. Useful for filtering, never authoritative. */
    categories?: string[];
}

/**
 * Implemented by a `news` plugin.
 */
export interface NewsProvider {
    /**
     * What this plugin can serve, right now.
     *
     * Asked per call rather than cached by the host, for the reason
     * `ChartsProvider.listCharts` is: an operator reconfiguring a plugin
     * reinitializes it, and a feed list built from a config field would
     * otherwise be a boot snapshot of a setting that has since changed.
     *
     * An empty array is an ordinary answer — a plugin nobody has pointed at a
     * feed yet has nothing to offer — and is not a failure.
     */
    listFeeds(): Promise<NewsFeedDescriptor[]>;

    /**
     * Entries, newest first.
     *
     * Return `[]` for a `feedId` you do not recognise rather than throwing: the
     * host asks the plugin that named the id, so an unknown one means the menu
     * moved underneath a caller, which is a stale request and not a fault. A
     * source that could not be read is the same answer for the same reason, and
     * one failing feed must not cost the others.
     */
    fetchItems(query: NewsQuery): Promise<NewsItem[]>;
}
