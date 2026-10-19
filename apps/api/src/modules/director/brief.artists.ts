import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { Logger } from '@maroonedsoftware/logger';
import { ArtistsRepository } from '#modules/catalog/artists.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { errorText } from '#modules/shared/error.text.js';
import { PlayHistoryRepository } from './play.history.repository.js';

/**
 * The artists a brief names, the ones off air longest first.
 *
 * ## The failure this exists for
 *
 * A brief that names its acts is a list, and a model works down a list in the order it was written.
 * Measured on the live station, 2026-10-11: The Boneyard's brief names twenty-four acts, and three
 * refills searched the first five, the first five again, and the first seventeen before running out
 * of time. Kreator, Sodom, Cannibal Corpse, Behemoth, Mastodon and Queensrÿche were never searched
 * at all, and six acts took 39 of the show's 86 plays. Every one of the twenty-four was in the
 * library. Nothing was wrong with the brief; the station only ever read the top of it.
 *
 * So the names are read out of the brief and ordered by the history instead, and whatever programmes
 * the hour starts from the act it has neglected longest.
 *
 * ## Library artists, found in the brief, rather than the brief parsed
 *
 * A brief is prose ("Thrash and groove: Metallica, Megadeth, Slayer"), and splitting it on commas
 * and colons is a parser for one operator's punctuation. Asking which artists the LIBRARY holds whose
 * names appear in it is a closed question with no grammar in it, and an act the library has never
 * held is one nothing downstream could look up by name anyway. See {@link ArtistsRepository.namedIn}
 * for what that match does and does not tell apart.
 *
 * ## An act the brief rules out is not a lead
 *
 * "Britpop, but no Oasis" names Oasis, and the library match finds it, so for as long as this read
 * only names it handed Oasis to every caller as an act to programme — {@link BriefArtistSetGenerator}
 * then aired its records, neglected longest first, for up to its share of every batch, with no model
 * in the loop to read the "no". {@link excludedByBrief} drops an act whose every mention sits in a
 * negated stretch of the brief. The model still reads the brief's own prose and the "no" in it.
 *
 * ## Leads, never rules
 *
 * Nothing here decides what airs. Every caller hands on names, and `PickResolver` still judges each
 * record against the dislikes, the repeat window and the cooldown. A read that fails answers with
 * nothing, which leaves every caller doing what it did before this existed.
 */

/** One act a brief names, with when it last aired here. */
export interface BriefArtist {
    /** As the library spells it, which is what a provider lookup wants. */
    name: string;
    artistKey: string;
    /** Absent when the history holds no airing, inside its retention. */
    lastAiredAt?: DateTime;
}

@Injectable()
export class BriefArtists {
    constructor(
        private readonly artists: ArtistsRepository,
        private readonly history: PlayHistoryRepository,
        private readonly identity: StationIdentity,
        private readonly logger: Logger,
    ) {}

    /**
     * The acts `brief` names, longest off air first. An act with no airing comes before every act
     * with one; ties keep the order the brief named them in, so the operator's own order still says
     * something.
     */
    async named(brief: string | undefined): Promise<BriefArtist[]> {
        const text = (brief ?? '').trim();
        if (text.length === 0) return [];

        try {
            const named = await this.artists.namedIn(text);
            const excluded = excludedByBrief(
                text,
                named.map(artist => artist.name),
            );
            if (excluded.size > 0) this.logger.debug(`director: the brief rules out ${[...excluded].join(', ')}; not leading with them`);
            const found = named.filter(artist => !excluded.has(artist.name));
            if (found.length === 0) return [];

            const unique = [...new Map(found.map(artist => [artist.artistKey, artist])).values()];
            const lastAired = await this.history.lastAiredByArtist(
                unique.map(artist => artist.artistKey),
                this.identity.stationKey,
            );

            return orderByNeglect(
                unique.map(artist => {
                    const at = lastAired.get(artist.artistKey);
                    return { name: artist.name, artistKey: artist.artistKey, ...(at === undefined ? {} : { lastAiredAt: at }) };
                }),
                text,
            );
        } catch (error) {
            this.logger.warn(`director: could not read which artists the brief names; programming without them (${errorText(error)})`);
            return [];
        }
    }
}

/**
 * Never aired first, then oldest airing first, ties in the order the brief names them.
 *
 * Exported for the tests, since it is the whole of the decision and needs no database to check.
 */
export function orderByNeglect(artists: readonly BriefArtist[], brief: string): BriefArtist[] {
    const position = (artist: BriefArtist): number => {
        const at = brief.indexOf(artist.name);
        return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    };
    const aired = (artist: BriefArtist): number => artist.lastAiredAt?.toMillis() ?? Number.NEGATIVE_INFINITY;

    return [...artists].sort((left, right) => aired(left) - aired(right) || position(left) - position(right));
}

/**
 * The acts in `names` that `brief` names only to rule out.
 *
 * A negating word ("no", "not", "never", "nor", "neither", "without", "except", "excluding", "avoid",
 * "anything but", "other than") opens a negated stretch, which runs to the end of its sentence, to a
 * colon, or to a "but" that turns back ("Not Heart Of Glass, but Heart"). So "No classic rock, Queen
 * or Kiss." rules out both acts, and "Bluegrass, not country: Bill Monroe, Flatt & Scruggs." rules out
 * neither, because the colon is where the list the operator wants begins. A colon straight after the
 * negating word ("Avoid: Oasis") is the list it opens instead, and does not end it.
 *
 * **A negating word inside one of the names is not one.** "No Doubt" is a band, and a brief listing it
 * would otherwise rule out every act after it in the sentence; a full stop inside a name ("R.E.M.") is
 * likewise not the end of one. An act is dropped only when EVERY mention of it is negated, so a brief
 * that rules out a ballad by an act and asks for the act elsewhere still leads with it. Like
 * {@link ArtistsRepository.namedIn}, the match is case-sensitive.
 *
 * Exported for the tests, since it is the whole of the decision and needs no database to check.
 */
export function excludedByBrief(brief: string, names: readonly string[]): Set<string> {
    const mentions = names.flatMap(name => mentionsOf(brief, name).map(mention => ({ name, ...mention })));
    const inAName = (at: number) => mentions.some(mention => at >= mention.start && at < mention.end);
    const stretches = negatedStretches(brief, inAName);
    const negated = (mention: { start: number; end: number }) =>
        stretches.some(stretch => mention.start >= stretch.start && mention.end <= stretch.end);

    const excluded = new Set<string>();
    for (const name of names) {
        const own = mentions.filter(mention => mention.name === name);
        if (own.length > 0 && own.every(negated)) excluded.add(name);
    }
    return excluded;
}

const NOT_A_WORD_BEFORE = "(?<![\\p{L}\\p{N}'’])";
const NOT_A_WORD_AFTER = "(?![\\p{L}\\p{N}'’])";

/** "not only" and "not just" are a list getting longer, not one getting shorter. */
const NEGATING = new RegExp(
    `${NOT_A_WORD_BEFORE}(?:no|not(?!\\s+(?:only|just)${NOT_A_WORD_AFTER})|never|nor|neither|without|except|excluding|avoid|avoiding|(?:anything|everything)\\s+(?:but|except)|other\\s+than)${NOT_A_WORD_AFTER}`,
    'giu',
);
const TURNING = new RegExp(`${NOT_A_WORD_BEFORE}but${NOT_A_WORD_AFTER}`, 'giu');
const CLAUSE_END = /[.;:!?\n]/g;

function negatedStretches(brief: string, inAName: (at: number) => boolean): { start: number; end: number }[] {
    const stretches: { start: number; end: number }[] = [];
    let from = 0;
    while (from < brief.length) {
        NEGATING.lastIndex = from;
        const negation = NEGATING.exec(brief);
        if (negation === null) break;
        const opened = negation.index + negation[0].length;
        if (inAName(negation.index)) {
            from = opened;
            continue;
        }
        const end = Math.min(nextClauseEnd(brief, opened, inAName), nextOutside(TURNING, brief, opened, inAName));
        stretches.push({ start: negation.index, end });
        from = Math.max(end, opened);
    }
    return stretches;
}

function nextClauseEnd(brief: string, opened: number, inAName: (at: number) => boolean): number {
    CLAUSE_END.lastIndex = opened;
    for (let end = CLAUSE_END.exec(brief); end !== null; end = CLAUSE_END.exec(brief)) {
        if (inAName(end.index)) continue;
        if (end[0] === ':' && brief.slice(opened, end.index).trim().length === 0) continue;
        return end.index;
    }
    return brief.length;
}

function nextOutside(pattern: RegExp, brief: string, from: number, inAName: (at: number) => boolean): number {
    pattern.lastIndex = from;
    for (let found = pattern.exec(brief); found !== null; found = pattern.exec(brief)) {
        if (!inAName(found.index)) return found.index;
    }
    return brief.length;
}

/** Where `name` appears in `brief` as whole words, its own whitespace matching any run of it. */
function mentionsOf(brief: string, name: string): { start: number; end: number }[] {
    const words = name
        .trim()
        .split(/\s+/u)
        .filter(word => word.length > 0)
        .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (words.length === 0) return [];
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${words.join('\\s+')}(?![\\p{L}\\p{N}])`, 'gu');
    return [...brief.matchAll(pattern)].map(match => ({ start: match.index, end: match.index + match[0].length }));
}
