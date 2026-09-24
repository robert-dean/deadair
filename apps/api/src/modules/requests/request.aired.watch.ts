import { Container, Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { Rundown, type RundownItem } from '#modules/playout/rundown.js';
import { isRenderItem } from '#modules/render/segment.source.js';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { RequestDesk } from './request.desk.js';

/**
 * Marks a request heard when its record goes to air, and tells whoever asked.
 *
 * Off `Rundown.onAired`, the edge play history hangs off, and recognised by the record rather than by
 * the order item: the rundown's items do not carry the request id, and a record somebody asked for is
 * that record however it got into the order. The listener hands the work to a scope of its own and
 * returns, as `onAired` requires.
 */
@Injectable()
export class RequestAiredWatch {
    private unsubscribe?: () => void;

    constructor(
        private readonly container: Container,
        private readonly rundown: Rundown,
        private readonly logger: Logger,
    ) {}

    start(): void {
        if (this.unsubscribe !== undefined) return;
        this.unsubscribe = this.rundown.onAired(item => this.aired(item));
    }

    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    private aired(item: RundownItem): void {
        const trackId = item.trackId;
        if (trackId === undefined || isRenderItem(item)) return;

        void inScope(this.container, async scope => await scope.get(RequestDesk).aired(trackId)).catch(error =>
            this.logger.warn(`requests: could not mark a request heard (${errorText(error)})`),
        );
    }
}
