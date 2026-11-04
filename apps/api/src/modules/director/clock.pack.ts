import { planTopicPack, type DroppedEntry } from '#modules/topics/topic.pack.js';
import { topicKeyOf, type Topic, type TopicDraft } from '#modules/topics/topic.js';
import type { ClockBand, ClockBandRecord } from './clock.bands.js';
import { ClockPackRow, type ClockPack, type ClockPackTopic } from './types/clock.types.js';

/** What says, in the file itself, what this is. The contract refuses anything else before this is reached. */
export const CLOCK_PACK_FORMAT = 'deadair.clock';

/** The version of the document's shape. It moves only when the shape does, never with the station. */
export const CLOCK_PACK_VERSION = 1;

/** A band a file would add, with the subject it needs by kind and key, since the row may not exist yet. */
export interface PlannedBand {
    /** The rule, with no subject on it. See {@link subjectKey}. */
    shape: ClockBand;
    subjectKey?: string;
    position: number;
    /** How a list would name it. */
    words: string;
}

/** What a file would do to a station that holds what it holds. */
export interface ClockPackReading {
    adding: PlannedBand[];
    /** The subjects the bands in {@link adding} need that this station does not hold. */
    addingTopics: TopicDraft[];
    /** How a list would name what the station already has. */
    skipped: string[];
    dropped: DroppedEntry[];
}

/**
 * A format clock as one file. Holds what each rule IS and nothing about the station it came from, so no
 * `id`, no `position`, and no `enabled`, which is the importing operator's to decide.
 *
 * A band carries its subject whole rather than by reference, so a clock file works on its own: a station
 * that has never heard of the category gets it along with the band that asks for it.
 */
export function packOfClock(bands: readonly ClockBandRecord[], topics: readonly Topic[]): ClockPack {
    const configs = new Map(topics.map(topic => [topic.id, topic.config]));

    return {
        format: CLOCK_PACK_FORMAT,
        version: CLOCK_PACK_VERSION,
        name: 'Format clock',
        bands: bands.map(band => ({
            kind: band.kind,
            at: band.at,
            ...(band.at === 'clock'
                ? {
                      minute: band.minute,
                      ...(band.hour === undefined ? {} : { hour: band.hour }),
                      ...(band.days === undefined || band.days.length === 0 ? {} : { days: [...band.days] }),
                  }
                : { everyMs: band.everyMs }),
            ...(band.topic === undefined
                ? {}
                : { topic: { key: band.topic.key, label: band.topic.label, config: configs.get(band.topic.id) ?? {} } }),
        })),
    };
}

/**
 * Reads a file against what the station already has, and writes nothing.
 *
 * Every band goes after the last one here. Position is precedence, so anything else would change which of
 * this station's own rules wins a boundary. They arrive switched off, so nothing is mixed into the clock
 * until an operator turns one on, knowing where it sits.
 *
 * A band with a subject the entry does not carry whole is dropped rather than added without one, because a
 * subjectless band reads a general bulletin under a category's name, which is what the `topic_id` cascade
 * exists to prevent. A rule the same as one held, subject included, is skipped.
 */
export function planClockPack(pack: ClockPack, held: readonly ClockBandRecord[], heldTopics: readonly Topic[]): ClockPackReading {
    const seen = new Set(held.map(band => identityOf(band, band.topic?.key)));
    let position = Math.max(-1, ...held.map(band => band.position)) + 1;

    const reading: ClockPackReading = { adding: [], addingTopics: [], skipped: [], dropped: [] };
    const needed: { kind: string; topic: ClockPackTopic }[] = [];

    pack.bands.forEach((entry, index) => {
        const named = typeof entry.kind === 'string' ? entry.kind.trim().slice(0, 80) : '';
        const drop = (reason: string) => reading.dropped.push({ entry: index + 1, ...(named === '' ? {} : { words: named }), reason });

        const row = ClockPackRow.safeParse(entry);
        if (!row.success) {
            const issue = row.error.issues[0];
            drop(issue === undefined ? 'it could not be read' : `${issue.path.join('.') || 'the entry'}: ${issue.message}`);
            return;
        }

        const kind = row.data.kind.trim();
        if (kind === '') {
            drop('it does not say what sort of break it wants');
            return;
        }
        if (row.data.at === 'interval' && row.data.everyMs === undefined) {
            drop('an interval band has to say how far apart');
            return;
        }

        const shape: ClockBand =
            row.data.at === 'interval'
                ? { at: 'interval', everyMs: row.data.everyMs as number, kind }
                : {
                      at: 'clock',
                      minute: row.data.minute ?? 0,
                      ...(row.data.hour === undefined ? {} : { hour: row.data.hour }),
                      ...(row.data.days === undefined || row.data.days.length === 0 ? {} : { days: row.data.days }),
                      kind,
                  };
        const topic = row.data.topic;
        const subjectKey = topic === undefined ? undefined : topicKeyOf(topic.key, topic.label);
        const words = wordsFor(shape, topic?.label);

        const identity = identityOf(shape, subjectKey);
        if (seen.has(identity)) {
            reading.skipped.push(words);
            return;
        }
        seen.add(identity);

        if (topic !== undefined) needed.push({ kind, topic });
        reading.adding.push({ shape, ...(subjectKey === undefined ? {} : { subjectKey }), position: position++, words });
    });

    // The topics file's own planner, so a subject means the same thing whichever file brings it. Every kind
    // counts as declared here: whether this station can make the break is said about the band.
    const subjects = planTopicPack(
        {
            format: 'deadair.topics',
            version: 1,
            name: pack.name,
            topics: needed.map(({ kind, topic }) => ({ kind, key: topic.key, label: topic.label, config: topic.config ?? {} })),
        },
        heldTopics,
        new Set(needed.map(({ kind }) => kind)),
    );
    reading.addingTopics = subjects.adding;

    return reading;
}

function identityOf(band: ClockBand, subjectKey: string | undefined): string {
    return JSON.stringify(
        band.at === 'interval'
            ? [band.kind, 'interval', band.everyMs, subjectKey ?? '']
            : [band.kind, 'clock', band.hour ?? '', band.minute, [...(band.days ?? [])].sort((left, right) => left - right), subjectKey ?? ''],
    );
}

/** A rule in a few plain words, for a preview to list. */
function wordsFor(band: ClockBand, subject: string | undefined): string {
    const what = subject === undefined ? band.kind : `${band.kind}, ${subject}`;
    if (band.at === 'interval') return `${what}: every ${Math.round(band.everyMs / 60_000)} minutes`;

    const minute = String(band.minute).padStart(2, '0');
    const when = band.hour === undefined ? `every hour at :${minute}` : `at ${String(band.hour).padStart(2, '0')}:${minute}`;
    return `${what}: ${when}${band.days === undefined ? '' : ` on ${band.days.length === 1 ? '1 day' : `${band.days.length} days`} a week`}`;
}
