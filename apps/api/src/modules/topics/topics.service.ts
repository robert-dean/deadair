import { httpError } from '@maroonedsoftware/errors';
import { Injectable } from 'injectkit';
import { packOfTopics, planTopicPack, TOPIC_PACK_VERSION, type TopicPackReading } from './topic.pack.js';
import { TopicKindRegistry } from './topic.kind.registry.js';
import { TopicRepository } from './topic.repository.js';
import { topicKeyOf, type Topic as StoredTopic } from './topic.js';
import type { PackImportPlan, Topic, TopicImportResult, TopicInput, TopicKindList, TopicList, TopicPack, TopicQuery } from './types/topics.types.js';

/**
 * The station's vocabulary, as an operator edits it.
 *
 * The console's half of {@link TopicRepository}, thin for `ClockService`'s reason: what a subject
 * MEANS is decided by the kind that declared it, and the only judgement here is that a key is a
 * slug — which is not cosmetic. The key is what the format clock points a band at and what a log
 * line names, so a label typed with a capital and a space would produce a subject nothing could
 * refer to twice the same way.
 *
 * ## Every answer is the whole list
 *
 * The same call the schedule, the clock and the personas make: these rows are read together, and a
 * caller handed back only the row it named is holding a list it has to refetch.
 *
 * ## A kind nobody declared is still writable
 *
 * `create` does not refuse a `kind` the registry has never heard of. A row naming one is inert —
 * nothing asks for a subject of a kind that cannot have one — and refusing it would make this
 * service the second place that decides what kinds exist, which is a fact about what the station can
 * PRODUCE rather than about what an operator may write down.
 */
@Injectable()
export class TopicsService {
    constructor(
        private readonly topics: TopicRepository,
        private readonly kindRegistry: TopicKindRegistry,
    ) {}

    async list(query: TopicQuery): Promise<TopicList> {
        const kind = query.kind?.trim();

        return { topics: await this.topics.list(kind === undefined || kind.length === 0 ? undefined : kind) };
    }

    /**
     * What this station's breaks can have subjects for, and how one is written.
     *
     * Answered from the registry rather than from the rows, deliberately: a station that has deleted
     * every news category still has a `news` kind, and a page built from the rows alone would have
     * no way back from an empty list.
     */
    kinds(): TopicKindList {
        return {
            kinds: this.kindRegistry.all().map(kind => ({
                kind: kind.kind,
                nounOne: kind.noun.one,
                nounMany: kind.noun.many,
                description: kind.description,
                fields: kind.fields,
            })),
        };
    }

    async create(input: TopicInput): Promise<TopicList> {
        await this.topics.create(draftOf(input));
        return await this.list({});
    }

    /**
     * Answers the list as it now stands whether or not the id was one of this station's.
     *
     * A subject edited from two tabs, or deleted underneath a form, is a stale request rather than a
     * fault, and the answer to it is the same as the answer to any read: here is the vocabulary.
     */
    async update(id: string, input: TopicInput): Promise<TopicList> {
        await this.topics.update(id, draftOf(input));
        return await this.list({});
    }

    async remove(id: string): Promise<TopicList> {
        await this.topics.remove(id);
        return await this.list({});
    }

    /** `GET /topics/export`. */
    async exportPack(): Promise<TopicPack> {
        return packOfTopics(await this.topics.list());
    }

    /** `POST /topics/import/preview`. Writes nothing. */
    async previewImport(body: TopicPack): Promise<PackImportPlan> {
        return planOf(body, await this.readPack(body));
    }

    /**
     * `POST /topics/import`. Only ever adds, and a key this station already holds is left exactly as it is.
     *
     * All or nothing, by the request's own transaction: the preview is what stands between an operator
     * and a surprise, so a file that landed halfway would be the one outcome nothing had described.
     */
    async importPack(body: TopicPack): Promise<TopicImportResult> {
        const reading = await this.readPack(body);
        // Before anything is written, since this is also what refuses a version it cannot read.
        const plan = planOf(body, reading);
        for (const draft of reading.adding) await this.topics.create(draft);
        return { plan, list: await this.list({}) };
    }

    private async readPack(body: TopicPack): Promise<TopicPackReading> {
        const declared = new Set(this.kindRegistry.all().map(kind => kind.kind));
        return planTopicPack(body, await this.topics.list(), declared);
    }

    /**
     * Write a kind's own starting vocabulary, on a station that has none of it.
     *
     * The guard is that the station holds NO subjects of this kind rather than that each key is
     * missing, which is `PersonasService.seed`'s rule and is what makes deleting a seeded one
     * expressible: an operator who threw away Sport gets to keep it thrown away.
     *
     * Called from the module that OWNS the kind, so the vocabulary and the code that reads it stay
     * in one place. Answers how many it wrote, for the caller's log.
     */
    async seed(kind: string, drafts: readonly Omit<StoredTopic, 'id'>[]): Promise<number> {
        if ((await this.topics.countFor(kind)) > 0) return 0;

        for (const draft of drafts) await this.topics.create(draft);
        return drafts.length;
    }
}

/** A subject as the form sent it, with its key made referable. */
function draftOf(input: TopicInput): Omit<StoredTopic, 'id'> {
    return {
        kind: input.kind.trim(),
        key: topicKeyOf(input.key, input.label),
        label: input.label.trim(),
        config: input.config ?? {},
        position: input.position,
    };
}

/** What a file would do, in the words the console shows. Refuses a version this station cannot read. */
function planOf(pack: TopicPack, reading: TopicPackReading): PackImportPlan {
    if (pack.version > TOPIC_PACK_VERSION) {
        throw httpError(400).withDetails({
            message: `this station reads version ${TOPIC_PACK_VERSION} of a topics file, and this file is version ${pack.version}`,
        });
    }
    return {
        name: pack.name,
        adding: reading.adding.map(draft => draft.label),
        skipped: reading.skipped,
        dropped: reading.dropped,
        notices: reading.unknownKinds.map(kind => ({
            kind: 'unknown-kind',
            message: `This station has no "${kind}" breaks, so subjects of that kind do nothing here until it does.`,
        })),
    };
}

/** Re-exported so a caller that has a wire topic can hand it on without importing two shapes. */
export type { Topic };
