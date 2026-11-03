import type { Occasion, OccasionDraft } from './occasion.repository.js';
import { occasionRuleOf, type OccasionRule } from './occasion.rule.js';
import { OccasionPackRow, type OccasionPack } from './types/occasions.types.js';

/** What says, in the file itself, what this is. The contract refuses anything else before this is reached. */
export const OCCASION_PACK_FORMAT = 'deadair.occasions';

/** The version of the document's shape. It moves only when the shape does, never with the station. */
export const OCCASION_PACK_VERSION = 1;

/** What a file would do to a station that holds what it holds. */
export interface OccasionPackReading {
    adding: OccasionDraft[];
    /** The words of what the station already has. */
    skipped: string[];
    dropped: { entry: number; words?: string; reason: string }[];
}

/**
 * A set of occasions as one file. Holds what a day IS and nothing about the station it came from, so no
 * `id` and no `position`, and no `enabled`, which is the importing operator's to decide.
 */
export function packOfOccasions(occasions: readonly Occasion[]): OccasionPack {
    return {
        format: OCCASION_PACK_FORMAT,
        version: OCCASION_PACK_VERSION,
        name: 'Occasions',
        occasions: occasions.map(occasion => ({
            words: occasion.words,
            ruleKind: occasion.rule.kind,
            ...ruleFields(occasion.rule),
            ...(occasion.mood === undefined ? {} : { mood: occasion.mood }),
        })),
    };
}

/**
 * Reads a file against what the station already has, and writes nothing.
 *
 * One entry at a time rather than through a typed array in the contract, because a typed array answers
 * one bad month with a 400 for the whole file, and the rule here is the language pack's: only the header
 * can make a file unusable. An entry is the same as one held when its words and its rule both match,
 * ignoring case in the words, and that goes for two entries in one file too. Words alone are not enough:
 * two stations can mean different days by `Founders Day`.
 */
export function planOccasionPack(pack: OccasionPack, held: readonly Occasion[]): OccasionPackReading {
    const seen = new Set(held.map(occasion => identityOf(occasion.words, occasion.rule)));
    const reading: OccasionPackReading = { adding: [], skipped: [], dropped: [] };

    pack.occasions.forEach((entry, index) => {
        const words = typeof entry.words === 'string' ? entry.words.trim() : undefined;
        const drop = (reason: string) =>
            reading.dropped.push({ entry: index + 1, ...(words === undefined || words === '' ? {} : { words: words.slice(0, 80) }), reason });

        const row = OccasionPackRow.safeParse(entry);
        if (!row.success) {
            const issue = row.error.issues[0];
            drop(issue === undefined ? 'it could not be read' : `${issue.path.join('.') || 'the entry'}: ${issue.message}`);
            return;
        }
        if (words === undefined || words === '') {
            drop('it has no words to say');
            return;
        }

        const rule = occasionRuleOf(row.data);
        if (typeof rule === 'string') {
            drop(rule);
            return;
        }

        const identity = identityOf(words, rule);
        if (seen.has(identity)) {
            reading.skipped.push(words);
            return;
        }
        seen.add(identity);
        reading.adding.push({ words, rule, enabled: false, ...(row.data.mood === undefined ? {} : { mood: row.data.mood }) });
    });

    return reading;
}

function identityOf(words: string, rule: OccasionRule): string {
    return JSON.stringify([words.trim().toLowerCase(), ruleFields(rule), rule.kind]);
}

/** A rule's own fields in one order, so two rules saying the same thing compare the same. */
function ruleFields(rule: OccasionRule) {
    switch (rule.kind) {
        case 'fixed':
            return { month: rule.month, day: rule.day };
        case 'weekday':
            return { month: rule.month, ordinal: rule.ordinal, weekday: rule.weekday };
        case 'easter':
            return { offsetDays: rule.offsetDays };
        case 'calendar':
            return { calendar: rule.calendar, calendarMonth: rule.calendarMonth, day: rule.day };
        case 'dates':
            return { dates: [...rule.dates] };
    }
}
