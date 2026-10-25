import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { normalizeKey } from '#modules/catalog/catalog.keys.js';
import { errorText } from '#modules/shared/error.text.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { SimilarityService, STORED_ANSWER_TTL_MS } from '#modules/similarity/similarity.service.js';
import { SimilarityStoreRepository } from '#modules/similarity/similarity.store.repository.js';
import { BriefArtists, excludedByBrief, namedInBrief, orderByNeglect, type BriefArtist } from './brief.artists.js';
import { PlayHistoryRepository } from './play.history.repository.js';

/**
 * Everyone a brief reaches: the acts it names, including ones the library has never held, and a few
 * of the artists who sound like them, with the similarity store filled for them as it goes.
 *
 * ## The failure this exists for
 *
 * {@link BriefArtists} finds the acts a brief names among the LIBRARY's artists, so an act the library
 * has never held is invisible to it. Measured on the live station, 2026-10-25: The Church's brief names
 * Mayhem, Darkthrone and Emperor and the library holds no record by any of them, so nothing that reads
 * the brief's acts ever reached them. And the acts it did find were asked of the providers for their
 * three best-known records on every refill, all three inside the two-day repeat window and refused.
 *
 * ## How an act the library lacks is found
 *
 * Not by parsing the brief, for the reason `BriefArtists` gives. A similarity source names neighbours of
 * the acts the library does hold, and a neighbour the brief names as whole words, and does not only rule
 * out, is a brief act ({@link namedInBrief}). Black metal acts are each other's neighbours, so Behemoth
 * and Bathory lead to the other three. An act no neighbour list reaches is still missed.
 *
 * ## The fill is capped, and it is the only fill nobody asked for first
 *
 * Every other answer in the store was a question some caller asked anyway. This one asks ahead: who
 * resembles each act, and up to {@link RECORDS_PER_ACT} records by each act and {@link RECORDS_PER_NEIGHBOUR}
 * by each neighbour shown. At most {@link MAX_ASKS_PER_RUN} questions per call, in that order of priority,
 * so a long brief fills over a few refills rather than spending the providers' rate limits in one; an
 * answer already stored and fresh costs nothing, which is what makes every later call cheap.
 *
 * ## Leads, never rules
 *
 * Names, as everything from `BriefArtists` is. `PickResolver` judges every record that comes of them. A
 * failure anywhere answers with the library's acts alone, which is what callers had before this.
 */

/** The records asked for per brief act: deep enough to outlast a repeat window on a narrow brief. */
export const RECORDS_PER_ACT = 25;

/** The records asked for per neighbour: a neighbour is a lead toward a brief, not the brief. */
export const RECORDS_PER_NEIGHBOUR = 10;

/** How many neighbours are asked for per act. Merged across sources, best first within each. */
export const NEIGHBOURS_ASKED = 10;

/** How many of each act's neighbours are kept as leads. The closest few; the tail drifts. */
export const NEIGHBOURS_KEPT = 3;

/**
 * The most questions one call puts to the providers. Each is one call per source at most, bounded by
 * the service's own timeout; about a dozen seconds on the live station when every one is asked.
 */
export const MAX_ASKS_PER_RUN = 16;

/** One act a brief names, and whether the library holds anything by it. */
export interface BriefAct extends BriefArtist {
    /** False for an act found among a library act's neighbours. */
    inLibrary: boolean;
}

/** One artist who sounds like a brief act, and which act led to them. */
export interface BriefNeighbour {
    name: string;
    artistKey: string;
    /** The `artistKey` of the brief act this is a neighbour of. */
    of: string;
}

/** Everyone a brief reaches. */
export interface BriefReach {
    /** The acts the brief names, longest off air first. */
    acts: BriefAct[];
    /** A few neighbours per act, closest first, none of them an act or one the brief rules out. */
    neighbours: BriefNeighbour[];
}

const NOBODY: BriefReach = { acts: [], neighbours: [] };

@Injectable()
export class BriefActs {
    constructor(
        private readonly briefArtists: BriefArtists,
        private readonly similarity: SimilarityService,
        private readonly store: SimilarityStoreRepository,
        private readonly history: PlayHistoryRepository,
        private readonly identity: StationIdentity,
        private readonly logger: Logger,
    ) {}

    /**
     * Who `brief` reaches, filling the store for them within {@link MAX_ASKS_PER_RUN}.
     *
     * @param signal - The calling job's. Read between questions, so a stopped refill stops asking.
     */
    async reach(brief: string | undefined, signal?: AbortSignal): Promise<BriefReach> {
        const library = await this.briefArtists.named(brief);
        if (library.length === 0) return NOBODY;

        const asLibrary = library.map(act => ({ ...act, inLibrary: true }));
        if (!this.similarity.hasSimilarity()) return { acts: asLibrary, neighbours: [] };

        try {
            return await this.fill(brief!.trim(), asLibrary, signal);
        } catch (error) {
            this.logger.warn(`director: could not reach past the library for the brief's acts; using the library's alone (${errorText(error)})`);
            return { acts: asLibrary, neighbours: [] };
        }
    }

    private async fill(brief: string, library: BriefAct[], signal: AbortSignal | undefined): Promise<BriefReach> {
        let asks = 0;
        let recordAsks = 0;
        const mayAsk = (): boolean => asks < MAX_ASKS_PER_RUN && signal?.aborted !== true;

        // Who resembles each library act, first: it is what finds the acts the library lacks.
        const libraryKeys = library.map(act => act.artistKey);
        const knownNeighbours = await this.store.askedWithin('artists', libraryKeys, STORED_ANSWER_TTL_MS, NEIGHBOURS_ASKED);
        for (const act of library) {
            if (!mayAsk()) break;
            if (knownNeighbours.has(act.artistKey)) continue;
            asks += 1;
            await this.similarity.similarTo({ name: act.name }, NEIGHBOURS_ASKED);
        }

        const stored = await this.store.neighboursFor(libraryKeys);
        const named = new Set(libraryKeys);
        const offered = [...new Map([...stored.values()].flat().map(neighbour => [normalizeKey(neighbour.name), neighbour.name])).values()];

        // A neighbour the brief names is an act, however the library came to lack them.
        const foundNames = namedInBrief(brief, offered).filter(name => !named.has(normalizeKey(name)));
        const foundKeys = foundNames.map(name => normalizeKey(name));
        for (const key of foundKeys) named.add(key);
        const lastAired = await this.history.lastAiredByArtist(foundKeys, this.identity.stationKey);
        const found: BriefAct[] = foundNames.map((name, index) => {
            const at = lastAired.get(foundKeys[index]!);
            return { name, artistKey: foundKeys[index]!, inLibrary: false, ...(at === undefined ? {} : { lastAiredAt: at }) };
        });
        const acts = orderByNeglect([...library, ...found], brief);

        // The closest few of each act's neighbours that are not acts and that the brief does not rule out.
        const ruledOut = excludedByBrief(brief, offered);
        const neighbours: BriefNeighbour[] = [];
        const taken = new Set(named);
        for (const act of acts) {
            let kept = 0;
            for (const neighbour of stored.get(act.artistKey) ?? []) {
                if (kept >= NEIGHBOURS_KEPT) break;
                const key = normalizeKey(neighbour.name);
                if (key.length === 0 || taken.has(key) || ruledOut.has(neighbour.name)) continue;
                taken.add(key);
                neighbours.push({ name: neighbour.name, artistKey: key, of: act.artistKey });
                kept += 1;
            }
        }

        // Then the records: every act's, then the neighbours', each only when not already stored deep enough.
        const [actsHeld, neighboursHeld] = await Promise.all([
            this.store.askedWithin(
                'records',
                acts.map(act => act.artistKey),
                STORED_ANSWER_TTL_MS,
                RECORDS_PER_ACT,
            ),
            this.store.askedWithin(
                'records',
                neighbours.map(neighbour => neighbour.artistKey),
                STORED_ANSWER_TTL_MS,
                RECORDS_PER_NEIGHBOUR,
            ),
        ]);
        const owed = [
            ...acts.filter(act => !actsHeld.has(act.artistKey)).map(act => ({ name: act.name, limit: RECORDS_PER_ACT })),
            ...neighbours
                .filter(neighbour => !neighboursHeld.has(neighbour.artistKey))
                .map(neighbour => ({ name: neighbour.name, limit: RECORDS_PER_NEIGHBOUR })),
        ];
        for (const artist of owed) {
            if (!mayAsk()) break;
            asks += 1;
            recordAsks += 1;
            await this.similarity.topTracks({ name: artist.name }, artist.limit);
        }

        if (asks > 0 || found.length > 0) {
            this.logger.info("director: reached past the library for the brief's acts", {
                acts: acts.length,
                notInLibrary: found.map(act => act.name),
                neighbours: neighbours.length,
                asked: asks,
                // Whatever is left is asked on the next call, so this says how far from full the store is.
                stillOwed: owed.length - recordAsks,
            });
        }
        return { acts, neighbours };
    }
}
