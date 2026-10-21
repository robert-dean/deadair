import { describe } from '../station/connection.failure.js';
import type { StatusPoller } from '../station/status.poller.js';
import { readTransport } from '../station/transport.reading.js';
import { runCommand, type Log } from './command.outcome.js';
import { StationKeys } from './station.keys.js';

/**
 * Skip: ends the record or break on air and plays the next.
 *
 * The same request the console's Skip sends and the desktop app's media key sends, so the three
 * cannot disagree about who may skip: the station decides, and a key issued Read only is refused
 * there and says so here. The console DISABLES Skip when there is nothing to end (no stream, or
 * nothing on it); a key cannot be disabled, so it refuses the press instead and asks nothing.
 *
 * The press names the item the key last read as on air, as the console's does, so the station
 * refuses it (409) when that record has ended in the five seconds since rather than cutting the next.
 */
export class SkipKeys extends StationKeys {
    private busy = false;

    constructor(
        private readonly station: Pick<StatusPoller, 'acquire' | 'subscribe' | 'command'>,
        private readonly log: Log,
    ) {
        super(station);
    }

    async press(id: string): Promise<void> {
        const face = this.painter.get(id);
        const status = this.reading.status;
        if (this.busy || status === undefined || this.reading.stale || !readTransport(status).canSkip) {
            await face?.showAlert().catch(() => undefined);
            return;
        }
        this.busy = true;
        try {
            // Named, so a press read off a record that has since ended is refused rather than cutting
            // the one after it: the deck reads the station every five seconds.
            const item = status.nowPlaying?.item.id;
            await runCommand(
                face,
                () => this.station.command(playout => playout.skipTheCurrentItem(item === undefined ? undefined : { item })),
                this.log,
                { conflict: 'Nothing was skipped: the record the key was showing had already finished.' },
            );
        } finally {
            this.busy = false;
        }
    }

    /** Nothing on the key but a failure's word: the picture says what it does. */
    protected render(): void {
        this.painter.paintAll({ title: this.reading.failure === undefined ? '' : describe(this.reading.failure).title });
    }
}
