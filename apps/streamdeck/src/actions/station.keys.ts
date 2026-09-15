import type { Reading, StatusPoller } from '../station/status.poller.js';
import { FacePainter, type KeyFace } from './key.face.js';

/**
 * Every key of one action, and its hold on the poller.
 *
 * The first key to appear takes hold of the poller and subscribes; the last to go lets go. Each
 * action decides what its keys show in `render`, which runs on every reading and whenever the action
 * itself changes something (a Stop arming, a bar moving).
 */
export abstract class StationKeys {
    protected readonly painter = new FacePainter();
    protected reading: Reading = { stale: false };
    private release?: () => void;
    private unsubscribe?: () => void;

    constructor(protected readonly poller: Pick<StatusPoller, 'acquire' | 'subscribe'>) {}

    appear(face: KeyFace): void {
        this.painter.add(face);
        if (this.painter.size === 1) {
            this.release = this.poller.acquire();
            this.onHold();
            // Subscribing hands over the current reading at once, so a key never shows the manifest's
            // picture for a moment when the plugin already knows the answer.
            this.unsubscribe = this.poller.subscribe(reading => {
                this.reading = reading;
                this.onReading(reading);
                this.render();
            });
        } else {
            this.render();
        }
    }

    disappear(id: string): void {
        this.painter.remove(id);
        this.onDisappear(id);
        if (this.painter.size > 0) return;
        this.unsubscribe?.();
        this.release?.();
        this.unsubscribe = undefined;
        this.release = undefined;
        this.onRelease();
    }

    protected abstract render(): void;

    /** The first key appeared. */
    protected onHold(): void {}

    /** The last key went. */
    protected onRelease(): void {}

    /** One key went, before the hold is let go if it was the last. */
    protected onDisappear(_id: string): void {}

    /** A reading arrived, before it is drawn. */
    protected onReading(_reading: Reading): void {}
}
