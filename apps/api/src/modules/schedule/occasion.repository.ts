import { Injectable } from 'injectkit';
import { Kysely, type Selectable } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import type { DeadairOccasions } from '#modules/data/db.js';
import { moodStages, type LyricMood } from '#modules/lyrics/lyric.moods.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { OccasionRule } from './occasion.rule.js';

/** An occasion as the station reads it. */
export interface Occasion {
    id: string;
    words: string;
    rule: OccasionRule;
    mood?: LyricMood;
    enabled: boolean;
    position: number;
}

/**
 * The station's occasions, as rows.
 *
 * Station-scoped like every other station-owned table. Answers the rule `occasion.rule.ts` judges with,
 * so nothing past here knows that a rule is several columns.
 */
@Injectable()
export class OccasionRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /** Every occasion, in the order a date is matched against them. */
    async list(): Promise<Occasion[]> {
        const rows = await this.db
            .selectFrom('deadair.occasions')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .orderBy('position')
            .orderBy('createdAt')
            .execute();

        return rows.map(toOccasion);
    }

    /** The ones switched on, in that same order. */
    async enabled(): Promise<Occasion[]> {
        const rows = await this.db
            .selectFrom('deadair.occasions')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .where('enabled', '=', true)
            .orderBy('position')
            .orderBy('createdAt')
            .execute();

        return rows.map(toOccasion);
    }

    /** At the end of the list. */
    async add(draft: OccasionDraft): Promise<Occasion> {
        const last = await this.db
            .selectFrom('deadair.occasions')
            .select(eb => eb.fn.max('position').as('position'))
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();
        const row = await this.db
            .insertInto('deadair.occasions')
            .values({ stationKey: this.station.stationKey, position: (last?.position ?? 0) + POSITION_STEP, ...columnsOf(draft) })
            .returningAll()
            .executeTakeFirstOrThrow();

        return toOccasion(row);
    }

    /** `undefined` for an occasion this station does not have. Keeps its place in the list. */
    async change(id: string, draft: OccasionDraft): Promise<Occasion | undefined> {
        const row = await this.db
            .updateTable('deadair.occasions')
            .set(columnsOf(draft))
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .returningAll()
            .executeTakeFirst();

        return row === undefined ? undefined : toOccasion(row);
    }

    /** Whether there was one to remove. */
    async remove(id: string): Promise<boolean> {
        const removed = await this.db
            .deleteFrom('deadair.occasions')
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return removed.numDeletedRows > 0n;
    }

    /** Puts these first, in this order, and the rest behind them in the order they already had. An id this station does not have is ignored. */
    async reorder(ids: readonly string[]): Promise<void> {
        const rows = await this.list();
        const wanted = new Map(ids.map((id, index) => [id, index]));
        const ordered = [...rows].sort((a, b) => (wanted.get(a.id) ?? ids.length) - (wanted.get(b.id) ?? ids.length));

        for (const [index, occasion] of ordered.entries()) {
            const position = (index + 1) * POSITION_STEP;
            if (occasion.position === position) continue;
            await this.db.updateTable('deadair.occasions').set({ position }).where('id', '=', occasion.id).execute();
        }
    }
}

/** An occasion as an operator writes one. Where it comes in the list is the repository's to decide. */
export type OccasionDraft = Omit<Occasion, 'id' | 'position'>;

/** The gap between positions, so a row added by hand with psql has somewhere to go. */
const POSITION_STEP = 10;

/** A rule as columns, every one of them named, so a change of kind leaves nothing behind from the last. */
function columnsOf(draft: OccasionDraft) {
    const { rule } = draft;
    return {
        words: draft.words,
        mood: draft.mood ?? null,
        enabled: draft.enabled,
        ruleKind: rule.kind,
        month: rule.kind === 'fixed' || rule.kind === 'weekday' ? rule.month : null,
        day: rule.kind === 'fixed' || rule.kind === 'calendar' ? rule.day : null,
        ordinal: rule.kind === 'weekday' ? rule.ordinal : null,
        weekday: rule.kind === 'weekday' ? rule.weekday : null,
        offsetDays: rule.kind === 'easter' ? rule.offsetDays : null,
        calendar: rule.kind === 'calendar' ? rule.calendar : null,
        calendarMonth: rule.kind === 'calendar' ? rule.calendarMonth : null,
        dates: rule.kind === 'dates' ? [...rule.dates] : null,
    };
}

/** A row as the code reads it. The migration's check is what makes each kind's columns present. */
export function toOccasion(row: Selectable<DeadairOccasions>): Occasion {
    const mood = moodStages(row.mood == null ? [] : [row.mood])?.[0];
    return {
        id: row.id,
        words: row.words,
        rule: ruleOf(row),
        ...(mood === undefined ? {} : { mood }),
        enabled: row.enabled,
        position: row.position,
    };
}

function ruleOf(row: Selectable<DeadairOccasions>): OccasionRule {
    switch (row.ruleKind) {
        case 'fixed':
            return { kind: 'fixed', month: row.month!, day: row.day! };
        case 'weekday':
            return { kind: 'weekday', month: row.month!, ordinal: row.ordinal!, weekday: row.weekday! };
        case 'easter':
            return { kind: 'easter', offsetDays: row.offsetDays! };
        case 'calendar':
            return { kind: 'calendar', calendar: row.calendar!, calendarMonth: row.calendarMonth!, day: row.day! };
        case 'dates':
            return { kind: 'dates', dates: row.dates! };
    }
}
