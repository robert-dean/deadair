import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { ScrobblePlay } from '@deadair/plugin-sdk';
import { asScrobblePlugin, type ScrobblePlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { errorText } from '#modules/shared/error.text.js';
import { ScrobbleRepository, type ScrobbleEnqueue } from './scrobble.repository.js';

/**
 * Telling somebody else what the station played.
 *
 * ## Queued, because this is the one thing the station SENDS
 *
 * Every other capability is a read: a failure costs an answer and the next pass
 * tries again. A scrobble that fails and is not retried is a listen missing from
 * a history the operator keeps, so every play is written to
 * `deadair.scrobble_queue` first and sent by a cron afterwards. A restart, a
 * redeploy or an hour of somebody else's downtime costs nothing.
 *
 * ## Nothing is queued for a destination that is not accepting
 *
 * A plugin whose `accepting()` says no gets no rows at all, rather than rows that
 * are discarded two minutes later. It is asked per enqueue rather than cached,
 * for the reason tool declarations are read per conversation: an operator's
 * config write reinitializes the plugin, so the answer changes under a running
 * station.
 *
 * ## `nowPlaying` is not part of any of that
 *
 * It is worthless late, which is exactly why it does not belong in the durable
 * path. It is sent once, at the moment the record goes to air, and a failure is
 * logged at debug and forgotten.
 */

/**
 * The most of a record that has to have aired before it counts.
 *
 * Half the record, capped at four minutes, which is what the services themselves
 * publish and is a sensible general rule: it is the earliest point at which
 * somebody can be said to have heard a record rather than caught the front of it.
 */
export const SCROBBLE_MIN_PLAY_FRACTION = 0.5;

/** The cap on the above, for a record long enough that half of it is a wait. */
export const SCROBBLE_MAX_WAIT_MS = 4 * 60 * 1000;

/**
 * How long a record with no known duration waits.
 *
 * Most of a pop record, so a very short one is not scrobbled before it has
 * finished and a very long one is not held. Only reached for an item the catalog
 * has no duration for, which is rare.
 */
const UNKNOWN_DURATION_WAIT_MS = 2 * 60 * 1000;

/** How long one call into a plugin may take. Well inside the flush job's own budget. */
const INVOKE_TIMEOUT_MS = 15_000;

/** What the director hands over when a record goes to air. */
export interface AiredPlay {
    play: ScrobblePlay;
    stationKey: string;
    broadcastId?: string;
}

@Injectable()
export class ScrobbleService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly repository: ScrobbleRepository,
        private readonly logger: Logger,
    ) {}

    /** Every destination installed and running, in a stable order. */
    destinations(): ScrobblePlugin[] {
        return pluginsWith(this.pluginRegistry.list(), asScrobblePlugin).sort(byPluginId);
    }

    /**
     * The destinations that currently want plays.
     *
     * A plugin that never wrote `accepting` always accepts, per the SDK. One that
     * throws is treated as NOT accepting: it is the safer way to be wrong, since
     * the alternative is publishing to an account whose plugin could not say
     * whether it was meant to.
     */
    async accepting(): Promise<ScrobblePlugin[]> {
        const willing: ScrobblePlugin[] = [];

        for (const destination of this.destinations()) {
            if (!destination.declarable) {
                willing.push(destination);
                continue;
            }

            try {
                const yes = await this.pluginInvoker.invoke(
                    destination.record.id,
                    'scrobble.accepting',
                    async () => destination.instance.accepting!(),
                    { timeoutMs: INVOKE_TIMEOUT_MS },
                );
                if (yes) willing.push(destination);
            } catch (error) {
                this.logger.info(`scrobble: a destination could not say whether it wants plays (${destination.record.id}: ${errorText(error)})`);
            }
        }

        return willing;
    }

    /**
     * Queue one aired record for every destination that wants it.
     *
     * Called from the same edge that writes `play_history`, and `void`ed there the
     * same way: a boundary must never be held up by this, and a lost row costs one
     * scrobble and nothing else.
     *
     * Answers with how many rows were written, which is zero on a station with no
     * scrobbler installed — the ordinary case, and not a fault.
     */
    async enqueue(aired: AiredPlay): Promise<number> {
        const destinations = await this.accepting();
        if (destinations.length === 0) return 0;

        const eligibleAt = aired.play.playedAt + waitFor(aired.play.durationMs);

        const entries: ScrobbleEnqueue[] = destinations.map(destination => ({
            stationKey: aired.stationKey,
            pluginId: destination.record.id,
            play: aired.play,
            eligibleAt,
            ...(aired.broadcastId === undefined ? {} : { broadcastId: aired.broadcastId }),
        }));

        const written = await this.repository.enqueue(entries);
        this.logger.debug('scrobble: queued a play', { title: aired.play.title, destinations: entries.length });
        return written;
    }

    /**
     * Say what is on air, to whoever wants telling.
     *
     * Deliberately outside the queue: this is worthless a minute late, so it is
     * sent once and never retried. Every failure is swallowed at debug — a
     * destination that cannot take a now-playing ping is not a fault worth a
     * warning on every record.
     */
    async announceNowPlaying(play: ScrobblePlay): Promise<void> {
        for (const destination of await this.accepting()) {
            if (!destination.saysNowPlaying) continue;

            try {
                await this.pluginInvoker.invoke(destination.record.id, 'scrobble.nowPlaying', async () => destination.instance.nowPlaying!(play), {
                    timeoutMs: INVOKE_TIMEOUT_MS,
                });
            } catch (error) {
                this.logger.debug('scrobble: a destination would not take a now-playing', {
                    pluginId: destination.record.id,
                    reason: errorText(error),
                });
            }
        }
    }
}

/**
 * How long after it started a record may be reported.
 *
 * Half of it, capped, per {@link SCROBBLE_MIN_PLAY_FRACTION}. A record whose
 * length nothing knows waits a flat two minutes rather than being sent
 * immediately: the failure mode of sending early is a rejection the queue then
 * retries forever, and the failure mode of waiting is two minutes.
 */
export function waitFor(durationMs: number | undefined): number {
    if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) return UNKNOWN_DURATION_WAIT_MS;
    return Math.min(Math.round(durationMs * SCROBBLE_MIN_PLAY_FRACTION), SCROBBLE_MAX_WAIT_MS);
}
