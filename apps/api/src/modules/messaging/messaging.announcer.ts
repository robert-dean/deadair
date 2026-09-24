import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';
import type { MessagingAnnounceTarget } from '@deadair/plugin-sdk';
import type { MessagingPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { Rundown, type RundownItem } from '#modules/playout/rundown.js';
import { isRenderItem } from '#modules/render/segment.source.js';
import { errorText } from '#modules/shared/error.text.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { describeRecord } from './messaging.commands.js';
import type { AnnouncePayload } from './messaging.announce.job.js';
import { MessagingService } from './messaging.service.js';

/**
 * How long an announcement about a record whose length nobody knows stays worth sending. About a
 * record's length, for the reason {@link announceDeadline} gives.
 */
const UNKNOWN_DURATION_MS = 4 * 60_000;

/** The least any announcement is given, so a very short record still gets its retry. */
const MIN_WINDOW_MS = 60_000;

/** How long asking a plugin which chats want announcements may take. A config read, so not long. */
const TARGETS_TIMEOUT_MS = 5_000;

/**
 * The moment past which announcing a record is wrong rather than late: when it stops playing.
 *
 * "Now playing" posted after the record has ended is a false statement, which is why this is a cutoff
 * and not a backoff ceiling. Exported for the tests.
 */
export function announceDeadline(airedAt: number, durationMs: number | undefined): number {
    const length = durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : UNKNOWN_DURATION_MS;
    return airedAt + Math.max(length, MIN_WINDOW_MS);
}

/**
 * Telling chats what the station is playing, as each record goes to air.
 *
 * ## Off the transport's own aired edge, and not the director's
 *
 * `Rundown.onAired` fires once per item at the moment it is heard, which is what play history and the
 * scrobble hang off too. This module sits after the director in `modules.ts`, so the director
 * calling forward into it would be the dependency the list exists to rule out; the rundown is in
 * `playout`, before both, and anything may listen to it. The listener hands everything to jobs and
 * returns, as `onAired` requires: the next item is being fetched behind it.
 *
 * ## A job per chat, and never a queue of its own
 *
 * A pg-boss job is the house mechanism for slow outbound work that wants retries and that nobody is
 * waiting on, which is exactly this. One job per chat, so a channel that has removed the bot does not
 * cost a group its announcement. The job drops an announcement once its record has stopped playing
 * (see {@link announceDeadline}) and otherwise retries what the plugin says is worth retrying.
 *
 * Records only. A break is the station talking and is announced by being heard; a programme is
 * somebody else's show and says what it is itself.
 */
@Injectable()
export class MessagingAnnouncer {
    private unsubscribe?: () => void;

    constructor(
        private readonly rundown: Rundown,
        private readonly messaging: MessagingService,
        private readonly pluginInvoker: PluginInvoker,
        private readonly jobs: PgBossJobBroker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** Begin announcing. Idempotent. */
    start(): void {
        if (this.unsubscribe !== undefined) return;
        this.unsubscribe = this.rundown.onAired(item => this.aired(item));
    }

    /** Stop announcing. */
    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    private aired(item: RundownItem): void {
        if (isRenderItem(item) || item.title.trim() === '') return;

        void this.announce(item, Date.now()).catch(error => this.logger.warn(`messaging: could not announce what aired (${errorText(error)})`));
    }

    /**
     * Send one announcement job per chat that wants this one. Exported through the class for the
     * tests; the listener above is the only caller in the station.
     */
    async announce(item: RundownItem, airedAt: number): Promise<number> {
        const platforms = this.messaging.platforms().filter(platform => platform.announces);
        if (platforms.length === 0) return 0;

        const station = this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title);
        const text = describeRecord(station, {
            title: item.title,
            artist: item.artists.join(', ') || item.artist,
            ...(item.album === undefined ? {} : { album: item.album }),
        });
        const notAfter = announceDeadline(airedAt, item.durationMs);

        let sent = 0;
        for (const platform of platforms) {
            if (!(await this.messaging.accepting(platform))) continue;

            for (const target of await this.targets(platform)) {
                if (!target.announcements.includes('nowPlaying')) continue;

                const payload: AnnouncePayload = { pluginId: platform.record.id, chatId: target.chatId, text, notAfter };
                await this.jobs.send('messaging.announce', payload);
                sent += 1;
            }
        }
        return sent;
    }

    /** The chats this platform announces in, or none when it could not say. */
    private async targets(platform: MessagingPlugin): Promise<MessagingAnnounceTarget[]> {
        try {
            const targets = await this.pluginInvoker.invoke(
                platform.record.id,
                'messaging.announceTargets',
                async () => platform.instance.announceTargets!(),
                {
                    timeoutMs: TARGETS_TIMEOUT_MS,
                },
            );
            return Array.isArray(targets) ? targets : [];
        } catch (error) {
            this.logger.info(`messaging: a platform could not say where to announce (${platform.record.id}: ${errorText(error)})`);
            return [];
        }
    }
}
