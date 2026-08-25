import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { isAnchored, nextOccurrence } from '#modules/director/clock.bands.js';
import { ClockBandRepository } from '#modules/director/clock.band.repository.js';
import { stationZone } from '#modules/director/clock.words.js';
import { errorText } from '#modules/shared/error.text.js';
import { firstPass } from './production.passes.js';
import { dialogueKinds, stationTargetMs, stationWritingMode } from './production.settings.js';
import { ProductionRepository } from './production.repository.js';

/**
 * Which band kinds mean "make a production" rather than "say something here".
 *
 * A setting rather than a constant, because `segments.kind` is free text by design and a station that
 * wants a documentary strand should not need a migration — or a code change — to schedule one.
 */
export const PRODUCTION_KINDS_KEY = 'render.productionKinds';

/**
 * The kinds a station makes as productions unless it says otherwise.
 *
 * `callin` joined `podcast` with the caller work, so a band naming one is commissioned rather than
 * filled with a break. Nothing happens until an operator writes that band — which is the same
 * posture `rotation.discover` takes, and the alternative is a feature that is inert until somebody
 * finds a setting.
 */
export const DEFAULT_PRODUCTION_KINDS = 'podcast,callin';

/**
 * How far ahead of its slot a production is commissioned.
 *
 * Generous, and the asymmetry is deliberate: too early costs a production that sits finished for a
 * while, and too late costs a slot with nothing in it. Making one is several model calls on a
 * self-hosted model, and the whole point of a scheduled production is that it is ready when its time
 * comes.
 */
export const COMMISSION_AHEAD_MS = 3 * 60 * 60_000;

/** The kinds this station treats as productions, as a set. */
export function productionKinds(config: AppConfig): Set<string> {
    return new Set(
        config
            .get(PRODUCTION_KINDS_KEY, DEFAULT_PRODUCTION_KINDS)
            .split(',')
            .map(kind => kind.trim().toLowerCase())
            .filter(kind => kind.length > 0),
    );
}

/**
 * Whether a band naming this kind wants a production rather than a break.
 *
 * Read by `BreakPlanner` as well as here, which is the point of it being one function: the two have
 * to agree, or a band is either filled twice or not at all.
 */
export const isProductionKind = (kind: string, config: AppConfig): boolean => productionKinds(config).has(kind.trim().toLowerCase());

/**
 * What the broadcast this is being commissioned INSIDE was asked to be.
 *
 * Passed in by the director rather than read here, because the running order lives in the director's
 * memory and this is one indexed read on a commit pass. Both halves are absent for a station airing
 * a playlist with no brief and no host of its own, which is an ordinary broadcast.
 */
export interface BroadcastContext {
    /** What the operator asked the station to be, in their own words. */
    brief?: string;
    /** Who is hosting the show, when it named somebody. */
    personaId?: string;
    /** This broadcast's own id, which is what a standing commission is spaced against. */
    broadcastId?: string;
    /** Whether this broadcast takes calls at all. `ResolvedRules.callins`. */
    callins?: boolean;
    /** Minutes of airtime between one call and the next. `ResolvedRules.callinEveryMinutes`. */
    callinEveryMinutes?: number;
}

/**
 * Commission the productions the format clock has asked for, ahead of their slots.
 *
 * ## Why a band cannot simply be filled at its boundary
 *
 * Every other clock band is a break: the planner reaches the boundary, asks a writer for a sentence,
 * and puts it in. A production cannot work that way, because making one is minutes to hours of model
 * time. By the time the boundary arrives it is far too late to start.
 *
 * So a production band is read AHEAD: the scheduler looks at what the clock will want within
 * {@link COMMISSION_AHEAD_MS}, writes the row now with `scheduled_for` set to the slot, and lets the
 * pass chain get on with it. The slot is what `priorityForSlot` then reads — background while it is
 * hours away, on-air work as it approaches — which is the whole of the starvation answer.
 *
 * ## It writes a REQUEST, exactly as the console does
 *
 * Both ways in post a row and send the first pass. That is what keeps them one path with one set of
 * rules rather than two things that drift, and it is why nothing here runs a pass itself.
 *
 * ## Idempotence is by slot, not by memory
 *
 * Run every commit pass, so it has to be safe to run constantly. It is, because it asks the table
 * whether a production is already scheduled for that instant — memory would forget across exactly
 * the restart that makes a double-commission most likely, which is the same argument
 * `break_requests` makes for its dedupe key being a column.
 */
@Injectable()
export class ProductionScheduler {
    constructor(
        private readonly productions: ProductionRepository,
        private readonly bands: ClockBandRepository,
        private readonly jobs: PgBossJobBroker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Commission anything the clock wants soon and nothing is being made for yet.
     *
     * Answers how many it started, for the caller's log. Everything is swallowed: a scheduler that
     * threw would take the commit pass with it, and a production nobody commissioned costs a slot
     * where the station falls back to ordinary programming.
     */
    async ripen(now = Date.now(), show: BroadcastContext = {}): Promise<number> {
        try {
            return (await this.fromTheClock(now, show)) + (await this.standing(now, show));
        } catch (error) {
            this.logger.warn(`productions: could not commission what was asked for (${errorText(error)})`);
            return 0;
        }
    }

    /**
     * What the format clock wants soon and nothing is being made for yet.
     *
     * A band is a TIME: the station makes this thing at twenty to the hour whatever else is going on.
     * See {@link standing} for the other half, which is a property of the show rather than of the
     * clock — the two are separate because a broadcast that takes calls does not want one at a fixed
     * minute past, and a `:40 podcast` wants one whether or not anybody is briefing the station.
     */
    private async fromTheClock(now: number, show: BroadcastContext): Promise<number> {
        const kinds = productionKinds(this.config);
        const anchored = (await this.bands.active()).filter(isAnchored).filter(band => kinds.has(band.kind.trim().toLowerCase()));
        if (anchored.length === 0) return 0;

        const zone = stationZone(this.config);
        const scheduled = await this.productions.scheduledAfter(now);
        let started = 0;

        for (const band of anchored) {
            const at = nextOccurrence(band, now, zone);
            if (at - now > COMMISSION_AHEAD_MS) continue;

            // Already being made for that instant. The table is the memory, so a restart in the
            // middle of an hour does not commission a second one.
            if (scheduled.some(existing => existing.kind === band.kind && existing.scheduledFor === at)) continue;

            const production = await this.productions.open({
                kind: band.kind,
                title: titleFor(band.kind, at, zone),
                // Kind-aware: a `callin` band is a three-minute phone call and a `podcast` band
                // is a programme, and one number for both makes whichever it was not.
                targetMs: stationTargetMs(this.config, band.kind),
                writingMode: stationWritingMode(this.config),
                scheduledFor: at,
                // What SHOW this is inside. Without it a `:40 callin` on a heavy-metal broadcast
                // is a phone-in about nothing in particular, presented by the station's default
                // persona rather than by the person whose show it is — because `presenting`
                // falls back the moment nobody names a host. The block airs inside somebody
                // else's programme, so it belongs to that programme.
                ...(show.brief === undefined || show.brief.trim().length === 0 ? {} : { brief: show.brief.trim() }),
                ...(show.personaId === undefined ? {} : { personaId: show.personaId }),
            });

            await this.jobs.send('director.produce', { productionId: production.id, pass: firstPass(production.writingMode) });
            started += 1;

            this.logger.info('productions: the station clock asked for a production', {
                production: production.id,
                kind: band.kind,
                at: new Date(at).toISOString(),
            });
        }

        return started;
    }

    /**
     * The call this broadcast keeps taking, if it was told to take them.
     *
     * ## Why this is not a band
     *
     * A clock band is a TIME: the station makes a thing at twenty to the hour whatever else is going
     * on. A broadcast that takes calls is not about the clock at all — it is a property of the show,
     * it lasts exactly as long as the show does, and an operator who set it while briefing the
     * station is describing this hour rather than every hour. So the spacing is measured from the
     * last call this BROADCAST aired, and a new broadcast starts the count again.
     *
     * ## Idempotence, on the same terms as a slot
     *
     * By table read rather than by memory. One unsettled call-in for this broadcast means one is
     * coming and nothing else is commissioned, which is what stops a commit pass every few seconds
     * from queueing a switchboard. That guard has to come first: a call takes minutes to write, and
     * the spacing clock does not start until it AIRS.
     *
     * The first one goes out as soon as the broadcast can make it, deliberately. A station told to
     * take calls and then made to wait half an hour for the first is one an operator assumes is
     * broken.
     */
    private async standing(now: number, show: BroadcastContext): Promise<number> {
        const every = show.callinEveryMinutes ?? 0;
        if (show.callins !== true || every <= 0 || show.broadcastId === undefined) return 0;

        const kind = [...dialogueKinds(this.config)][0];
        // A station whose operator emptied the dialogue kinds has said there are no conversations,
        // which is a coherent thing to have said. There is nothing to commission.
        if (kind === undefined) return 0;

        const { pending, lastAiredAt } = await this.productions.standingIn(show.broadcastId, kind);
        if (pending) return 0;
        if (lastAiredAt !== undefined && now - lastAiredAt < every * 60_000) return 0;

        const production = await this.productions.open({
            kind,
            title: titleFor(kind, now, stationZone(this.config)),
            targetMs: stationTargetMs(this.config, kind),
            writingMode: stationWritingMode(this.config),
            // No `scheduledFor`: it airs when it is ready rather than at an instant somebody chose,
            // which is also what keeps it `background` at the model for its whole life. Nothing is
            // waiting on air for it.
            ...(show.brief === undefined || show.brief.trim().length === 0 ? {} : { brief: show.brief.trim() }),
            ...(show.personaId === undefined ? {} : { personaId: show.personaId }),
        });

        await this.jobs.send('director.produce', { productionId: production.id, pass: firstPass(production.writingMode) });
        this.logger.info('productions: this broadcast takes calls, so somebody is being put on the phone', {
            production: production.id,
            kind,
            everyMinutes: every,
        });

        return 1;
    }
}

/**
 * What to call a production nobody named.
 *
 * The kind and its slot, which is what a schedule actually produces: an operator looking at a list
 * of them wants to know which one is tonight's rather than reading twelve rows called "Podcast".
 */
export function titleFor(kind: string, at: number, zone: string): string {
    const when = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(new Date(at));
    return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}, ${when}`;
}
