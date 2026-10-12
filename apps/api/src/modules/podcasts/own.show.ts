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
    createdAt: number;
}

/** What an operator writes. The id and the moment it was made are the table's. */
export type OwnShowWrite = Omit<OwnShowRecord, 'id' | 'createdAt'>;
