/**
 * The slices of the MediaWiki action API this plugin reads.
 *
 * Partial by design and typed as optional throughout: these are somebody
 * else's documents, every one of these fields is absent on some real response,
 * and the only defence against that is being made to check.
 */

/** `action=query&list=search`. The `title` of a Wikidata result IS the Q-id. */
export interface MediaWikiSearchResponse {
    query?: {
        searchinfo?: { totalhits?: number };
        search?: { title?: string; snippet?: string }[];
    };
}

/** One entity from `action=wbgetentities`. */
export interface WikidataEntity {
    id?: string;
    labels?: Record<string, { language?: string; value?: string }>;
    descriptions?: Record<string, { language?: string; value?: string }>;
    sitelinks?: Record<string, { site?: string; title?: string }>;
    claims?: Record<string, WikidataClaim[]>;
}

/**
 * One statement on an entity.
 *
 * Only the shape of an item-valued snak is described, because the only claim
 * this plugin reads is `P175` (performer) and the only thing it wants from one
 * is the Q-id on the other end.
 */
export interface WikidataClaim {
    mainsnak?: {
        snaktype?: string;
        datavalue?: { type?: string; value?: { id?: string } };
    };
}

export interface WikidataEntitiesResponse {
    entities?: Record<string, WikidataEntity>;
    error?: { info?: string };
}

/**
 * `action=query&prop=extracts&explaintext=1`.
 *
 * An ARRAY of pages because every request here sends `formatversion=2`. The
 * legacy format keys the same pages by page id and gives a missing one the id
 * `-1`, which is the shape most examples on the web show; nothing in this
 * plugin will ever see it.
 *
 * A page that does not exist arrives with `missing: true` and no `extract`,
 * rather than as an error.
 */
export interface WikipediaExtractResponse {
    query?: {
        pages?: { pageid?: number; title?: string; extract?: string; missing?: boolean }[];
    };
}

/** Every action API error, whichever module produced it. */
export interface MediaWikiErrorResponse {
    error?: { code?: string; info?: string };
}
