import { svgDataUri, voteSvg } from '../display/key.image.js';
import type { Reading, StatusPoller } from '../station/status.poller.js';
import type { RatingStore } from '../station/track.rating.js';
import { runCommand, type Log } from './command.outcome.js';
import { StationKeys } from './station.keys.js';
import { rateableTrack, voteView, type Vote } from './vote.reading.js';

/** The part of the store a key uses: what is known, going to find out, and saying what it thinks. */
export type Ratings = Pick<RatingStore, 'peek' | 'load' | 'rate' | 'subscribe'>;

/**
 * Like, or Dislike: one opinion about the record on air, written straight to the catalog.
 *
 * The same write the console's rating control sends from the running order
 * (`apps/web/src/components/desk/desk.page.tsx`), so the station alone decides who may form the
 * station's opinion, as it does for Skip and Stop. A key issued Read only reads the rating and is
 * refused the write, which is a different sentence from Skip's and is said here.
 *
 * A press on a lit key writes `neutral`. The console reaches that through a segment of its own,
 * because an operator should be able to see the middle they started from; a deck has no middle to
 * see and each key shows its own state instead, so pressing the lit one back off is both the
 * ordinary toggle and the only way to withdraw an opinion without a third key.
 *
 * The write does NOT go through the poller's `command`: that is for the verbs that answer with a
 * transport reading and are worth looking again after. A rating changes nothing about what is on
 * air, and the station answers the write with the record as it now stands, so the key lights from
 * the answer and the station is asked nothing more.
 */
export class VoteKeys extends StationKeys {
    private readonly faces = new Map<string, string>();
    private busy = false;
    private unwatch?: () => void;

    constructor(
        private readonly vote: Vote,
        private readonly ratings: Ratings,
        poller: Pick<StatusPoller, 'acquire' | 'subscribe'>,
        private readonly log: Log,
        private readonly skull?: string,
    ) {
        super(poller);
    }

    async press(id: string): Promise<void> {
        const face = this.painter.get(id);
        const press = this.view().press;
        if (this.busy || press === undefined) {
            await face?.showAlert().catch(() => undefined);
            return;
        }
        this.busy = true;
        try {
            await runCommand(face, () => this.ratings.rate(press.trackId, press.rating), this.log, {
                forbidden: 'The station would not let this key rate a record. Voting needs a key with Read and manage, issued by an admin.',
            });
        } finally {
            this.busy = false;
        }
    }

    protected override onHold(): void {
        this.unwatch = this.ratings.subscribe(() => this.render());
    }

    protected override onRelease(): void {
        this.unwatch?.();
        this.unwatch = undefined;
    }

    /**
     * A reading arrived: go and find out what the station thinks of what it says is on air.
     *
     * Once per reading rather than once per redraw, and only for a record nothing is known about —
     * the store shares one request between the two keys and remembers whatever came back, so an
     * ordinary record costs one request when it starts and none for the rest of it.
     */
    protected override onReading(reading: Reading): void {
        const trackId = rateableTrack(reading);
        if (trackId === undefined || this.ratings.peek(trackId) !== undefined) return;
        void this.ratings.load(trackId).then(() => this.render());
    }

    protected render(): void {
        const view = this.view();
        this.painter.paintAll({ image: this.faceFor(view.lit, view.dim), title: view.title });
    }

    /**
     * The composed face, remembered.
     *
     * A key has four of them at most and each carries the skull's bytes, so composing one on every
     * reading would be base64-encoding fifty kilobytes twice a second to hand the painter something
     * it has already sent. The painter drops an identical frame, so this saves the encoding rather
     * than the traffic.
     */
    private faceFor(lit: boolean, dim: boolean): string {
        const key = `${lit}|${dim}`;
        let face = this.faces.get(key);
        if (face === undefined) {
            face = svgDataUri(voteSvg({ vote: this.vote, lit, dim, ...(this.skull === undefined ? {} : { skull: this.skull }) }));
            this.faces.set(key, face);
        }
        return face;
    }

    private view() {
        const trackId = rateableTrack(this.reading);
        return voteView(this.reading, trackId === undefined ? undefined : this.ratings.peek(trackId), this.vote);
    }
}
