import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ANALYSIS_SCHEMA_VERSION } from '@deadair/plugin-sdk';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import { DirectorConsoleService } from '#modules/director/director.console.service.js';
import { PlayoutService } from '#modules/playout/playout.service.js';
import { PluginsService } from '#modules/plugins/plugins.service.js';
import { attention, type AttentionFacts, type BrokenPlugin } from './station.attention.js';
import type { StationAttention } from './types/station.types.js';

/**
 * Gathering one reading of the station, for the ordered list next door.
 *
 * Everything here is a read of somebody else's answer. This module owns no table and writes nothing:
 * the whole of it is that five facts an operator needs together live on five surfaces they would
 * have to visit one at a time. See `station.attention.ts` for what that list refuses to invent.
 *
 * ## It reads five services and fails on none of them
 *
 * A page that says what is wrong is the worst possible place for one broken reader to take the whole
 * answer down, and these are the readers most likely to be unhappy on a station that has something
 * wrong with it. So each one is caught to its own quiet default and the rest of the list still
 * arrives, with the failure logged rather than shown — the alternative is an operator staring at an
 * error where the explanation for their silence was going to be.
 *
 * ## The silence comes through `getStatus`
 *
 * Rather than diagnosing again here, which would be a second composition of ten gates and a second
 * set of sentences. The status call is what the console already polls for the transport strip, so
 * this is the same answer arriving by a second road rather than a different one.
 */
@Injectable()
export class StationAttentionService {
    constructor(
        private readonly playout: PlayoutService,
        private readonly director: DirectorConsoleService,
        private readonly tracks: TracksRepository,
        private readonly plugins: PluginsService,
        private readonly logger: Logger,
    ) {}

    async read(): Promise<StationAttention> {
        const [silence, counts, unavailableItems, brokenPlugins] = await Promise.all([
            this.silence(),
            this.counts(),
            this.unavailableItems(),
            this.brokenPlugins(),
        ]);

        const facts: AttentionFacts = {
            silence,
            benched: counts.benched,
            failing: counts.failing,
            tracks: counts.total,
            unavailableItems,
            brokenPlugins,
        };

        return { items: attention(facts) };
    }

    /**
     * The transport's own answer, or a station that reports nothing.
     *
     * The fallback is `audible: true` with no checks, which reads as "nothing to say about the air"
     * rather than as a silence — because a reader that threw is a fact about this app and reporting
     * it as the station being off would put a red line on a station that is playing perfectly well.
     */
    private async silence() {
        try {
            return (await this.playout.getStatus()).silence;
        } catch (error) {
            this.logger.warn(`station: the silence diagnosis could not be read (${message(error)})`);
            return { audible: true, cause: 'airing' as const, detail: '', checks: [] };
        }
    }

    private async counts() {
        try {
            // No search, no album, no state: this is the whole library, which is what a station-wide
            // answer is about. The schema version is the analysis module's rule about what still
            // counts as measured, passed in the same way the catalog page passes it.
            return await this.tracks.trackStateCounts({ limit: 0, offset: 0, sort: 'asc', schemaVersion: ANALYSIS_SCHEMA_VERSION });
        } catch (error) {
            this.logger.warn(`station: the catalog counts could not be read (${message(error)})`);
            return { total: 0, cached: 0, measured: 0, enriched: 0, benched: 0, failing: 0 };
        }
    }

    /**
     * Records the station could not obtain the audio for, in the order it is airing now.
     *
     * Counted off the live running order rather than from a table, because that is the only place
     * the state exists: `unavailable` is `DirectorService.thin` taking a record out before its slot,
     * and the order is consumed rather than kept. So this answers for THIS broadcast, which is the
     * span an operator asking "why is it skipping" means.
     */
    private async unavailableItems(): Promise<number> {
        try {
            const order = await this.director.getOrder();
            return order.items.filter(item => item.state === 'unavailable').length;
        } catch (error) {
            this.logger.warn(`station: the running order could not be read (${message(error)})`);
            return 0;
        }
    }

    /**
     * Plugins an operator switched on that are not running.
     *
     * `enabled` is the whole filter. A `discovered` plugin nobody turned on is not a problem, and a
     * `disabled` one is a decision — reporting either would be reporting the operator's own choices
     * back to them as faults.
     */
    private async brokenPlugins(): Promise<BrokenPlugin[]> {
        try {
            return (await this.plugins.listPlugins())
                .filter(plugin => plugin.enabled && (plugin.status === 'misconfigured' || plugin.status === 'failed'))
                .map(plugin => ({ id: plugin.id, name: plugin.name, status: plugin.status as BrokenPlugin['status'] }));
        } catch (error) {
            this.logger.warn(`station: the plugin list could not be read (${message(error)})`);
            return [];
        }
    }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
