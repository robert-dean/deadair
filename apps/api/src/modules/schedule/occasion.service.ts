import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { readClock } from '#modules/director/clock.bands.js';
import { stationZone, weekday, type RoughTime } from '#modules/director/clock.words.js';
import { dateKey, type StationDate } from '#modules/director/schedule.js';
import type { LyricMood } from '#modules/lyrics/lyric.moods.js';
import { OccasionRepository, type Occasion as StoredOccasion, type OccasionDraft } from './occasion.repository.js';
import { calendarMonths, nextOccasionDate, OCCASION_CALENDARS, occasionFallsAt, occasionRuleOf, type OccasionRule } from './occasion.rule.js';
import type { Occasion, OccasionInput, OccasionList, OccasionOrder } from './types/occasions.types.js';

/**
 * What a day is to this station, for one instant: the words, and how long they stay true.
 *
 * A {@link RoughTime} for the reason `weekday` is one, whose window this borrows: "it's Halloween" written
 * at ten to midnight and aired at five past is the same failure as a stale "this morning", and the claim
 * machinery that catches one catches the other once the window is the day.
 */
export interface OccasionToday extends RoughTime {
    mood?: LyricMood;
}

/**
 * The one answer to "what is today here", which both the writers and the draw read, and the console's
 * door onto the list it comes from.
 *
 * It is asked about the instant something will be HEARD rather than now, so a break written at ten to
 * midnight is about tomorrow. First match wins, in the operator's order. A table that cannot be read
 * costs the occasion and never the caller, since a day with nothing to say about it is an ordinary day.
 */
@Injectable()
export class OccasionService {
    constructor(
        private readonly occasions: OccasionRepository,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** The occasion `at` falls on, or `undefined` for an ordinary day. */
    async on(at: number): Promise<OccasionToday | undefined> {
        try {
            const zone = stationZone(this.config);
            const found = (await this.occasions.enabled()).find(occasion => occasionFallsAt(occasion.rule, at, zone));
            if (found === undefined) return undefined;

            const { validFrom, validUntil } = weekday(at, zone);
            return { words: found.words, validFrom, validUntil, ...(found.mood === undefined ? {} : { mood: found.mood }) };
        } catch (error) {
            this.logger.warn('could not read the occasions', { error });
            return undefined;
        }
    }

    /** `GET /occasions`. */
    async list(): Promise<OccasionList> {
        const { year, month, day, weekday: dayOfWeek } = readClock(Date.now(), stationZone(this.config));
        const today: StationDate = { year, month, day, weekday: dayOfWeek };

        return {
            occasions: (await this.occasions.list()).map(occasion => toContract(occasion, today)),
            calendars: OCCASION_CALENDARS.map(calendar => ({ calendar, months: [...calendarMonths(calendar)] })),
        };
    }

    /** `POST /occasions`. */
    async add(body: OccasionInput): Promise<OccasionList> {
        await this.occasions.add(draftOf(body));
        return await this.list();
    }

    /** `PUT /occasions/{id}`. */
    async change(id: string, body: OccasionInput): Promise<OccasionList> {
        const changed = await this.occasions.change(id, draftOf(body));
        if (changed === undefined) throw httpError(404).withDetails({ message: `occasion "${id}" does not exist` });
        return await this.list();
    }

    /** `DELETE /occasions/{id}`. */
    async remove(id: string): Promise<OccasionList> {
        if (!(await this.occasions.remove(id))) throw httpError(404).withDetails({ message: `occasion "${id}" does not exist` });
        return await this.list();
    }

    /** `PUT /occasions/order`. */
    async reorder(body: OccasionOrder): Promise<OccasionList> {
        await this.occasions.reorder(body.ids);
        return await this.list();
    }
}

/** A submitted occasion as a draft, refused with a sentence where the table would refuse it with a code. */
function draftOf(body: OccasionInput): OccasionDraft {
    const words = body.words.trim();
    if (words === '') throw httpError(400).withDetails({ message: 'an occasion needs words to say' });

    const rule = occasionRuleOf(body);
    if (typeof rule === 'string') throw httpError(400).withDetails({ message: rule });

    return { words, rule, enabled: body.enabled, ...(body.mood === undefined ? {} : { mood: body.mood }) };
}

/** A rule's own fields, as the contract lays them out flat. */
function ruleFieldsOf(rule: OccasionRule) {
    if (rule.kind === 'dates') return { dates: [...rule.dates] };
    const { kind: _kind, ...fields } = rule;
    return fields;
}

/** A stored occasion as the routes answer it: the rule's fields side by side, and when it next falls. */
function toContract(occasion: StoredOccasion, today: StationDate): Occasion {
    const { rule } = occasion;
    const next = nextOccasionDate(rule, today);

    return {
        id: occasion.id,
        words: occasion.words,
        ruleKind: rule.kind,
        ...ruleFieldsOf(rule),
        ...(occasion.mood === undefined ? {} : { mood: occasion.mood }),
        enabled: occasion.enabled,
        position: occasion.position,
        ...(next === undefined ? {} : { nextDate: dateKey(next) }),
    };
}
