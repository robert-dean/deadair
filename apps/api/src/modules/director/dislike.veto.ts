import { Container, Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { StationBus } from '#modules/shared/station.bus.js';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { DirectorConsoleService } from './director.console.service.js';

/**
 * An operator forbade something, so the running order already on air has to lose it.
 *
 * ## The bug this exists for
 *
 * A dislike is an instruction no lineup may turn off, and it was applied at exactly two moments:
 * when a generator draws candidates (`rejectDisliked` inside `applyRules`) and when a pick becomes a
 * track (`PickResolver.resolve`, or `vet` for a playlist put on air). Both of those BUILD a running
 * order. Nothing re-applied it to one already built — and a running order is a stored list of items
 * being walked by state, with `StationLineup.nextPlanned` reading no rating at all.
 *
 * Measured on the live station on 17 September: the station went on air at 07:32:01 from an imported
 * playlist, so every record on it was vetted at that instant; the operator disliked an artist at
 * 08:23:52; two of that artist's records aired at 09:10 and 10:44, and two more were still `planned`
 * in the order hours later. Nothing was broken — the rating was written, and every later DRAW would
 * have honoured it. The order simply never asked again.
 *
 * ## Why it is a bus subscriber
 *
 * `CatalogModule` is registered before `DirectorModule`, so `ArtistsService` calling the director
 * would invert the module edge. `StationBus` exists for that one thing and says so, and this is the
 * shape its `plugin.configured` arm already has: the catalog publishes a fact and stops there.
 *
 * Shaped on `EnrichmentRefresh` down to the singleton. It holds the subscription, and an event can
 * arrive with no request in flight to borrow a connection from — `DirectorConsoleService` is scoped
 * — so each event opens its own scope rather than capturing one at construction.
 *
 * ## What it deliberately does not decide
 *
 * Which records are forbidden, whether anything is on air, and what to do about the one playing.
 * All three are programming decisions and all three belong to `DirectorConsoleService.vetoDisliked`,
 * which owns every other edit to the running order. This knows only that a rating was saved.
 */
@Injectable()
export class DislikeVeto {
    private unsubscribe?: () => void;

    constructor(
        // The ROOT container, for `scoped.work.ts`'s reason: this class's own dependencies come from
        // the root, and opening a scope off anything else would make it the child of one that may
        // already be gone.
        private readonly container: Container,
        private readonly bus: StationBus,
        private readonly logger: Logger,
    ) {}

    /** Begin listening. Idempotent. */
    start(): void {
        if (this.unsubscribe !== undefined) return;

        this.unsubscribe = this.bus.subscribe('catalog.disliked', event => this.veto(event.name));
    }

    /** Stop listening. */
    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    /**
     * Nothing is awaited by the caller: this runs in the publisher's own stack frame, which by then
     * is an `AfterCommit` task with nobody to hand a rejection to. The `catch` is the same shape
     * every producerless subscriber here uses — and it matters more than usual, because the thing
     * that would otherwise carry the throw is an operator's rating, which has already succeeded.
     */
    private veto(forbidden: string): void {
        void inScope(this.container, async scope => {
            await scope.get(DirectorConsoleService).vetoDisliked(forbidden);
        }).catch(error => {
            this.logger.warn(`director: could not take forbidden records out of the running order (${errorText(error)})`, { forbidden });
        });
    }
}
