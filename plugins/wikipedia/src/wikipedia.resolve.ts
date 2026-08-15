import { baseForm, normalize, type SourceDocument } from '@deadair/plugin-sdk';

import { PROPERTY_PERFORMER } from './wikipedia.manifest.js';
import type { MediaWikiSearchResponse, WikidataEntity, WikipediaExtractResponse } from './wikipedia.types.js';

/**
 * Turning somebody else's documents into an answer, with every judgement about
 * whether a match is really a match kept in one file and out of the request
 * paths.
 *
 * All pure, because this is the half that can be wrong in a way nobody notices:
 * a resolve that picks the wrong article does not fail, it produces a station
 * confidently saying something true about a different record.
 */

/** The sitelink key for a language edition: `en` → `enwiki`. */
export const siteKey = (language: string): string => `${language.replace(/-/g, '_')}wiki`;

/** A `haswbstatement` search term, which is how an mbid becomes a Q-id. */
export const statementQuery = (property: string, value: string): string => `haswbstatement:${property}=${value}`;

/**
 * The article URL for a title, which is what a claim is cited by.
 *
 * Built rather than read off the response, because the API answers with a
 * title and every consumer of this wants an address. Spaces become
 * underscores, everything else is percent-encoded — the canonical article
 * form.
 */
export const articleUrl = (language: string, title: string): string =>
    `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

/** Q-ids from a `list=search` answer, in the order the search ranked them. */
export function searchedIds(response: MediaWikiSearchResponse, limit = 10): string[] {
    const results = response.query?.search ?? [];
    return results
        .map(result => result.title?.trim())
        .filter((title): title is string => title !== undefined && /^Q\d+$/.test(title))
        .slice(0, limit);
}

/** An entity's label in the wanted language, falling back to English and then to anything at all. */
export function labelOf(entity: WikidataEntity | undefined, language: string): string | undefined {
    const labels = entity?.labels ?? {};
    const preferred = labels[language]?.value ?? labels.en?.value;
    if (preferred?.trim()) return preferred.trim();

    for (const label of Object.values(labels)) {
        if (label?.value?.trim()) return label.value.trim();
    }

    return undefined;
}

/** The article title this entity is linked to in the wanted edition, if it has one. */
export function sitelinkTitle(entity: WikidataEntity | undefined, language: string): string | undefined {
    const title = entity?.sitelinks?.[siteKey(language)]?.title?.trim();
    return title && title.length > 0 ? title : undefined;
}

/** Q-ids on the other end of an item-valued property, e.g. every performer of a song. */
export function claimedIds(entity: WikidataEntity | undefined, property: string): string[] {
    const claims = entity?.claims?.[property] ?? [];
    return claims
        .map(claim => (claim.mainsnak?.snaktype === 'value' ? claim.mainsnak.datavalue?.value?.id : undefined))
        .filter((id): id is string => id !== undefined);
}

/**
 * The prose out of an extract response, and nothing else.
 *
 * A page that does not exist is `undefined` rather than an error, because a
 * record with no article is the ordinary case and not a fault.
 */
export function extractOf(response: WikipediaExtractResponse): { title: string; text: string } | undefined {
    for (const page of response.query?.pages ?? []) {
        if (page.missing === true) continue;

        const text = page.extract?.trim();
        const title = page.title?.trim();
        if (text && title && text.length > 0) return { title, text };
    }

    return undefined;
}

/**
 * How short an article may be before it is not worth keeping.
 *
 * A stub reads "X is a song by Y." and stops, which the station already knows
 * from its own catalog: storing one costs a row and yields a claim that says
 * nothing. Low enough that a genuinely short article about an obscure record
 * still counts.
 */
export const MIN_ARTICLE_CHARS = 200;

/** An article as the thing a plugin hands over. `undefined` for prose too thin to bother with. */
export function asDocument(language: string, article: { title: string; text: string }, retrievedAt: string): SourceDocument | undefined {
    if (article.text.length < MIN_ARTICLE_CHARS) return undefined;

    return { url: articleUrl(language, article.title), title: article.title, text: article.text, retrievedAt };
}

/** A candidate song item, with everything the check below needs already read off it. */
export interface SongCandidate {
    id: string;
    label?: string;
    article?: string;
    performerIds: string[];
}

/** One candidate, flattened out of its entity. */
export function songCandidate(id: string, entity: WikidataEntity | undefined, language: string): SongCandidate {
    return {
        id,
        label: labelOf(entity, language),
        article: sitelinkTitle(entity, language),
        performerIds: claimedIds(entity, PROPERTY_PERFORMER),
    };
}

/**
 * Which searched item is really this song, out of what a name search returned.
 *
 * This is the one place in the plugin where a match is not an id lookup, and
 * the reason it is allowed to exist is that the rest of the record is
 * unreachable without it: a song's article is on a Wikidata item carrying a
 * WORK id, while what the catalog holds for a track is a RECORDING id, and the
 * two are not the same statement. A search is the only bridge.
 *
 * So the search is loose and the acceptance is strict. Both of these must hold:
 *
 * - the item's own label is the song's title, compared in {@link baseForm} so
 *   that a catalog full of `- Remastered 2016` and `(feat. …)` still matches
 *   the plain name an encyclopaedia files it under;
 * - one of the item's performers is the artist the catalog credits, compared
 *   the same way against that performer's own label.
 *
 * A near miss is refused rather than taken with a lower confidence. Nothing
 * downstream can tell a hedged article from a certain one, and the failure it
 * would cause is the station describing the wrong record in a voice that
 * sounds just as sure.
 */
export function chooseSong(
    candidates: SongCandidate[],
    performerLabels: Map<string, string>,
    title: string,
    artist: string,
): SongCandidate | undefined {
    const wantedTitle = baseForm(title);
    const wantedArtist = baseForm(artist);
    if (wantedTitle.length === 0 || wantedArtist.length === 0) return undefined;

    return candidates.find(candidate => {
        if (candidate.article === undefined || candidate.label === undefined) return false;
        if (baseForm(candidate.label) !== wantedTitle) return false;

        return candidate.performerIds.some(id => {
            const performer = performerLabels.get(id);
            return performer !== undefined && baseForm(performer) === wantedArtist;
        });
    });
}

/**
 * The search terms for a song, which are the title and the artist as written.
 *
 * Not normalized: this goes to a full-text search engine that does its own
 * stemming and folding, and stripping the punctuation out of `Mr. Brightside`
 * before handing it over only takes information away from it. Normalizing is
 * for the COMPARISON afterwards, which is a different question.
 *
 * The bracketed decorations do come off, because `(feat. Aerosmith)` and
 * `- Remastered 2016` are facts about a pressing rather than words in an
 * article, and they drag the search towards the wrong page.
 */
export function songSearchTerms(title: string, artist: string): string | undefined {
    const cleanTitle =
        title
            .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
            .split(/\s+[-–—]\s+/)[0]
            ?.trim() ?? '';
    if (normalize(cleanTitle).length === 0 || normalize(artist).length === 0) return undefined;

    return `${cleanTitle} ${artist}`.replace(/\s+/g, ' ').trim();
}
