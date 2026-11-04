import { topicKeyOf, type Topic, type TopicDraft } from './topic.js';
import { TopicPackRow, type TopicPack } from './types/topics.types.js';

/** What says, in the file itself, what this is. The contract refuses anything else before this is reached. */
export const TOPIC_PACK_FORMAT = 'deadair.topics';

/** The version of the document's shape. It moves only when the shape does, never with the station. */
export const TOPIC_PACK_VERSION = 1;

/** One entry a file would leave out, and why. */
export interface DroppedEntry {
    entry: number;
    words?: string;
    reason: string;
}

/** What a file would do to a station that holds what it holds. */
export interface TopicPackReading {
    adding: TopicDraft[];
    /** The labels of what the station already has. */
    skipped: string[];
    dropped: DroppedEntry[];
    /** Kinds in {@link adding} that nothing on this station has declared. */
    unknownKinds: string[];
}

/**
 * A station's subjects as one file. Holds what a subject IS and nothing about the station it came from,
 * so no `id`, and no `position`, which is the importing operator's order.
 */
export function packOfTopics(topics: readonly Topic[]): TopicPack {
    return {
        format: TOPIC_PACK_FORMAT,
        version: TOPIC_PACK_VERSION,
        name: 'Topics',
        topics: topics.map(topic => ({ kind: topic.kind, key: topic.key, label: topic.label, config: topic.config })),
    };
}

/**
 * Reads a file against what the station already has, and writes nothing.
 *
 * One entry at a time rather than through a typed array in the contract, because only the header can make
 * a file unusable. A subject is the same as one held when its kind and key match, as the table's own
 * constraint has it, and that goes for two entries in one file too. A label that differs does not make it
 * a different subject: the words here are this station's own, and an import never changes them.
 *
 * New subjects go after the last of their kind, since position only orders a list and each kind is drawn
 * as a list of its own.
 */
export function planTopicPack(pack: TopicPack, held: readonly Topic[], declaredKinds: ReadonlySet<string>): TopicPackReading {
    const seen = new Set(held.map(topic => identityOf(topic.kind, topic.key)));
    const nextPosition = new Map<string, number>();
    for (const topic of held) nextPosition.set(topic.kind, Math.max(nextPosition.get(topic.kind) ?? 0, topic.position + 1));

    const reading: TopicPackReading = { adding: [], skipped: [], dropped: [], unknownKinds: [] };

    pack.topics.forEach((entry, index) => {
        const row = TopicPackRow.safeParse(entry);
        if (!row.success) {
            const issue = row.error.issues[0];
            const label = typeof entry.label === 'string' ? entry.label.trim().slice(0, 80) : '';
            reading.dropped.push({
                entry: index + 1,
                ...(label === '' ? {} : { words: label }),
                reason: issue === undefined ? 'it could not be read' : `${issue.path.join('.') || 'the entry'}: ${issue.message}`,
            });
            return;
        }

        const kind = row.data.kind.trim();
        const label = row.data.label.trim();
        if (kind === '' || label === '') {
            reading.dropped.push({ entry: index + 1, ...(label === '' ? {} : { words: label }), reason: 'it needs a kind and a label' });
            return;
        }

        const key = topicKeyOf(row.data.key, label);
        const identity = identityOf(kind, key);
        if (seen.has(identity)) {
            reading.skipped.push(label);
            return;
        }
        seen.add(identity);

        const position = nextPosition.get(kind) ?? 0;
        nextPosition.set(kind, position + 1);
        reading.adding.push({ kind, key, label, config: row.data.config ?? {}, position });
        if (!declaredKinds.has(kind) && !reading.unknownKinds.includes(kind)) reading.unknownKinds.push(kind);
    });

    return reading;
}

const identityOf = (kind: string, key: string): string => JSON.stringify([kind, key]);
