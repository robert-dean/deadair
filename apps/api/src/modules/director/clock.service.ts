import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { ClockBandRepository } from './clock.band.repository.js';
import { BreakWriterRegistry } from './break.writer.registry.js';
import { productionKinds } from '#modules/productions/production.scheduler.js';
import { NARRATION_KIND } from '#modules/narrations/narration.kind.js';
import { NarrationsService } from '#modules/narrations/narrations.service.js';
import { SYNDICATED_KIND } from '#modules/podcasts/syndicated.kind.js';
import { PodcastsService } from '#modules/podcasts/podcasts.service.js';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { SpeechService } from '#modules/render/speech.service.js';
import { TopicRepository } from '#modules/topics/topic.repository.js';
import type { PackImportPlan } from '#modules/topics/types/topics.types.js';
import type { ClockBand as StoredBand, ClockBandDraft, ClockBandRecord } from './clock.bands.js';
import { CLOCK_PACK_VERSION, packOfClock, planClockPack, type ClockPackReading } from './clock.pack.js';
import type { ClockBand, ClockBandInput, ClockBandList, ClockImportResult, ClockPack } from './types/clock.types.js';

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
        private readonly podcasts: PodcastsService,
        private readonly narrations: NarrationsService,
    ) {}

    async list(): Promise<ClockBandList> {
        return {
            bands: (await this.bands.list()).map(forTheWire),
            producibleKinds: producibleKinds({
                writable: this.writers.kinds(),
                hasVoice: this.speech.speaker() !== undefined,
                recorded: await this.segments.readyKinds(),
                produced: [...productionKinds(this.config)],
                carried: [
                    ...(this.podcasts.hasPodcasts() ? [SYNDICATED_KIND] : []),
                    // The other kind the station carries rather than writes. Listed here or the
                    // console calls the band unproducible while the planner happily fills it, which
                    // is the disagreement `producibleKinds` exists to prevent.
                    ...(this.narrations.hasNarrations() ? [NARRATION_KIND] : []),
                ],
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
        const stored = input.hard === undefined ? (await this.bands.list()).find(band => band.id === id) : undefined;
        await this.bands.update(id, await this.draftOf(keepingHard(input, stored)));
        return await this.list();
    }

    async remove(id: string): Promise<ClockBandList> {
        await this.bands.remove(id);
        return await this.list();
    }

    /** `GET /clock/export`. */
    async exportPack(): Promise<ClockPack> {
        return packOfClock(await this.bands.list(), await this.topics.list());
    }

    /** `POST /clock/import/preview`. Writes nothing. */
    async previewImport(body: ClockPack): Promise<PackImportPlan> {
        return planOf(body, await this.readPack(body), (await this.list()).producibleKinds);
    }

    /**
     * `POST /clock/import`. Adds the file's bands after this station's own, switched off, along with the
     * subjects they need. Changes nothing the station already has, and the planner reads bands on each pass,
     * so there is nothing else to tell.
     *
     * All or nothing, by the request's own transaction: the preview is what stands between an operator and
     * a surprise, so a file that landed halfway would be the one outcome nothing had described.
     */
    async importPack(body: ClockPack): Promise<ClockImportResult> {
        const reading = await this.readPack(body);
        // Before anything is written, since this is also what refuses a version it cannot read.
        const plan = planOf(body, reading, (await this.list()).producibleKinds);

        for (const draft of reading.addingTopics) await this.topics.create(draft);

        const subjects = await this.topics.list();
        for (const band of reading.adding) {
            const subject =
                band.subjectKey === undefined ? undefined : subjects.find(topic => topic.kind === band.shape.kind && topic.key === band.subjectKey);
            await this.bands.create({
                ...band.shape,
                ...(subject === undefined ? {} : { topic: { id: subject.id, key: subject.key, label: subject.label } }),
                position: band.position,
                enabled: false,
            });
        }

        return { plan, list: await this.list() };
    }

    private async readPack(body: ClockPack): Promise<ClockPackReading> {
        return planClockPack(body, await this.bands.list(), await this.topics.list());
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
                : {
                      at: 'clock',
                      minute: input.minute ?? 0,
                      ...(input.hour === undefined ? {} : { hour: input.hour }),
                      ...(input.days === undefined || input.days.length === 0 ? {} : { days: input.days }),
                      ...(input.hard === true ? { hard: true } : {}),
                      kind: input.kind,
                  };

        return { ...shape, ...(await subjectFor(this.topics, input)), position: input.position, enabled: input.enabled };
    }
}

/** What a file would do, in the words the console shows. Refuses a version this station cannot read. */
function planOf(pack: ClockPack, reading: ClockPackReading, producible: readonly string[]): PackImportPlan {
    if (pack.version > CLOCK_PACK_VERSION) {
        throw httpError(400).withDetails({
            message: `this station reads version ${CLOCK_PACK_VERSION} of a clock file, and this file is version ${pack.version}`,
        });
    }

    const kinds = [...new Set(reading.adding.map(band => band.shape.kind))];
    return {
        name: pack.name,
        adding: reading.adding.map(band => band.words),
        skipped: reading.skipped,
        dropped: reading.dropped,
        notices: [
            ...reading.addingTopics.map(topic => ({
                kind: 'new-subject',
                message: `Also adds the subject "${topic.label}" to ${topic.kind}, which a band here asks for.`,
            })),
            ...kinds
                .filter(kind => !producible.includes(kind))
                .map(kind => ({
                    kind: 'cannot-produce',
                    message: `Nothing on this station can make a "${kind}" break yet, so a band for it would pass over its slots.`,
                })),
        ],
    };
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
 * Programmes the station carries are the fourth, and belong to nobody's writer either: a `syndicated`
 * band is filled by the planner with an episode a podcast plugin listed, so it is producible exactly
 * when a podcast plugin is there to list one. Whether a particular show has anything new tonight is a
 * question for the night, and the band declines on its own when it has not.
 *
 * Sorted, so the console's suggestion list does not reshuffle between reads for no reason.
 */
export function producibleKinds(station: StationCapability): string[] {
    const kinds = new Set([...(station.hasVoice ? station.writable : []), ...station.recorded, ...station.produced, ...station.carried]);

    return [...kinds].sort((left, right) => left.localeCompare(right));
}

/** The ways a station can fill a band, as {@link producibleKinds} weighs them. */
export interface StationCapability {
    /** Kinds something knows how to write, whether or not there is anything to speak them. */
    writable: readonly string[];
    /** Whether a speech plugin is installed and chosen. */
    hasVoice: boolean;
    /** Kinds the segment library holds `ready` audio of. */
    recorded: readonly string[];
    /** Kinds made as episodes rather than at a boundary. See `render.productionKinds`. */
    produced: readonly string[];
    /** Kinds carried from somebody else: `syndicated`, when a podcast plugin can list episodes. */
    carried: readonly string[];
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

/**
 * A rewrite that does not mention `hard` keeps the stored one, and only an explicit `false` makes a band soft
 * again.
 *
 * `PUT` replaces the row, and a console built before hard markers existed (an older desktop build, a browser
 * tab opened before the release) sends every field it knows on a reorder or a save and never this one, so
 * without this a reorder from one of them would quietly turn the nine o'clock news soft. `keepingRecurrence`
 * on a slot is the same bargain for the same builds.
 */
export function keepingHard(input: ClockBandInput, stored: ClockBandRecord | undefined): ClockBandInput {
    if (input.hard !== undefined || input.at !== 'clock') return input;
    return stored !== undefined && stored.at === 'clock' && stored.hard === true ? { ...input, hard: true } : input;
}

/** `undefined` for the half this band does not have, because the contract's fields are optional. */
const forTheWire = (band: ClockBandRecord): ClockBand => ({
    id: band.id,
    kind: band.kind,
    at: band.at,
    position: band.position,
    enabled: band.enabled,
    ...(band.at === 'clock'
        ? {
              minute: band.minute,
              ...(band.hour === undefined ? {} : { hour: band.hour }),
              ...(band.days === undefined ? {} : { days: [...band.days] }),
              ...(band.hard === true ? { hard: true } : {}),
          }
        : { everyMs: band.everyMs }),
    ...(band.topic === undefined ? {} : { topicId: band.topic.id, topicLabel: band.topic.label }),
});
