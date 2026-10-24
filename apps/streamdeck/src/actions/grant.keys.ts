import { grantSvg, svgDataUri } from '../display/key.image.js';
import type { WaitingPoller, WaitingReading } from '../station/waiting.requests.js';
import { runCommand, type Log } from './command.outcome.js';
import { FacePainter, type KeyFace } from './key.face.js';
import { grantView } from './grant.reading.js';

/**
 * Grant: let through the request that has waited longest for an operator.
 *
 * `POST /requests/{id}/grant`, the console's own, so the station decides who may: `platform.manage`,
 * which a key issued Read only does not carry, and which says so in the log. Only of use while the
 * station holds every request for approval (`requests.approval`); otherwise nothing ever waits and the
 * key sits faint saying so.
 *
 * Every Grant key on the deck draws from one {@link WaitingPoller}, held while any of them shows, so a
 * deck without one asks the station nothing about requests.
 */
export class GrantKeys {
    private readonly painter = new FacePainter();
    private readonly faces = { live: svgDataUri(grantSvg({ dim: false })), dim: svgDataUri(grantSvg({ dim: true })) };
    private reading: WaitingReading = { stale: false };
    private busy = false;
    private release?: () => void;
    private unsubscribe?: () => void;

    constructor(
        private readonly line: Pick<WaitingPoller, 'acquire' | 'subscribe' | 'grant'>,
        private readonly log: Log,
    ) {}

    appear(face: KeyFace): void {
        this.painter.add(face);
        if (this.painter.size > 1) {
            this.render();
            return;
        }
        this.release = this.line.acquire();
        this.unsubscribe = this.line.subscribe(reading => {
            this.reading = reading;
            this.render();
        });
    }

    disappear(id: string): void {
        this.painter.remove(id);
        if (this.painter.size > 0) return;
        this.unsubscribe?.();
        this.release?.();
        this.unsubscribe = undefined;
        this.release = undefined;
    }

    async press(id: string): Promise<void> {
        const face = this.painter.get(id);
        const press = grantView(this.reading).press;
        if (this.busy || press === undefined) {
            await face?.showAlert().catch(() => undefined);
            return;
        }
        this.busy = true;
        try {
            await runCommand(face, () => this.line.grant(press.id), this.log, {
                forbidden: 'The station would not let this key grant a request. Granting needs a key with Read and manage, issued by an admin.',
                conflict: `“${press.title}” was no longer waiting: somebody decided it first, or the station let it go.`,
            });
        } finally {
            this.busy = false;
        }
    }

    private render(): void {
        const view = grantView(this.reading);
        this.painter.paintAll({ image: view.dim ? this.faces.dim : this.faces.live, title: view.title });
    }
}
