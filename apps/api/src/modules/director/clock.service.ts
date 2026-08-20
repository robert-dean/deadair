import { Injectable } from 'injectkit';
import { ClockBandRepository } from './clock.band.repository.js';
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
    ) {}

    async list(): Promise<ClockBandList> {
        return { bands: (await this.bands.list()).map(forTheWire) };
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
