import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { PlayoutPusher } from '#modules/playout/playout.pusher.js';
import type { ChartOrder } from './chart.picks.js';
import { DirectorConsoleService } from './director.console.service.js';

export interface AirChartPayload {
    /**
     * The qualified `pluginId:chartId` the operator asked for.
     *
     * Optional only because `JobMappings` is typed over `Job<object>`, so a payload with a
     * required field cannot satisfy it — every payload in that table is all-optional for the same
     * reason. The one sender always fills it, from an id `readChart` has already validated, and
     * {@link AirChartJob.execute} refuses a job without one rather than trusting the type.
     */
    chartId?: string;
    /** Which way round to play it. Absent means `DEFAULT_CHART_ORDER`. */
    chartOrder?: ChartOrder;
}

/**
 * Put the station on air with a published chart, away from the request that asked for it.
 *
 * ## Why this one is a job and playing a playlist is not
 *
 * A playlist names COPIES, so `putOnAir` reads a list and vets it: one plugin call, no network per
 * item, and answering inline is honest. A chart names RECORDS, so every entry has to be matched
 * against the catalog, looked up at a provider and ingested before it can air — up to
 * `MAX_CHART_ENTRIES` of them, each a search across every searchable provider. That is minutes of
 * network inside one HTTP request, and it was being done inside the request's DB transaction too.
 *
 * Two things came of that, both measured on the live station on 2026-09-07. `ingestTrack` opened a
 * transaction on a `Kysely` that already was one, which Kysely refuses, so every lookup threw and
 * was downgraded to a warning: a hundred-record chart aired with the eight the library held. And
 * the whole resolve sat on a pooled connection for its duration, which is the shape
 * `transaction.exemptions.ts` documents as having taken the pool down once already.
 *
 * The ingest bug is fixed at its source. This moves the slow half off the request anyway, because a
 * hundred provider searches is not something to hold a connection and an operator's browser open
 * for however well it behaves.
 *
 * ## What the operator sees
 *
 * The same thing `ReplanLineupJob` costs them: the press lands seconds later rather than at once,
 * and the console shows it when `/playout/status` next answers. The failures worth telling somebody
 * about at the door — an id that names no chart, a chart that could not be read — are still raised
 * there, by `DirectorConsoleService.airChart`, which reads the chart before enqueuing anything.
 * What is left to land here is "nothing on that chart can be played", which needs the lookups to
 * know and so reaches the operator through the activity feed instead.
 *
 * ## Not retried
 *
 * Unlike the refill and the replan, which are additive or replace a tail. This ENDS the broadcast
 * that is on and starts another, so a silent second attempt minutes later would take a station the
 * operator has since put somewhere else and change it again on the strength of a press they have
 * forgotten making. A chart that failed to air is a button to press again, not a job to reattempt.
 */
@Injectable()
export class AirChartJob extends PlainJob<AirChartPayload> {
    constructor(
        // The console service itself rather than a copy of what it does: `putOnAir` is where a
        // broadcast's binding is composed, and a second composition here would be a second idea of
        // what a broadcast IS. Its `actor()` already documents this arm — a job reaching it looks
        // like a system actor, which is what `AuthorizationContext`'s default factory answers with
        // outside a request. The ask was recorded with the operator on it before this was sent.
        private readonly console: DirectorConsoleService,
        // A singleton, like the director the other two director jobs reach: handing the first item
        // over now rather than waiting out the reconcile tick is what `playChart` used to do inline.
        private readonly pusher: PlayoutPusher,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: AirChartPayload): Promise<void> {
        // A payload this job cannot act on. Only reachable by hand — the one sender builds it from a
        // validated id — so it says so and stops rather than throwing into a retry it does not have.
        if (!payload?.chartId) {
            this.logger.warn('director: an air-chart job arrived with no chart on it; nothing to put on air');
            return;
        }

        await this.console.putOnAir({
            chartId: payload.chartId,
            ...(payload.chartOrder === undefined ? {} : { chartOrder: payload.chartOrder }),
        });

        await this.pusher.reconcile();
    }
}
