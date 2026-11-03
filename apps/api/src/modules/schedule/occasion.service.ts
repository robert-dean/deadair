import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { stationZone, weekday, type RoughTime } from '#modules/director/clock.words.js';
import type { LyricMood } from '#modules/lyrics/lyric.moods.js';
import { OccasionRepository } from './occasion.repository.js';
import { occasionFallsAt } from './occasion.rule.js';

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
 * The one answer to "what is today here", which both the writers and the draw read.
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
}
