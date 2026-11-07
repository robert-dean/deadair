import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { DateTime } from 'luxon';
import { MAX_DIRECTION_LENGTH, TalkDirectionRepository, type TalkDirectionRow } from './talk.direction.repository.js';
import type { TalkDirectionInput, TalkDirectionReading } from './types/direction.types.js';

/**
 * The console's door onto the talk direction: a line the operator gives the presenters for a while.
 *
 * Only reads, checks and writes it. Who hears it is decided where a break or a banter is written
 * (`break.request.builder.ts`, `produce.production.job.ts`), against the time it AIRS. Setting or
 * clearing one rewrites nothing already written: a direction is a lean, so a break written without it
 * (or with one since cleared) breaks no claim, and "write it again" is there for one that must change.
 */
@Injectable()
export class TalkDirectionService {
    constructor(private readonly directions: TalkDirectionRepository) {}

    /** `GET /direction`. */
    async read(): Promise<TalkDirectionReading> {
        return readingOf(await this.directions.direction());
    }

    /** `PUT /direction`: these words for this many hours, replacing any direction already in force. */
    async direct(body: TalkDirectionInput): Promise<TalkDirectionReading> {
        const words = wordsOf(body.words);
        if (words === '') throw httpError(400).withDetails({ message: 'a direction needs some words for the presenters' });
        if (words.length > MAX_DIRECTION_LENGTH) {
            throw httpError(400).withDetails({ message: `a direction is at most ${MAX_DIRECTION_LENGTH} characters` });
        }

        return readingOf(await this.directions.setDirection(words, body.hours));
    }

    /** `DELETE /direction`. */
    async stop(): Promise<TalkDirectionReading> {
        await this.directions.clearDirection();
        return {};
    }
}

/** The operator's words on one line: a direction is a sentence the prompt quotes, and a newline in it would start a line of its own. */
export const wordsOf = (words: string): string => words.replace(/\s+/g, ' ').trim();

const readingOf = (direction: TalkDirectionRow | undefined): TalkDirectionReading =>
    direction === undefined ? {} : { direction: { words: direction.words, endsAt: DateTime.fromISO(direction.endsAt, { zone: 'utc' }) } };
