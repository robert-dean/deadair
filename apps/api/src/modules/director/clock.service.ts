import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ClockBandRepository } from './clock.band.repository.js';
import { BreakWriterRegistry } from './break.writer.registry.js';
import { productionKinds } from '#modules/productions/production.scheduler.js';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { SpeechService } from '#modules/render/speech.service.js';
import { TopicRepository } from '#modules/topics/topic.repository.js';
import type { ClockBand as StoredBand, ClockBandDraft, ClockBandRecord } from './clock.bands.js';
import type { ClockBand, ClockBandInput, ClockBandList } from './types/clock.types.js';

/**
 * The format clock, as an operator edits it.
 *
 * The console's half of `ClockBandRepository`, and thin on purpose: what a band MEANS is decided by
 * the planner walking the running order, and the only judgement here is turning a form's two shapes
 * into the one a row can hold. `ScheduleService` is the same shape for the same reason, and the one
 * thing it does that this does not is refuse an overlap — bands cannot overlap, because two rules
 * wanting one boundary is a settled question: the earlier position takes it.
 *
 * ## Every answer is the whole clock
 *
 * Order IS preference, so an edit that moves one band changes how the ones around it are read. A
 * caller handed back only the row it named would be holding a list it has to refetch anyway, which
 * is the call the schedule and the personas already made.
 *
 * ## The answer carries what the station can PRODUCE, as well as what it has asked for
 *
 * A band's kind is free text, so a clock can name a sort of break nothing on this station can make:
 * a `weather` band before the plugin exists, a `sponsor` band before the recordings are dropped in.
 * The planner already handles it (the slot is claimed and then passed over) and says so once per
 * pass in a log line, which is nowhere an operator looks. `producibleKinds` puts the same fact on
 * the page that edits the rule. See {@link producibleKinds} for why it must agree with the planner.
 *
 * ## Nothing here tells the director anything
 *
 * A band is read on the next commit pass, off the table, so there is no invalidation to send and
 * nothing to keep in step. That is the whole reason the planner reads the rules per pass rather
 * than holding them: a rule an operator changed applies at the next boundary without anybody
 * having to notice it changed.
 */
@Injectable()
export class ClockService {
    constructor(
        private readonly bands: ClockBandRepository,
        private readonly topics: TopicRepository,
        private readonly writers: BreakWriterRegistry,
        private readonly speech: SpeechService,
        private readonly segments: SegmentRepository,
        private readonly config: AppConfig,
    ) {}

    async list(): Promise<ClockBandList> {
        return {
            bands: (await this.bands.list()).map(forTheWire),
            producibleKinds: producibleKinds({
                writable: this.writers.kinds(),
                hasVoice: this.speech.speaker() !== undefined,
                recorded: await this.segments.readyKinds(),
                produced: [...productionKinds(this.config)],
            }),
        };
    }

    async create(input: ClockBandInput): Promise<ClockBandList> {
        await this.bands.create(await this.draftOf(input));
        return await this.list();
    }

    /**
     * Answers the clock as it now stands whether or not the id was one of this station's.
     *
     * A band edited from two tabs, or one deleted underneath a form, is a stale request rather than
     * a fault, and the answer to it is the same as the answer to any other read: here is the clock.
     */
    async update(id: string, input: ClockBandInput): Promise<ClockBandList> {
        await this.bands.update(id, await this.draftOf(input));
        return await this.list();
    }

    async remove(id: string): Promise<ClockBandList> {
        await this.bands.remove(id);
        return await this.list();
    }

    /**
     * A band as the form sent it.
     *
     * The two shapes are exclusive in the table, so the half that does not belong to this band's
     * `at` is dropped here rather than written and ignored: a `clock` row carrying an `everyMs` from
     * whichever shape the form was showing a moment ago is a row that contradicts itself, and the
     * check constraint would refuse it — correctly, and with an error nobody could act on.
     */
    private async draftOf(input: ClockBandInput): Promise<ClockBandDraft> {
        const shape: StoredBand =
            input.at === 'interval'
                ? { at: 'interval', everyMs: input.everyMs ?? 60_000, kind: input.kind }
                : { at: 'clock', minute: input.minute ?? 0, ...(input.hour === undefined ? {} : { hour: input.hour }), kind: input.kind };

        return { ...shape, ...(await subjectFor(this.topics, input)), position: input.position, enabled: input.enabled };
    }
}

/**
 * What the station is currently able to make a break out of.
 *
 * **This has to give the same answer `BreakPlanner.fillBand` does**, which is why the two clauses
 * are its two branches in its own order: something that can WRITE the kind and a voice to speak it
 * in, or a recording of that kind on the shelf. A console that disagreed with the planner would be
 * reporting the opposite of what the station does, which is worse than reporting nothing.
 *
 * The voice gates the writable half rather than sitting beside it, because a script nothing can
 * speak is a break that is planted, written, and then skipped at every slot it is ever given. The
 * shelf is unaffected: those recordings are already audio.
 *
 * Production kinds are the third clause and belong to nobody's writer. A `podcast` band is honoured
 * by `ProductionScheduler`, which reads the same bands hours ahead of their slots, so leaving it out
 * would have the console call the one kind with the most work behind it unproducible.
 *
 * Sorted, so the console's suggestion list does not reshuffle between reads for no reason.
 */
export function producibleKinds(station: StationCapability): string[] {
    const kinds = new Set([...(station.hasVoice ? station.writable : []), ...station.recorded, ...station.produced]);

    return [...kinds].sort((left, right) => left.localeCompare(right));
}

/** The three ways a station can make a break, as {@link producibleKinds} weighs them. */
export interface StationCapability {
    /** Kinds something knows how to write, whether or not there is anything to speak them. */
    writable: readonly string[];
    /** Whether a speech plugin is installed and chosen. */
    hasVoice: boolean;
    /** Kinds the segment library holds `ready` audio of. */
    recorded: readonly string[];
    /** Kinds made as episodes rather than at a boundary. See `render.productionKinds`. */
    produced: readonly string[];
}

/**
 * A subject the caller named, resolved against this station's own.
 *
 * Looked up rather than trusted, and dropped rather than refused when it is not one of this
 * station's: an id from a page opened before somebody deleted a category is a stale request, and the
 * answer to it is a band that covers whatever it finds — which is what the band would have been if
 * the subject had gone a moment later, since the column cascades. Refusing would turn a stale form
 * into an error an operator cannot act on.
 *
 * The kind is checked too, because a `news` band pointing at a weather location is a band nothing
 * could ever satisfy.
 */
async function subjectFor(topics: TopicRepository, input: ClockBandInput): Promise<Pick<ClockBandDraft, 'topic'>> {
    if (input.topicId === undefined) return {};

    const held = (await topics.list(input.kind.trim())).find(topic => topic.id === input.topicId);
    return held === undefined ? {} : { topic: { id: held.id, key: held.key, label: held.label } };
}

/** `undefined` for the half this band does not have, because the contract's fields are optional. */
const forTheWire = (band: ClockBandRecord): ClockBand => ({
    id: band.id,
    kind: band.kind,
    at: band.at,
    position: band.position,
    enabled: band.enabled,
    ...(band.at === 'clock' ? { minute: band.minute, ...(band.hour === undefined ? {} : { hour: band.hour }) } : { everyMs: band.everyMs }),
    ...(band.topic === undefined ? {} : { topicId: band.topic.id, topicLabel: band.topic.label }),
});
