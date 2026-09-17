import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { AfterCommit } from '#modules/data/after.commit.js';
import { StationBus } from '#modules/shared/station.bus.js';
import { errorText } from '#modules/shared/error.text.js';
import { Rating } from './types/catalog.types.js';

/**
 * Tells the station when an operator has forbidden something, once the write is durable.
 *
 * A dislike is an instruction rather than a preference, and until this existed it reached only the
 * two places that BUILD a running order — the catalog draw's own SQL and `PickResolver` — so an
 * order already on air went on playing what it had been vetted for minutes earlier. The subscriber
 * that fixes that is `DislikeVeto`, in `director`; `catalog` is registered first, so the two meet on
 * `StationBus` rather than by import. See that file and `station.bus.ts`.
 *
 * ## Why all three services share one class
 *
 * `rateArtist`, `rateAlbum` and `rateTrack` are the same hook three times, and the hook has two
 * pieces of care in it — the `afterCommit` deferral and the try/catch — that are exactly the kind
 * of thing that survives in two copies and rots in the third. One method, three call sites.
 *
 * ## Why it is deferred rather than published inline
 *
 * `publishConfiguredAfterCommit`'s reason, and the same failure: the subscriber asks
 * `CandidatesRepository.ratingsFor` what the station now thinks of a batch of records, on its own
 * pooled connection, and inside this request's transaction that read answers with the row as it
 * stood BEFORE the operator's write. The veto would then find nothing to do and the record would
 * air anyway — the original bug, with an extra mechanism in front of it.
 *
 * `StationBus.publish` never throws — every subscriber's own throw is caught and logged inside it —
 * but the try/catch stays for `PluginsService`'s reason: rating something must not fail on account
 * of anything the station does with the news.
 */
@Injectable()
export class RatingAnnouncer {
    constructor(
        private readonly afterCommit: AfterCommit,
        private readonly bus: StationBus,
        private readonly logger: Logger,
    ) {}

    /**
     * Say that an operator rated something, if the rating is one the station has to act on.
     *
     * Only a dislike is published, which is the filter `station.bus.ts` argues belongs on this side:
     * a like changes how often a record is drawn and `weightOf` reads that for itself on the next
     * draw, so there is nothing for a running order to do about one. Withdrawing an opinion is the
     * same — `neutral` cannot put back a record already spliced out, and re-drawing it is what the
     * next refill does anyway.
     *
     * @param name - What the operator rated, for the sentence the feed will carry. Passed in
     *   because the caller has the row loaded and the subscriber would otherwise read it back.
     */
    announce(level: 'artist' | 'album' | 'track', id: string, name: string, rating: Rating): void {
        if (rating !== 'disliked') return;

        this.afterCommit.add(async () => {
            try {
                this.bus.publish('catalog.disliked', { level, id, name });
            } catch (error) {
                this.logger.warn(`catalog: could not publish catalog.disliked for ${level} ${id} (${errorText(error)})`, { level, id });
            }
        });
    }
}
