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
