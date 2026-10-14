import { Container, Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';
import { CoverResolver } from '#modules/art/cover.resolver.js';
import { announceDeadline } from '#modules/messaging/messaging.announcer.js';
import { listenerArtwork } from '#modules/playout/annotate.js';
import { Rundown, type RundownItem } from '#modules/playout/rundown.js';
import { ProductionRepository } from '#modules/productions/production.repository.js';
import { isRenderItem } from '#modules/render/segment.source.js';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { StationBus, type StationEvents } from '#modules/shared/station.bus.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { resolvePublicUrl } from '#modules/stream/stream.settings.js';
import { PRODUCTION_STARTED, PROGRAMME_STARTED, STATION_OFF_AIR, STATION_ON_AIR, TALK_STARTED, TRACK_STARTED } from './event.catalogue.js';
import { EventDestinationsRepository } from './event.destinations.repository.js';
import { eventEnvelope, eventStation } from './event.envelope.js';
import type { DeliverPayload } from './event.deliverer.js';
import type { ProductionStartedData, ProgrammeStartedData, StationAirData, TalkStartedData, TrackStartedData } from './types/events.types.js';

/** What a segment that aired turned out to be, from the reads only a segment needs. */
export interface SegmentFacts {
    kind: string;
    /** Set for a beat of a production and for its joined row alike. */
    productionId?: string;
    /** The production itself, when it could be read. */
    production?: { kind: string; title: string };
}

/**
 * How long news of the station going on or off air stays worth sending. A light left in the wrong
 * state for ten minutes is already wrong; past that, the next record or break says what is on.
 */
export const AIR_CHANGE_WINDOW_MS = 10 * 60_000;

/** One aired item, or the station going on or off air, as the event it becomes. */
export interface AiredEvent {
    type: string;
    data: TrackStartedData | TalkStartedData | ProductionStartedData | ProgrammeStartedData | StationAirData;
    /** Epoch milliseconds past which this is false rather than late; see `announceDeadline`. */
    notAfter: number;
}

/**
 * What an item that just aired is, as an event, or nothing when it is not one.
 *
 * Pure, so the rules can be read and tested in one place:
 *
 * - **A record** is `track.started`, unless it has no title (a placeholder the transport filled).
 * - **A programme** (a podcast episode, a reading) is `programme.started`. The rundown item already
 *   carries the show and the episode, the same fields the mount shows, so no read is needed. Which of
 *   the two it is follows `stationVoiced`: the station spoke a reading itself, and an episode is
 *   somebody else's master.
 * - **A segment of a production** is `production.started`, once: the caller says whether this
 *   production already fired, because a station without a mixer airs a production as a block of
 *   beats, and a phone-in announced seven times is seven lies about it starting.
 * - **Any other segment** is `talk.started`, with the segment's own kind.
 * - A segment whose row is gone is nothing: there is no kind to report, and guessing one would make
 *   a receiver act on something the station cannot vouch for.
 */
export function airedEvent(
    item: RundownItem,
    airedAt: number,
    facts: SegmentFacts | undefined,
    options: { artworkUrl?: string; productionAlreadyFired?: boolean } = {},
): AiredEvent | undefined {
    const notAfter = announceDeadline(airedAt, item.durationMs);
    const timing = {
        ...(item.durationMs === undefined ? {} : { durationMs: item.durationMs }),
        ...(item.durationMs === undefined
            ? {}
            : {
                  endsAt: DateTime.fromMillis(airedAt + item.durationMs)
                      .toUTC()
                      .toISO()!,
              }),
    };

    if (!isRenderItem(item)) {
        if (item.title.trim() === '') return undefined;
        const data: TrackStartedData = {
            itemId: item.id,
            title: item.title,
            artists: item.artists,
            artist: item.artists.join(', ') || item.artist,
            ...(item.album === undefined ? {} : { album: item.album }),
            ...(item.year === undefined ? {} : { year: item.year }),
            ...(item.trackId === undefined ? {} : { trackId: item.trackId }),
            ...timing,
            ...(options.artworkUrl === undefined ? {} : { artworkUrl: options.artworkUrl }),
        };
        return { type: TRACK_STARTED, data, notAfter };
    }

    if (item.programme === true) {
        const show = item.artists[0];
        const data: ProgrammeStartedData = {
            itemId: item.id,
            segmentId: item.externalId,
            source: item.stationVoiced === true ? 'narration' : 'podcast',
            ...(show === undefined || show === '' ? {} : { show }),
            episode: item.title,
            ...timing,
        };
        return { type: PROGRAMME_STARTED, data, notAfter };
    }

    if (facts === undefined) return undefined;

    if (facts.productionId !== undefined && facts.production !== undefined) {
        if (options.productionAlreadyFired === true) return undefined;
        const data: ProductionStartedData = {
            itemId: item.id,
            productionId: facts.productionId,
            kind: facts.production.kind,
            title: facts.production.title,
            ...timing,
        };
        return { type: PRODUCTION_STARTED, data, notAfter };
    }

    const data: TalkStartedData = {
        itemId: item.id,
        segmentId: item.externalId,
        kind: facts.kind,
        ...(item.listenerLabel === undefined ? {} : { label: item.listenerLabel }),
        ...timing,
    };
    return { type: TALK_STARTED, data, notAfter };
}

/** The station going on or off air, as the event it becomes. */
export function airChangedEvent(change: StationEvents['air.changed']): AiredEvent {
    const data: StationAirData = { reason: change.reason, ...(change.programme === undefined ? {} : { programme: change.programme }) };
    return { type: change.on ? STATION_ON_AIR : STATION_OFF_AIR, data, notAfter: change.at + AIR_CHANGE_WINDOW_MS };
}

/**
 * Telling event destinations what goes on air, as each item is heard.
 *
 * ## Off the transport's aired edge, and not the director's
 *
 * `Rundown.onAired` fires once per item at the moment it is heard, which is what "a track changed"
 * has to mean to a light in somebody's hall: committed to the running order is minutes early, and a
 * production's `production.aired` row is written when it is PLACED. The rundown is in `playout`,
 * before this module, so listening to it needs nobody earlier to know this exists. The listener
 * starts the work and returns, as `onAired` requires: the next item is being fetched behind it.
 *
 * ## A job per destination, and never a queue of its own
 *
 * The house mechanism for slow outbound work that wants retries and that nobody is waiting on, as
 * `MessagingAnnouncer` uses it: one job per destination, so a receiver that is down costs no other
 * its event. Which destinations want this type is asked here, so a destination that wants nothing of
 * it costs no job; the job asks again before sending, so one turned off in between is respected.
 *
 * ## Going on and off air comes over the bus
 *
 * The director decides that, and it is registered long before this module, so it publishes
 * `air.changed` on `StationBus` and this subscribes: the one case the bus exists for, a producer and
 * its subscriber on opposite sides of `modules.ts`. Records and breaks stay on the rundown's own edge.
 */
@Injectable()
export class EventAnnouncer {
    private unsubscribe?: () => void;
    /** The production the last aired item belonged to, so a block of its beats announces once. */
    private lastProductionId?: string;

    private unsubscribeAir?: () => void;

    constructor(
        private readonly rundown: Rundown,
        private readonly bus: StationBus,
        private readonly jobs: PgBossJobBroker,
        // The ROOT container, for `inScope`, as `ActivityRecorder` takes it.
        private readonly container: Container,
        private readonly identity: StationIdentity,
        private readonly config: AppConfig,
        private readonly logger: Logger,
        // Optional only so a test that is not about artwork need not build one, as the pusher has it.
        private readonly covers?: CoverResolver,
    ) {}

    /** Begin announcing. Idempotent. */
    start(): void {
        if (this.unsubscribe !== undefined) return;
        this.unsubscribe = this.rundown.onAired(item => this.aired(item));
        this.unsubscribeAir = this.bus.subscribe(
            'air.changed',
            change =>
                void this.send(airChangedEvent(change), change.at).catch(error =>
                    this.logger.warn(`events: could not announce the station going ${change.on ? 'on' : 'off'} air (${errorText(error)})`),
                ),
        );
    }

    /** Stop announcing. */
    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.unsubscribeAir?.();
        this.unsubscribeAir = undefined;
    }

    private aired(item: RundownItem): void {
        void this.announce(item, Date.now()).catch(error => this.logger.warn(`events: could not announce what aired (${errorText(error)})`));
    }

    /** Send one delivery job per destination that wants this item's event. Answers how many. */
    async announce(item: RundownItem, airedAt: number): Promise<number> {
        const facts = isRenderItem(item) && item.programme !== true ? await this.segmentFacts(item.externalId) : undefined;

        const productionId = facts?.productionId;
        const productionAlreadyFired = productionId !== undefined && productionId === this.lastProductionId;
        this.lastProductionId = productionId;

        const artworkUrl = isRenderItem(item) ? undefined : listenerArtwork(item, resolvePublicUrl(this.config), this.covers);
        const event = airedEvent(item, airedAt, facts, { ...(artworkUrl === undefined ? {} : { artworkUrl }), productionAlreadyFired });
        return event === undefined ? 0 : this.send(event, airedAt);
    }

    /**
     * One delivery job per destination that wants this event. Answers how many.
     *
     * Every event sent here is a STATE event, something now on air or the station now off it, which
     * is what lets a late retry of an older one be dropped rather than undo a newer one.
     */
    async send(event: AiredEvent, occurredAt: number): Promise<number> {
        const destinations = await inScope(this.container, async scope => scope.get(EventDestinationsRepository).subscribedTo(event.type));
        if (destinations.length === 0) return 0;

        const envelope = eventEnvelope(event.type, event.data, eventStation(this.identity, this.config), DateTime.fromMillis(occurredAt));
        for (const destinationId of destinations) {
            const payload: DeliverPayload = { destinationId, envelope, notAfter: event.notAfter, state: true };
            await this.jobs.send('events.deliver', payload);
        }
        return destinations.length;
    }

    private async segmentFacts(segmentId: string): Promise<SegmentFacts | undefined> {
        return inScope(this.container, async scope => {
            const shape = await scope.get(SegmentRepository).kindOf(segmentId);
            if (shape?.productionId === undefined) return shape;

            const production = await scope.get(ProductionRepository).findById(shape.productionId);
            return production === undefined ? shape : { ...shape, production: { kind: production.kind, title: production.title } };
        });
    }
}
