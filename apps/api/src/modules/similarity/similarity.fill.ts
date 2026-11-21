import { Injectable } from 'injectkit';
import { SimilarityService } from './similarity.service.js';
import { SimilarityStoreRepository } from './similarity.store.repository.js';

/**
 * How many neighbours the fill asks for per artist: the most any caller asks for (the model's
 * similar-artists tool, at twelve), so every later question about a filled artist is answered from
 * the store rather than asking again for more.
 */
export const FILL_NEIGHBOURS = 12;

/** What one pass of the fill did. */
export interface SimilarityFillResult {
    /** Library artists taken off the work list. */
    scanned: number;
    /** Of those, how many were asked before the walk was told to stop. */
    asked: number;
}

/**
 * Asks the similarity sources, once, who resembles every library artist the store has not asked about.
 *
 * ## Why the store is filled ahead at all
 *
 * The store fills on demand, and that is still how it stays current: an answer a caller asks for is
 * written through and asked again once it is a week old. What on-demand cannot do is keep an answer a
 * source has stopped giving. A source whose key is refused (Last.fm without Pro, from 1 December 2026)
 * or that has gone away answers nothing from then on, and `SimilarityService.similarTo` keeps what it
 * said before only for artists somebody had already asked about. So this walks the library once while
 * every source still answers, and after that finds only the artists the library has gained since.
 *
 * ## Once per artist, never a refresh
 *
 * {@link SimilarityStoreRepository.libraryArtistsUnasked} owes an artist only until its first answer
 * of {@link FILL_NEIGHBOURS} or more is stored, whatever its age. Refreshing stays with the callers,
 * so a finished fill costs one query a run. An artist every source failed on is not stored, so it is
 * owed again on the next run, which is right for an outage and bounded by the run budget for anything
 * longer.
 */
@Injectable()
export class SimilarityFill {
    constructor(
        private readonly similarity: SimilarityService,
        private readonly store: SimilarityStoreRepository,
    ) {}

    /**
     * Asks about up to `limit` library artists, most played first, stopping between artists when
     * `stop` aborts.
     */
    async fillPending(limit: number, stop?: AbortSignal): Promise<SimilarityFillResult> {
        if (!this.similarity.hasSimilarity()) return { scanned: 0, asked: 0 };

        const owed = await this.store.libraryArtistsUnasked(limit, FILL_NEIGHBOURS);
        let asked = 0;
        for (const artist of owed) {
            if (stop?.aborted === true) break;
            await this.similarity.similarTo({ name: artist.name }, FILL_NEIGHBOURS);
            asked += 1;
        }

        return { scanned: owed.length, asked };
    }
}
