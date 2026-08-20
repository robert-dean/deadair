import { Injectable } from 'injectkit';
import { TopicKindRegistry } from './topic.kind.registry.js';
import { TopicRepository } from './topic.repository.js';
import type { Topic as StoredTopic } from './topic.js';
import type { Topic, TopicInput, TopicKindList, TopicList, TopicQuery } from './types/topics.types.js';

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

/**
 * A subject as the form sent it, with its key made referable.
 *
 * Slugged for `parseFeedLines`' reason: a key is what something else has to name exactly, and
 * `Pop culture` written back as `Pop Culture` is a subject nothing can reach. The label keeps the
 * operator's own spelling, because that is the half that gets read out.
 */
function draftOf(input: TopicInput): Omit<StoredTopic, 'id'> {
    return {
        kind: input.kind.trim(),
        key: slug(input.key) || slug(input.label) || 'topic',
        label: input.label.trim(),
        config: input.config ?? {},
        position: input.position,
    };
}

const slug = (value: string): string =>
    value
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

/** Re-exported so a caller that has a wire topic can hand it on without importing two shapes. */
export type { Topic };
