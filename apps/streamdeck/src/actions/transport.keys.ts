import { describe } from '../station/connection.failure.js';
import type { Reading, StatusPoller } from '../station/status.poller.js';
import { readTransport } from '../station/transport.reading.js';
import { DISARMED, expire, press, type Arm } from './arming.js';
import { runCommand, type Log } from './command.outcome.js';
import { StationKeys } from './station.keys.js';

/** The manifest's two states for the transport key, in its order. */
export const STOP = 0;
export const START = 1;

/**
 * Stop, or Start once the station is stopped: one key, drawn as whichever it would do.
 *
 * Stop arms on the first press and fires on the second (see `arming.ts`), and each key arms on its
 * own, so a second transport key on the deck does not fire because the first was pressed. Start fires
 * at once: bringing the station back is never the accident Stop is guarding against, and the station
 * refuses it (a 409) when there is nothing left to resume, which the key reports rather than hides.
 *
 * An armed key disarms when the station stands down by some other hand, or stops answering, because
 * the Stop it was arming is no longer the thing a second press would do.
 */
export class TransportKeys extends StationKeys {
    private readonly arms = new Map<string, Arm>();
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
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
        if (this.busy || status === undefined || this.reading.stale) {
            await face?.showAlert().catch(() => undefined);
            return;
        }

        if (readTransport(status).stoodDown) {
            await this.run(face, () => this.station.command(playout => playout.startPlayout()));
            return;
        }

        const next = press(this.arms.get(id) ?? DISARMED, Date.now());
        this.setArm(id, next.arm);
        this.render();
        if (next.fire) await this.run(face, () => this.station.command(playout => playout.stopPlayout()));
    }

    protected override onReading(reading: Reading): void {
        const disarm = reading.failure !== undefined || reading.status === undefined || readTransport(reading.status).stoodDown;
        if (disarm) for (const id of [...this.arms.keys()]) this.setArm(id, DISARMED);
    }

    protected override onDisappear(id: string): void {
        this.setArm(id, DISARMED);
    }

    protected render(): void {
        const status = this.reading.status;
        const state = status !== undefined && readTransport(status).stoodDown ? START : STOP;
        const failure = this.reading.failure === undefined ? '' : describe(this.reading.failure).title;
        for (const id of this.painter.ids()) {
            const armed = (this.arms.get(id) ?? DISARMED).armed && state === STOP;
            this.painter.paint(id, { state, title: armed ? 'Confirm' : failure });
        }
    }

    private async run(face: Parameters<typeof runCommand>[0], command: () => Promise<unknown>): Promise<void> {
        this.busy = true;
        try {
            await runCommand(face, command, this.log, {
                conflict: 'Nothing to resume. The station was stood down with nothing left to play: put a playlist on air from the console.',
            });
        } finally {
            this.busy = false;
        }
    }

    /** Arms or disarms one key, and forgets the arm on its own when its five seconds are up. */
    private setArm(id: string, arm: Arm): void {
        clearTimeout(this.timers.get(id));
        this.timers.delete(id);
        if (!arm.armed) {
            this.arms.delete(id);
            return;
        }
        this.arms.set(id, arm);
        this.timers.set(
            id,
            setTimeout(() => {
                this.setArm(id, expire(arm, Date.now()));
                this.render();
            }, arm.until - Date.now()),
        );
    }
}
