import { Container, Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { TrackAudioService } from '#modules/playout/audio/track.audio.service.js';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { RequestDesk } from './request.desk.js';

/**
 * Offers the waiting requests to the running order again the moment a record's audio arrives.
 *
 * A request whose record is not on this machine yet waits `pending` while it is fetched, and until
 * this the next minute's `requests.tick` was what noticed the fetch had finished. Where a request
 * lands is decided by the order as it stands when it is placed, and the order moves on at every
 * boundary, so a fetch that finished just before a hand-over could cost the request a whole record.
 *
 * Every pending request is offered rather than the one for this record: there are a handful at most,
 * the desk asks again whether each one's bytes are here, and the record a request resolves to is not
 * known without resolving it. The tick stays, for everything else a request waits on and for letting
 * go of the ones that waited too long. Off `TrackAudioService.onKept`, which wants its listeners to
 * return at once, so the work goes to a scope of its own.
 */
@Injectable()
export class RequestAudioWatch {
    private unsubscribe?: () => void;

    constructor(
        private readonly container: Container,
        private readonly audio: TrackAudioService,
        private readonly logger: Logger,
    ) {}

    start(): void {
        if (this.unsubscribe !== undefined) return;
        this.unsubscribe = this.audio.onKept(() => this.kept());
    }

    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    private kept(): void {
        void inScope(this.container, async scope => {
            const placed = await scope.get(RequestDesk).placePending();
            if (placed > 0) this.logger.info('requests: placed waiting requests as their audio arrived', { placed });
        }).catch(error => this.logger.warn(`requests: could not place waiting requests as audio arrived (${errorText(error)})`));
    }
}
