import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { DateTime } from 'luxon';
import { ruleActive, type BlockRule as Rule, type RuleContext } from './block.rules.js';
import { BlockRulesRepository, type BlockRuleDraft, type GenreSteerRow } from './block.rules.repository.js';
import { readClock } from './clock.bands.js';
import { stationZone } from './clock.words.js';
import { DirectorService } from './director.service.js';
import type { BlockRule, BlockRuleInput, BlockRuleList, GenreSteerInput, GenreSteerReading } from './types/rules.types.js';

/**
 * The console's door onto never-play rules and the genre steer. See `block.rules.ts` for what a rule
 * is and `genre.steer.ts` for what a steer is; this only reads, checks and writes them.
 *
 * A rule holds from the next record the station chooses. Records already in the running order are
 * not taken back out, on a dislike's terms: what changes is what is picked, from here on.
 */
@Injectable()
export class BlockRulesService {
    constructor(
        private readonly rules: BlockRulesRepository,
        private readonly director: DirectorService,
        private readonly config: AppConfig,
    ) {}

    /** `GET /rules`: every rule, newest first, each saying whether it holds right now. */
    async list(): Promise<BlockRuleList> {
        const context = this.context();
        return { rules: (await this.rules.list()).map(rule => toContract(rule, ruleActive(rule, context))) };
    }

    /** `POST /rules`. */
    async add(body: BlockRuleInput): Promise<BlockRuleList> {
        await this.rules.add(draftOf(body));
        return await this.list();
    }

    /** `PUT /rules/{id}`. */
    async change(id: string, body: BlockRuleInput): Promise<BlockRuleList> {
        const changed = await this.rules.change(id, draftOf(body));
        if (changed === undefined) throw httpError(404).withDetails({ message: `rule "${id}" does not exist` });
        return await this.list();
    }

    /** `DELETE /rules/{id}`. */
    async remove(id: string): Promise<BlockRuleList> {
        if (!(await this.rules.remove(id))) throw httpError(404).withDetails({ message: `rule "${id}" does not exist` });
        return await this.list();
    }

    /** `GET /rules/steer`. */
    async readSteer(): Promise<GenreSteerReading> {
        return readingOf(await this.rules.steer());
    }

    /** `PUT /rules/steer`: lean toward these genres for this many hours, replacing any lean already in force. */
    async steer(body: GenreSteerInput): Promise<GenreSteerReading> {
        const genres = [...new Set(body.genres.map(genre => genre.trim()).filter(genre => genre !== ''))];
        if (genres.length === 0) throw httpError(400).withDetails({ message: 'name at least one genre to lean toward' });

        return readingOf(await this.rules.setSteer(genres, body.hours));
    }

    /** `DELETE /rules/steer`. */
    async stopSteering(): Promise<GenreSteerReading> {
        await this.rules.clearSteer();
        return {};
    }

    /** What a rule is judged against now: the station's clock and what is on air. */
    private context(): RuleContext {
        const now = Date.now();
        const order = this.director.order();
        const slotId = this.director.status().slotId;
        return {
            clock: readClock(now, stationZone(this.config)),
            now,
            ...(order === undefined ? {} : { mode: order.mode }),
            ...(slotId === undefined ? {} : { slotId }),
        };
    }
}

/**
 * A submitted rule as a draft, refused with a sentence where the table would refuse it with a code.
 *
 * Both ends of a season or of a window of hours, or neither: one end alone is not a scope anybody can
 * mean, and the table's pair checks would answer it as a 500.
 */
function draftOf(body: BlockRuleInput): BlockRuleDraft {
    if ((body.seasonFrom === undefined) !== (body.seasonTo === undefined)) {
        throw httpError(400).withDetails({ message: 'a season needs both its first and its last day' });
    }
    for (const day of [body.seasonFrom, body.seasonTo]) {
        if (day !== undefined && !isCalendarDay(day))
            throw httpError(400).withDetails({ message: `"${day}" is not a day of the year written as MM-DD` });
    }
    if ((body.fromHour === undefined) !== (body.untilHour === undefined)) {
        throw httpError(400).withDetails({ message: 'a window of hours needs both its first hour and the hour it ends' });
    }
    if (body.value.trim() === '') throw httpError(400).withDetails({ message: 'a rule needs a genre or tag to refuse' });

    return {
        field: body.field,
        value: body.value.trim(),
        ...(body.seasonFrom === undefined ? {} : { seasonFrom: body.seasonFrom }),
        ...(body.seasonTo === undefined ? {} : { seasonTo: body.seasonTo }),
        ...(body.fromHour === undefined ? {} : { fromHour: body.fromHour }),
        ...(body.untilHour === undefined ? {} : { untilHour: body.untilHour }),
        ...(body.modes === undefined || body.modes.length === 0 ? {} : { modes: body.modes }),
        ...(body.slotIds === undefined || body.slotIds.length === 0 ? {} : { slotIds: body.slotIds }),
        ...(body.endsAt === undefined ? {} : { endsAt: body.endsAt.toUTC().toISO() ?? undefined }),
    } as BlockRuleDraft;
}

function toContract(rule: Rule, inForce: boolean): BlockRule {
    return {
        id: rule.id,
        field: rule.field,
        value: rule.value,
        ...(rule.seasonFrom === undefined ? {} : { seasonFrom: rule.seasonFrom }),
        ...(rule.seasonTo === undefined ? {} : { seasonTo: rule.seasonTo }),
        ...(rule.fromHour === undefined ? {} : { fromHour: rule.fromHour }),
        ...(rule.untilHour === undefined ? {} : { untilHour: rule.untilHour }),
        ...(rule.modes === undefined ? {} : { modes: [...rule.modes] }),
        ...(rule.slotIds === undefined ? {} : { slotIds: [...rule.slotIds] }),
        ...(rule.endsAt === undefined ? {} : { endsAt: DateTime.fromISO(rule.endsAt, { zone: 'utc' }) }),
        inForce,
    };
}

const readingOf = (steer: GenreSteerRow | undefined): GenreSteerReading =>
    steer === undefined ? {} : { steer: { genres: steer.genres, endsAt: DateTime.fromISO(steer.endsAt, { zone: 'utc' }) } };

const isCalendarDay = (value: string): boolean => {
    const match = /^(\d{2})-(\d{2})$/.exec(value);
    return match !== null && Number(match[1]) >= 1 && Number(match[1]) <= 12 && Number(match[2]) >= 1 && Number(match[2]) <= 31;
};
