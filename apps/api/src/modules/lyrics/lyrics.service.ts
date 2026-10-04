import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { toTrackRef } from '#modules/enrichment/enrichment.service.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import type { LyricsPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PROVIDER_CAPABILITIES, pluginsInOrder } from '#modules/plugins/plugin.providers.js';
import { errorText } from '#modules/shared/error.text.js';
import { sanitizeLyrics } from './lyrics.sanitize.js';
import { LyricsRepository, type PendingLyricsTrack } from './lyrics.repository.js';

/**
 * How long one `lyricsFor` call may take, including the host's own backing off on a `Retry-After`.
 * Enrichment's per-track figure, for the same kind of upstream.
 */
export const LYRICS_CALL_TIMEOUT_MS = 24_000;

/**
 * How long a miss holds before the provider is asked again.
 *
 * Longer than enrichment's week. A lyrics database grows by contribution, so a record nobody had
 * transcribed may be there next month, but it will rarely be there next week, and every re-ask
 * is a request against a source run as a public service.
 */
export const LYRICS_MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** First retry after a provider could not be asked, doubling from here. */
export const LYRICS_FAILURE_RETRY_MS = 60 * 60 * 1000;

/** The ceiling on that doubling: a week, so a source that recovers is noticed within one. */
export const LYRICS_FAILURE_MAX_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

/** What one pass over the walk did. */
export interface LyricsPassSummary {
    /** Records at least one provider answered about, one way or another. */
    scanned: number;
    /** Records a provider had words for. */
    found: number;
    /** Records a provider said nobody sings on. */
    instrumental: number;
    /** Records every provider asked had nothing for. */
    missed: number;
    /** Records at least one provider could not be asked about. */
    failed: number;
}

/**
 * Asks the lyrics plugins about the records the station does not have words for yet, and stores
 * what they say.
 *
 * Sequential, provider by provider and record by record, for `EnrichmentService.enrich`'s reason:
 * these sources are paced per request by the host, so asking two at once buys nothing but two
 * callers parked on one limiter.
 *
 * A plugin that fails is data, not an exception. It is recorded against the record and the walk
 * carries on; `PluginInvoker` is counting it toward the breaker that will stop it being asked.
 */
@Injectable()
export class LyricsService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly repository: LyricsRepository,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** Every plugin that could answer right now, in the order they are asked. */
    providers(): LyricsPlugin[] {
        return pluginsInOrder(this.pluginRegistry.list(), this.config, PROVIDER_CAPABILITIES.lyrics);
    }

    /**
     * One batch of records that have not heard from every lyrics provider.
     *
     * `priority` is what the station is about to play, and it only ORDERS the batch (see
     * `LyricsRepository.listTracksNeedingLyrics`). A record that fails is skipped rather than
     * retried here: it is still outstanding, and the next run finds it.
     */
    async fetchPending(limit: number, signal?: AbortSignal, priority: readonly string[] = []): Promise<LyricsPassSummary> {
        const summary: LyricsPassSummary = { scanned: 0, found: 0, instrumental: 0, missed: 0, failed: 0 };

        const providers = this.providers();
        if (providers.length === 0) return summary;

        const byId = new Map(providers.map(plugin => [plugin.record.id, plugin]));
        const tracks = await this.repository.listTracksNeedingLyrics([...byId.keys()], limit, priority);

        for (const track of tracks) {
            if (signal?.aborted) break;
            const outcome = await this.fetchOne(track, byId, signal);
            if (outcome.asked === 0) continue;

            summary.scanned++;
            if (outcome.words) summary.found++;
            else if (outcome.instrumental) summary.instrumental++;
            else if (outcome.failed === 0) summary.missed++;
            if (outcome.failed > 0) summary.failed++;
        }

        return summary;
    }

    /**
     * Asks each provider this record is waiting on, in the operator's order, and writes each answer.
     *
     * Every outstanding provider is asked even after one has words, because two sources are two
     * artifacts rather than a conflict: one may have timings where the other has only text.
     */
    private async fetchOne(
        track: PendingLyricsTrack,
        byId: Map<string, LyricsPlugin>,
        signal?: AbortSignal,
    ): Promise<{ asked: number; words: boolean; instrumental: boolean; failed: number }> {
        const ref = toTrackRef(track);
        const outcome = { asked: 0, words: false, instrumental: false, failed: 0 };

        for (const pluginId of track.outstanding) {
            if (signal?.aborted) break;
            const plugin = byId.get(pluginId);
            if (!plugin) continue;
            outcome.asked++;

            let answer;
            try {
                answer = await this.pluginInvoker.invoke(pluginId, 'lyrics.lyricsFor', async () => plugin.instance.lyricsFor(ref), {
                    timeoutMs: LYRICS_CALL_TIMEOUT_MS,
                });
            } catch (error) {
                outcome.failed++;
                const message = errorText(error);
                this.logger.warn('lyrics plugin failed', { pluginId, artist: ref.artist, title: ref.title, error: message });
                await this.write(() =>
                    this.repository.recordFailure(track.id, pluginId, message, LYRICS_FAILURE_RETRY_MS, LYRICS_FAILURE_MAX_RETRY_MS),
                );
                continue;
            }

            const sanitized = sanitizeLyrics(answer, reason => this.logger.warn('lyrics plugin returned something unstorable', { pluginId, reason }));

            if (sanitized.kind === 'words') {
                outcome.words = true;
                const { kind: _, ...words } = sanitized;
                await this.write(() => this.repository.saveWords(track.id, pluginId, words));
            } else if (sanitized.kind === 'instrumental') {
                outcome.instrumental = true;
                await this.write(() => this.repository.saveInstrumental(track.id, pluginId, sanitized.providerRef));
            } else {
                await this.write(() => this.repository.recordMiss(track.id, pluginId, LYRICS_MISS_TTL_MS));
            }
        }

        return outcome;
    }

    /** A write that fails is one record's problem; the rest of a batch that cost real requests should still land. */
    private async write(run: () => Promise<void>): Promise<void> {
        try {
            await run();
        } catch (error) {
            this.logger.warn('lyrics pass could not store an answer', { error: errorText(error) });
        }
    }
}
