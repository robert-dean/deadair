import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { httpError } from '@maroonedsoftware/errors';
import { DateTime } from 'luxon';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { firstPass } from './production.passes.js';
import { stationTargetMs, stationWritingMode } from './production.settings.js';
import { titleFor } from './production.scheduler.js';
import { stationZone } from '#modules/director/clock.words.js';
import { ProductionRepository } from './production.repository.js';
import type { Production } from './production.js';
import type { ProductionList, ProductionRequest, Production as ProductionView } from './types/productions.types.js';

/** What a production is called when the operator did not say. */
const DEFAULT_KIND = 'podcast';

/**
 * The operator's surface onto what the station is making.
 *
 * ## Asking for one QUEUES it, and that is load-bearing
 *
 * {@link request} writes a row and sends the first pass job. It does not run a pass, and it does not
 * wait for one. That is the director's own rule applied here — every writer posts a command and none
 * of them does the work inline — and it matters most for the case this endpoint is expected to be
 * used for, which is previewing what a production sounds like. A preview that ran a pass inside the
 * request would hold the station's one model slot for minutes while an operator watched a spinner,
 * which is the console making the station worse by being looked at.
 *
 * It is also what makes the on-demand path and the format clock the same path: both write a row and
 * send a job, so there is one way a production comes into existence and one place its rules live.
 */
@Injectable()
export class ProductionsService {
    constructor(
        private readonly productions: ProductionRepository,
        private readonly segments: SegmentRepository,
        private readonly jobs: PgBossJobBroker,
        private readonly activity: ActivityRecorder,
        private readonly config: AppConfig,
        private readonly context: AuthorizationContext,
        private readonly logger: Logger,
    ) {}

    /** The operator behind this request, for the activity feed. Absent for anything not a person. */
    private actor(): string | undefined {
        return this.context.actor.kind === 'user' ? this.context.actor.actorId : undefined;
    }

    /** Everything the station has made or is making, newest first. */
    async list(): Promise<ProductionList> {
        const rows = await this.productions.recent();
        const views = await Promise.all(rows.map(async row => await this.view(row)));

        return { productions: views };
    }

    /**
     * Ask the station to make one.
     *
     * Everything the operator did not say falls back to a station default rather than being refused:
     * a title is the only thing nobody else can supply.
     */
    async request(body: ProductionRequest): Promise<ProductionView> {
        return await this.commission(body);
    }

    /** One of the station's own shows' episodes, newest first, as the Productions page shows them. */
    async listForShow(showId: string): Promise<ProductionList> {
        const rows = await this.productions.forShow(showId);
        const views = await Promise.all(rows.map(async row => await this.view(row)));

        return { productions: views };
    }

    /**
     * The one way a production is asked for, from the Productions page and from one of the station's
     * own shows alike, so an episode of a show is queued and made exactly as any other production is.
     * `filing` is what a caller knows that the request does not carry: which show it is an episode of.
     */
    async commission(body: ProductionRequest, filing: { showId?: string } = {}): Promise<ProductionView> {
        // A source is read from its text, or from its address by the research pass. One with neither
        // is nothing to read, and an address that is not a web page's is refused here rather than
        // accepted and failed later by a pass with nothing to fetch.
        for (const source of body.sources ?? []) {
            const hasText = (source.text ?? '').trim().length > 0;
            const url = source.url?.trim() ?? '';
            if (!hasText && url.length === 0) {
                throw httpError(400).withDetails({ message: `the source "${source.title}" has neither text nor an address to read` });
            }
            if (url.length > 0 && !isWebAddress(url)) {
                throw httpError(400).withDetails({ message: `"${url}" is not the address of a web page` });
            }
        }

        const kind = body.kind ?? DEFAULT_KIND;
        const production = await this.productions.open({
            kind,
            // Named after its kind and the moment, exactly as a band-commissioned one is, when
            // nobody said. Somebody taking a call now is not naming a programme, and a required box
            // there would be a form standing between an operator and a button.
            title: body.title ?? titleFor(kind, Date.now(), stationZone(this.config)),
            // Kind-aware, so asking for a `callin` with no length gets a phone call rather than a
            // ten-minute one. An operator who typed a number still gets exactly that.
            targetMs: body.targetMs ?? stationTargetMs(this.config, kind),
            writingMode: body.writingMode ?? stationWritingMode(this.config),
            ...(body.brief === undefined ? {} : { brief: body.brief }),
            ...(body.notes === undefined ? {} : { notes: body.notes }),
            ...(body.sources === undefined ? {} : { sources: body.sources }),
            ...(body.research === true ? { research: true } : {}),
            ...(body.personaId === undefined ? {} : { personaId: body.personaId }),
            ...(body.scheduledFor === undefined ? {} : { scheduledFor: body.scheduledFor.toMillis() }),
            ...(this.actor() === undefined ? {} : { actorId: this.actor() as string }),
            ...(filing.showId === undefined ? {} : { showId: filing.showId }),
        });

        // Queued rather than started. The job is what runs the first pass, and it runs it at whatever
        // priority `priorityForSlot` says this production's slot is worth.
        await this.jobs.send('director.produce', { productionId: production.id, pass: firstPass(production) });

        this.logger.info('productions: an operator asked for a production', {
            production: production.id,
            kind: production.kind,
            mode: production.writingMode,
        });
        void this.activity.record({
            // `render` rather than a module of its own: `station_events.module` is a coarse AREA
            // with a check constraint on it, and a production is the render path at length — its beats
            // are segments and its output is spoken audio.
            module: 'render',
            kind: 'production.requested',
            detail: `The station was asked to make "${production.title}".`,
            data: { productionId: production.id, kind: production.kind, writingMode: production.writingMode },
            ...(this.actor() === undefined ? {} : { actorId: this.actor() as string }),
        });

        return await this.view(production);
    }

    /**
     * Stop one, terminally.
     *
     * Refused for a production that has already settled, which is what stops cancelling something
     * that aired from rewriting the record into saying it never did.
     */
    async cancel(id: string): Promise<ProductionView> {
        const existing = await this.productions.findById(id);
        if (existing === undefined) throw httpError(404).withDetails({ message: `production "${id}" does not exist` });

        const stopped = await this.productions.cancel(id);
        // Refused rather than quietly accepted: cancelling something that already aired would make
        // the record say it never went out.
        if (!stopped) throw httpError(409).withDetails({ message: `that production is already ${existing.state} and cannot be stopped` });

        this.logger.info('productions: an operator stopped a production', { production: id, was: existing.state });
        void this.activity.record({
            module: 'render',
            kind: 'production.cancelled',
            detail: `Making "${existing.title}" was stopped.`,
            data: { productionId: id, was: existing.state },
            ...(this.actor() === undefined ? {} : { actorId: this.actor() as string }),
        });

        // Read back rather than assumed, so the answer carries the row as it now stands — including
        // when it was stopped, which the caller has no other way to know.
        const after = await this.productions.findById(id);
        return await this.view(after ?? existing);
    }

    /**
     * One row as the console reads it.
     *
     * The beat COUNT rather than the beats: a list page wants to know how far along the drafting is,
     * and a page showing twenty productions should not read a hundred segments to say so.
     */
    private async view(production: Production): Promise<ProductionView> {
        const beats = await this.segments.beatsOf(production.id);

        return {
            id: production.id,
            kind: production.kind,
            title: production.title,
            ...(production.brief === undefined ? {} : { brief: production.brief }),
            ...(production.notes === undefined ? {} : { notes: [...production.notes] }),
            ...(production.sources === undefined
                ? {}
                : {
                      sources: production.sources.map(source => ({
                          title: source.title,
                          ...(source.url === undefined ? {} : { url: source.url }),
                          ...(source.text === undefined ? {} : { text: source.text }),
                      })),
                  }),
            ...(production.personaId === undefined ? {} : { personaId: production.personaId }),
            writingMode: production.writingMode,
            targetMs: production.targetMs,
            state: production.state,
            ...(production.error === undefined ? {} : { error: production.error }),
            ...(production.scheduledFor === undefined ? {} : { scheduledFor: DateTime.fromMillis(production.scheduledFor) }),
            ...(production.cancelledAt === undefined ? {} : { cancelledAt: DateTime.fromMillis(production.cancelledAt) }),
            ...(production.research === true ? { research: true } : {}),
            ...(production.showId === undefined ? {} : { showId: production.showId }),
            beats: beats.length,
            // Who is on it. The stored snapshot rather than a fresh resolve, which is the whole
            // reason the cast is a column: the persona it names may have been edited or deleted
            // since, and what an operator is reading back is what the turns were written as.
            cast: (production.casting ?? []).map(member => ({
                role: member.role,
                ...(member.name === undefined ? {} : { name: member.name }),
                ...(member.personaKey === undefined ? {} : { persona: member.personaKey }),
            })),
            createdAt: DateTime.fromMillis(production.createdAt),
        };
    }
}

/** Whether an address is one a plugin could open as a web page: http or https, with a host. */
export function isWebAddress(url: string): boolean {
    try {
        const parsed = new URL(url);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0;
    } catch {
        return false;
    }
}
