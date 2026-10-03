import { Container, Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { toPluginError } from '@deadair/plugin-sdk';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { OutputsRepository, type OutputCastRow } from './outputs.repository.js';
import { OutputSpeakers, isUnknownDevice } from './outputs.speakers.js';

/** How often every cast is asked how it is doing. */
export const OUTPUTS_CHECK_MS = 20_000;

/** How long to wait before playing a dropped speaker again, by how many times in a row it has dropped. */
export const REPLAY_BACKOFF_MS = [0, 15_000, 30_000, 60_000, 120_000, 300_000] as const;

interface Replays {
    count: number;
    nextAt: number;
}

/**
 * Keeps every cast the operator started playing, until they stop it or somebody at the speaker
 * moves it on to something else.
 *
 * A module-owned loop, like `MessagingPoller`, because it is a standing job with nothing to wake it:
 * a speaker that drops the stream says so to nobody. Every {@link OUTPUTS_CHECK_MS} it asks each
 * cast's speaker how it is, and reads the answer this way:
 *
 * - **Starting or playing**: fine.
 * - **Unreachable**: waited out. A speaker that is switched off or rebooting is not one to give up on,
 *   and not one to hammer either: nothing is sent to it but the next status question.
 * - **Stopped, with the station's stream still loaded**: the stream dropped (the station restarted,
 *   the network blinked). Played again, with a growing pause between tries.
 * - **Stopped on something else, or idle**: somebody at the speaker ended it or put something else
 *   on. The cast is forgotten, because putting the station back over a film every twenty seconds
 *   is the one thing a speaker in somebody's home must never do.
 *
 * The one exception is the first look after this process starts. A speaker found idle then went
 * quiet because the STATION did, and it is played again rather than forgotten: that is the case
 * the table exists for.
 */
@Injectable()
export class OutputsSupervisor {
    private timer: ReturnType<typeof setInterval> | undefined;
    private checking: Promise<void> | undefined;
    /** Casts this process has looked at, so the first look can resume rather than forget. */
    private readonly seen = new Set<string>();
    private readonly replays = new Map<string, Replays>();

    constructor(
        private readonly container: Container,
        private readonly speakers: OutputSpeakers,
        private readonly logger: Logger,
    ) {}

    /** Starts the loop, with a first check straight away so a restart resumes promptly. */
    start(): void {
        if (this.timer !== undefined) return;
        this.timer = setInterval(() => void this.check(), OUTPUTS_CHECK_MS);
        void this.check();
    }

    /** Stops the loop and waits for a check in flight, so none outlives the plugins it calls. */
    async stop(): Promise<void> {
        clearInterval(this.timer);
        this.timer = undefined;
        await this.checking;
    }

    /** One pass over every cast. Overlapping passes are folded into the one already running. */
    check(now = Date.now()): Promise<void> {
        this.checking ??= this.checkAll(now).finally(() => {
            this.checking = undefined;
        });
        return this.checking;
    }

    private async checkAll(now: number): Promise<void> {
        let rows: OutputCastRow[];
        try {
            rows = await inScope(this.container, scope => scope.get(OutputsRepository).list());
        } catch (error) {
            this.logger.warn('outputs: could not read the casts to check them', { error: errorText(error) });
            return;
        }

        const live = new Set(rows.map(key));
        for (const stale of [...this.replays.keys()]) if (!live.has(stale)) this.replays.delete(stale);

        // One at a time: a handful of speakers, and a status question each, is not worth a burst.
        for (const row of rows) await this.checkOne(row, now);
    }

    private async checkOne(row: OutputCastRow, now: number): Promise<void> {
        const plugin = this.speakers.plugin(row.pluginId);
        // A plugin that is not running is somebody's to fix; the cast waits for it.
        if (plugin === undefined) return;

        const id = key(row);
        const firstLook = !this.seen.has(id);
        this.seen.add(id);

        let status;
        try {
            status = await this.speakers.status(plugin, row.deviceId);
        } catch (error) {
            if (isUnknownDevice(error)) await this.forget(row, 'the plugin no longer has this speaker');
            else
                this.logger.debug('outputs: a speaker could not be asked how it is', { device: row.deviceName, error: toPluginError(error).message });
            return;
        }

        switch (status.phase) {
            case 'opening':
            case 'buffering':
            case 'playing':
                this.replays.delete(id);
                return;
            case 'unreachable':
                return;
            case 'idle':
                if (firstLook) await this.replay(row, now, 'resuming after the station restarted');
                else await this.forget(row, 'it was stopped on the speaker');
                return;
            case 'stopped':
                if (status.url !== undefined && status.url === this.speakers.urlFor(row.mountPath)) {
                    await this.replay(row, now, status.detail ?? 'the stream dropped');
                } else {
                    await this.forget(row, status.detail ?? 'something else is playing on it');
                }
                return;
        }
    }

    private async replay(row: OutputCastRow, now: number, why: string): Promise<void> {
        const id = key(row);
        const replays = this.replays.get(id) ?? { count: 0, nextAt: 0 };
        if (now < replays.nextAt) return;

        const plugin = this.speakers.plugin(row.pluginId);
        if (plugin === undefined) return;

        replays.count += 1;
        replays.nextAt = now + REPLAY_BACKOFF_MS[Math.min(replays.count, REPLAY_BACKOFF_MS.length - 1)]!;
        this.replays.set(id, replays);

        this.logger.info('outputs: playing the station on a speaker again', { device: row.deviceName, why, attempt: replays.count });
        try {
            await this.speakers.play(plugin, row.deviceId, row.mountPath);
        } catch (error) {
            if (isUnknownDevice(error)) await this.forget(row, 'the plugin no longer has this speaker');
            else this.logger.warn('outputs: a speaker would not take the station again', { device: row.deviceName, error: errorText(error) });
        }
    }

    private async forget(row: OutputCastRow, why: string): Promise<void> {
        this.replays.delete(key(row));
        this.logger.info('outputs: a speaker moved on from the station; forgetting the cast', { device: row.deviceName, why });
        try {
            await inScope(this.container, scope => scope.get(OutputsRepository).remove(row.pluginId, row.deviceId));
        } catch (error) {
            this.logger.warn('outputs: could not forget a cast', { device: row.deviceName, error: errorText(error) });
        }
    }
}

const key = (row: Pick<OutputCastRow, 'pluginId' | 'deviceId'>): string => `${row.pluginId}\u0000${row.deviceId}`;
