import { Injectable } from 'injectkit';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';
import type { PlaybackReport } from '@deadair/plugin-sdk';
import { asStreamPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { isRenderItem } from '#modules/render/segment.source.js';
import { errorText } from '#modules/shared/error.text.js';
import { Rundown, type RundownItem } from '../rundown.js';
import type { ReportPlaybackPayload } from './report.playback.job.js';

/** A served copy that is on air now, held until the next item replaces it. */
interface OnAir {
    pluginId: string;
    trackId: string;
    startedAt: number;
}

/**
 * Telling a provider that one of its copies went to air, and when it came off.
 *
 * ## Off the transport's aired edge
 *
 * `Rundown.onAired` fires once per item at the moment it is heard, which is what play history, the
 * scrobble and the chat announcements hang off. A record's `started` is that moment; its `ended` is
 * the next item's, whatever that item is, because the edge is the only thing that knows when one item
 * gave way to the next. So this holds exactly one record between two edges and nothing else.
 *
 * ## Only for providers that asked
 *
 * `reportPlayback` is optional on the stream capability and most providers leave it out, so the
 * plugin is checked on the edge and nothing is enqueued for a library server's records. The check is
 * repeated in the job, since a plugin can be disabled in between.
 *
 * ## Jobs, never inline
 *
 * The work is outbound, slow on a bad day and waited on by nobody, which is the pg-boss case in
 * `apps/api/CLAUDE.md` § "How work is dispatched". The listener only sends and returns, as `onAired`
 * requires: the next item is being fetched behind it.
 *
 * A restart forgets the record on air, so its `ended` is never sent. That is one missing event after a
 * deploy, and the provider hears the next record start regardless.
 */
@Injectable()
export class ProviderPlaybackReporter {
    private unsubscribe?: () => void;
    private onAir?: OnAir;

    constructor(
        private readonly rundown: Rundown,
        private readonly registry: PluginRegistry,
        private readonly jobs: PgBossJobBroker,
        private readonly logger: Logger,
    ) {}

    /** Begin reporting. Idempotent. */
    start(): void {
        if (this.unsubscribe !== undefined) return;
        this.unsubscribe = this.rundown.onAired(item => this.aired(item, Date.now()));
    }

    /** Stop reporting. */
    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.onAir = undefined;
    }

    /**
     * One aired edge: end whatever was on air, and start this item if its provider wants to hear it.
     * Public for the tests; the listener above is the only caller in the station.
     */
    aired(item: RundownItem, now: number): void {
        const ended = this.onAir;
        this.onAir = undefined;

        if (ended !== undefined) {
            this.send(ended, { event: 'ended', startedAt: ended.startedAt, elapsedMs: Math.max(0, now - ended.startedAt) });
        }

        if (isRenderItem(item) || !this.wantsReports(item.pluginId)) return;

        this.onAir = { pluginId: item.pluginId, trackId: item.externalId, startedAt: now };
        this.send(this.onAir, { event: 'started', startedAt: now });
    }

    private wantsReports(pluginId: string): boolean {
        const record = this.registry.get(pluginId);
        const plugin = record ? asStreamPlugin(record) : undefined;
        return typeof plugin?.instance.reportPlayback === 'function';
    }

    private send(copy: OnAir, report: PlaybackReport): void {
        const payload: ReportPlaybackPayload = { pluginId: copy.pluginId, trackId: copy.trackId, report };
        void this.jobs
            .send('playout.report_playback', payload)
            .catch(error => this.logger.warn(`playout: could not queue a playback report (${copy.pluginId}: ${errorText(error)})`));
    }
}
