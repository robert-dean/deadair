/**
 * A TTL cache over `host.storage`, which is what makes this plugin affordable.
 *
 * At one request per second, a rotation of a few hundred tracks is several
 * minutes of pacing per pass, and the answers barely move: MusicBrainz's view
 * of a 1994 recording is the same next month. So a resolved track is
 * remembered whole, a track MusicBrainz does not have is remembered as a miss,
 * and an artist is remembered once for every track they appear on.
 *
 * Nothing sweeps this. Entries expire lazily on read, which is the right trade
 * for a store whose keys are bounded by the size of the catalog and whose
 * values are a few hundred bytes.
 */

import type { PluginLogger, PluginStorage, TrackEnrichment, TrackRef } from '@deadair/plugin-sdk';

import { normalize } from './musicbrainz.match.js';

/** How long a resolved track is trusted. Identity does not drift; new aliases and links do, slowly. */
export const MATCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a miss is trusted. Shorter than a hit on purpose: a track absent
 * from MusicBrainz today may be added tomorrow, and the cost of asking again is
 * one request, while the cost of never asking again is a track that stays
 * anonymous forever.
 */
export const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const ARTIST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Bumped when the shape of what is stored changes. Entries under an older
 * version are simply never read again and age out, which is cheaper and safer
 * than migrating a cache.
 */
const CACHE_VERSION = 'v1';

/** What actually lands in storage. JSON-safe, and `expiresAt` is epoch ms rather than a `Date`. */
interface CacheEnvelope<T> {
    /** Absent for a remembered miss, which is a different thing from a missing entry. */
    value?: T;
    expiresAt: number;
}

/** A live entry. `value` absent means "we asked, and the answer was nothing". */
export interface CacheHit<T> {
    value?: T;
}

const isEnvelope = (value: unknown): value is CacheEnvelope<unknown> =>
    typeof value === 'object' && value !== null && typeof (value as CacheEnvelope<unknown>).expiresAt === 'number';

export class MusicBrainzCache {
    /**
     * @param fingerprint Settings that change what a lookup would return, folded
     *   into every key. An operator who lowers the match score or turns artwork
     *   on is asking a different question, and should not be answered out of a
     *   cache that was filled under the old one.
     */
    constructor(
        private readonly storage: PluginStorage,
        private readonly logger: PluginLogger,
        private readonly fingerprint: string,
    ) {}

    /**
     * The key a track is remembered under: its ISRC when it has one, otherwise
     * its normalised artist and title, which is the same pair the search would
     * have been built from.
     */
    matchKey(ref: TrackRef): string {
        const identity = ref.isrc ? `isrc:${ref.isrc.toUpperCase()}` : `at:${normalize(ref.artist)}|${normalize(ref.title)}`;
        return `${CACHE_VERSION}:${this.fingerprint}:match:${identity}`;
    }

    artistKey(mbid: string): string {
        return `${CACHE_VERSION}:${this.fingerprint}:artist:${mbid}`;
    }

    /**
     * The entry, or `undefined` when there is none or it has expired.
     *
     * A storage failure reads as a miss. The cache is an optimisation, and an
     * enrichment that cannot reach its cache should do the work rather than
     * fail.
     */
    async read<T>(key: string): Promise<CacheHit<T> | undefined> {
        let stored: unknown;
        try {
            stored = await this.storage.get(key);
        } catch (error) {
            this.logger.debug('musicbrainz cache read failed', { key, reason: error instanceof Error ? error.message : String(error) });
            return undefined;
        }

        if (!isEnvelope(stored)) return undefined;
        if (stored.expiresAt <= Date.now()) return undefined;
        return { value: stored.value as T | undefined };
    }

    /** Remembers a value, or a miss when `value` is `undefined`. Never throws. */
    async write(key: string, value: unknown, ttlMs: number): Promise<void> {
        const envelope: CacheEnvelope<unknown> = { expiresAt: Date.now() + ttlMs };
        if (value !== undefined) envelope.value = value;

        try {
            await this.storage.set(key, envelope);
        } catch (error) {
            this.logger.debug('musicbrainz cache write failed', { key, reason: error instanceof Error ? error.message : String(error) });
        }
    }
}

/** The settings that change an answer, in a form short enough to sit in a key. */
export function cacheFingerprint(options: { matchScore: number; includeArtwork: boolean; includeArtistFacts: boolean }): string {
    return `${options.matchScore}${options.includeArtwork ? 'a' : ''}${options.includeArtistFacts ? 'f' : ''}`;
}

/** Narrower alias for the value the match cache holds, which is the whole mapped enrichment. */
export type CachedEnrichment = Partial<TrackEnrichment>;
