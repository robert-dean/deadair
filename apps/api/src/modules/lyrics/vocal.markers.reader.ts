import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { lyricsProviderRank } from './lyrics.rank.js';
import { LyricsRepository, type StoredTiming, type VocalOverride } from './lyrics.repository.js';
import { UNKNOWN_MARKERS, vocalMarkers, type VocalMarkers } from './vocal.ranges.js';

/** Which answer the markers are: an operator's correction, the record's timed lyrics, or neither. */
export type VocalMarkersSource = 'override' | 'lyrics' | 'none';

export interface SourcedVocalMarkers {
    markers: VocalMarkers;
    source: VocalMarkersSource;
}

/**
 * An operator's correction as markers.
 *
 * Not held to `MIN_ONSET_MS`: that floor exists because a volunteer's timing a second into a record
 * is more often a slip than a fact, and an operator who listened and typed it is the fact. With no
 * end given, the derived end stands if there is one, since a correction of the post says nothing
 * about the outro.
 */
function fromOverride(override: VocalOverride, derived: VocalMarkers): VocalMarkers {
    if (override.instrumental) return { kind: 'instrumental' };

    const endMs = override.endMs ?? (derived.kind === 'ranges' && derived.endMs > override.onsetMs ? derived.endMs : override.onsetMs);
    return { kind: 'ranges', onsetMs: override.onsetMs, endMs, ranges: [{ startMs: override.onsetMs, endMs }] };
}

/**
 * Where the singing is on each of a set of records: an operator's correction if there is one,
 * otherwise what the record's timed lyrics say.
 *
 * Derived when it is read and never stored, so tuning the constants in `vocal.ranges.ts` needs no
 * walk, and so nothing automatic ever writes a marker an operator's correction could lose to. One
 * batched read per table per call.
 *
 * Lyric sources are believed in the operator's `lyrics.providerOrder`, then by id, read from the
 * setting rather than from the installed plugins: a row a since-removed plugin wrote is still a
 * timing somebody typed while listening.
 *
 * What leaves here is markers. The lines the repository hands over stay inside this class.
 */
@Injectable()
export class VocalMarkersReader {
    constructor(
        private readonly repository: LyricsRepository,
        private readonly config: AppConfig,
    ) {}

    async forTracks(trackIds: readonly string[]): Promise<Map<string, VocalMarkers>> {
        const sourced = await this.sourcedForTracks(trackIds);
        return new Map([...sourced].map(([trackId, { markers }]) => [trackId, markers]));
    }

    async sourcedForTracks(trackIds: readonly string[]): Promise<Map<string, SourcedVocalMarkers>> {
        const answers = new Map<string, SourcedVocalMarkers>();
        const unique = [...new Set(trackIds)];
        if (unique.length === 0) return answers;

        const [rows, overrides] = await Promise.all([this.repository.timingsForTracks(unique), this.repository.overridesForTracks(unique)]);
        const rank = lyricsProviderRank(this.config);

        const byTrack = new Map<string, StoredTiming[]>();
        for (const row of rows) byTrack.set(row.trackId, [...(byTrack.get(row.trackId) ?? []), row]);

        for (const trackId of unique) {
            const own = (byTrack.get(trackId) ?? []).sort(rank);
            const derived = own.length === 0 ? UNKNOWN_MARKERS : vocalMarkers(own);
            const override = overrides.get(trackId);

            if (override) answers.set(trackId, { markers: fromOverride(override, derived), source: 'override' });
            else answers.set(trackId, { markers: derived, source: derived.kind === 'unknown' ? 'none' : 'lyrics' });
        }

        return answers;
    }
}
