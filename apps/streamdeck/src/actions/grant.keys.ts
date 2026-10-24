import { BADGE_MAX, grantSvg, svgDataUri } from '../display/key.image.js';
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
 * key sits faint.
 *
 * Every Grant key on the deck draws from one {@link WaitingPoller}, held while any of them shows, so a
 * deck without one asks the station nothing about requests.
 */
export class GrantKeys {
    private readonly painter = new FacePainter();
    /** The composed faces, one per count shown, since a face is redrawn on every reading and changes only with the count. */
    private readonly faces = new Map<string, string>();
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
        const view = grantView(this.reading);
        if (view.dim) this.log(view.refusal);
        if (this.busy || view.dim) {
            await face?.showAlert().catch(() => undefined);
            return;
        }
        const press = view.press;
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
        // The image alone: a title the operator typed in the app is left as it is.
        this.painter.paintAll({ image: this.faceFor(view.dim ? undefined : Math.min(view.count, BADGE_MAX + 1)) });
    }

    /** The face for a count, or the faint one for none. Counts past the badge's limit all draw "9+", so they share one. */
    private faceFor(count: number | undefined): string {
        const key = count === undefined ? 'dim' : String(count);
        let face = this.faces.get(key);
        if (face === undefined) {
            face = svgDataUri(count === undefined ? grantSvg({ dim: true }) : grantSvg({ dim: false, count }));
            this.faces.set(key, face);
        }
        return face;
    }
}
