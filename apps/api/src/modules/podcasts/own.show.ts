import type { WritingMode } from '#modules/productions/production.js';

/**
 * A show the station makes for itself, as the rest of the app reads it: a saved recipe for a podcast
 * whose every episode is a production. See migration 0092 for why it is not called a station show.
 */
export interface OwnShowRecord {
    id: string;
    title: string;
    description?: string;
    /** What an episode is about when it is asked for with no subject of its own. */
    subject?: string;
    personaId?: string;
    targetMs?: number;
    writingMode?: WritingMode;
    /** The station's news feeds an episode reads, by their qualified ids. Absent is a show that does not read the news. */
    newsFeedIds?: readonly string[];
    /** How many hours of news an episode reads. Absent is {@link DEFAULT_NEWS_HOURS}. */
    newsHours?: number;
    /** Whether an episode given nothing to read finds its own sources on the operator's trusted sites. */
    research?: true;
    createdAt: number;
}

/** What an operator writes. The id and the moment it was made are the table's. */
export type OwnShowWrite = Omit<OwnShowRecord, 'id' | 'createdAt'>;

/** How far back a show that reads the news reads, when it does not say. */
export const DEFAULT_NEWS_HOURS = 24;
