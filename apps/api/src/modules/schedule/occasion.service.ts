import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { readClock } from '#modules/director/clock.bands.js';
import { stationZone, weekday, type RoughTime } from '#modules/director/clock.words.js';
import { dateKey, type StationDate } from '#modules/director/schedule.js';
import type { LyricMood } from '#modules/lyrics/lyric.moods.js';
import { OccasionRepository, type Occasion as StoredOccasion, type OccasionDraft } from './occasion.repository.js';
import { OCCASION_PACK_VERSION, packOfOccasions, planOccasionPack, type OccasionPackReading } from './occasion.pack.js';
import { calendarMonths, nextOccasionDate, OCCASION_CALENDARS, occasionFallsAt, occasionRuleFields, occasionRuleOf } from './occasion.rule.js';
import type {
    Occasion,
    OccasionImportPlan,
    OccasionImportResult,
    OccasionInput,
    OccasionList,
    OccasionOrder,
    OccasionPack,
} from './types/occasions.types.js';

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

    /** `GET /occasions/export`. */
    async exportPack(): Promise<OccasionPack> {
        return packOfOccasions(await this.occasions.list());
    }

    /** `POST /occasions/import/preview`. Writes nothing. */
    async previewImport(body: OccasionPack): Promise<OccasionImportPlan> {
        return planOf(body, planOccasionPack(body, await this.occasions.list()));
    }

    /**
     * `POST /occasions/import`. Only ever adds, and everything it adds starts switched off, since a file
     * from somebody else should not change what the station says until an operator says so.
     *
     * All or nothing, by the request's own transaction: the preview is what stands between an operator
     * and a surprise, so a file that landed halfway would be the one outcome nothing had described.
     */
    async importPack(body: OccasionPack): Promise<OccasionImportResult> {
        const reading = planOccasionPack(body, await this.occasions.list());
        // Before anything is written, since this is also what refuses a version it cannot read.
        const plan = planOf(body, reading);
        for (const draft of reading.adding) await this.occasions.add(draft);
        return { plan, list: await this.list() };
    }
}

/** What a file would do, in the words the console shows. Refuses a version this station cannot read. */
function planOf(pack: OccasionPack, reading: OccasionPackReading): OccasionImportPlan {
    if (pack.version > OCCASION_PACK_VERSION) {
        throw httpError(400).withDetails({
            message: `this station reads version ${OCCASION_PACK_VERSION} of an occasion pack, and this file is version ${pack.version}`,
        });
    }
    return { name: pack.name, adding: reading.adding.map(draft => draft.words), skipped: reading.skipped, dropped: reading.dropped };
}

/** A submitted occasion as a draft, refused with a sentence where the table would refuse it with a code. */
function draftOf(body: OccasionInput): OccasionDraft {
    const words = body.words.trim();
    if (words === '') throw httpError(400).withDetails({ message: 'an occasion needs words to say' });

    const rule = occasionRuleOf(body);
    if (typeof rule === 'string') throw httpError(400).withDetails({ message: rule });

    return { words, rule, enabled: body.enabled, ...(body.mood === undefined ? {} : { mood: body.mood }) };
}

/** A stored occasion as the routes answer it: the rule's fields side by side, and when it next falls. */
function toContract(occasion: StoredOccasion, today: StationDate): Occasion {
    const { rule } = occasion;
    const next = nextOccasionDate(rule, today);

    return {
        id: occasion.id,
        words: occasion.words,
        ...occasionRuleFields(rule),
        ...(occasion.mood === undefined ? {} : { mood: occasion.mood }),
        enabled: occasion.enabled,
        position: occasion.position,
        ...(next === undefined ? {} : { nextDate: dateKey(next) }),
    };
}
