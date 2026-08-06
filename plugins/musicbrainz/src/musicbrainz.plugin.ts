import {
    type EnrichmentMatchKey,
    type EnrichmentPluginInstance,
    type PluginConnectionResult,
    type PluginHost,
    type TrackEnrichment,
    type TrackRef,
} from '@deadair/plugin-sdk';

import { MusicBrainzClient, MusicBrainzRequestError } from './musicbrainz.client.js';
import { DEFAULT_BASE_URL, DEFAULT_MATCH_SCORE, TEST_ARTIST_MBID } from './musicbrainz.manifest.js';
import { mapRecording, mapRelease, selectRelease } from './musicbrainz.mapping.js';
import { buildRecordingQuery, selectByIsrc, selectRecording, type RecordingMatch } from './musicbrainz.match.js';
import type {
    MusicBrainzArtistRef,
    MusicBrainzIsrcResponse,
    MusicBrainzRecording,
    MusicBrainzRecordingSearchResponse,
    MusicBrainzRelease,
} from './musicbrainz.types.js';

export { musicbrainzManifest } from './musicbrainz.manifest.js';

/** Candidates to score. Deep enough to get past a run of remasters, shallow enough to stay one page. */
const SEARCH_LIMIT = 10;

/** What the recording lookup asks for: everything phase-one mapping reads, in one request. */
const RECORDING_INC = 'artist-credits+releases+release-groups+isrcs+genres+tags';

/** What the ISRC and search lookups ask for, which is only what scoring needs to choose. */
const CANDIDATE_INC = 'artist-credits+releases';

/** The label. `cover-art-archive` arrives on any release lookup and needs no `inc` of its own. */
const RELEASE_INC = 'labels';

/**
 * Budget below which an optional lookup is not worth starting: one second of
 * pacing plus the request itself, rounded up. Under this, the call would spend
 * the caller's remaining deadline waiting for a rate-limit slot and be
 * abandoned before the answer arrived.
 */
const OPTIONAL_STEP_MIN_MS = 2_000;

function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

/**
 * MusicBrainz as a deadair `enrichment` source: the canonical answer to "what
 * is this recording, actually".
 *
 * It runs at priority 100 because it is the identity database rather than an
 * opinion about one. When it and another plugin disagree about an artist's
 * spelling or a release year, this one should win, and the fields it
 * deliberately never fills (`biography`, `bpm`, `musicalKey`, `moods` — see
 * `musicbrainz.mapping.ts`) are left for the plugins that actually know them.
 *
 * Every request goes through `host.fetch`, which paces them at the one per
 * second MusicBrainz asks anonymous clients to keep. That pacing is declared
 * on the manifest's network entries, not implemented here, and it is why the
 * request count per track matters as much as it does: each one costs a second
 * of the caller's budget. Identity is worth spending that on and is allowed to
 * fail the call; everything after it goes through {@link optional}, which
 * checks `host.remainingMs()` first and drops the step rather than the
 * enrichment.
 */
export class MusicBrainzPlugin implements EnrichmentPluginInstance {
    /** Canonical source, per the SDK's own scale. Lower runs first and wins conflicts on merge. */
    readonly priority = 100;

    readonly matchKeys: EnrichmentMatchKey[] = ['isrc', 'artist-title'];

    private host?: PluginHost;
    private client?: MusicBrainzClient;
    private matchScore = DEFAULT_MATCH_SCORE;
    private includeArtwork = true;

    async init(host: PluginHost): Promise<void> {
        this.host = host;

        const config = await host.config.get();
        const contactEmail = typeof config.contactEmail === 'string' ? config.contactEmail.trim() : '';
        const baseUrl = typeof config.baseUrl === 'string' && config.baseUrl.length > 0 ? config.baseUrl : DEFAULT_BASE_URL;
        const matchScore = Number(config.matchScore);
        this.matchScore = Number.isFinite(matchScore) ? matchScore : DEFAULT_MATCH_SCORE;
        this.includeArtwork = config.includeArtwork !== false;

        // No contact address means no client at all rather than a client that
        // will be refused on every call: MusicBrainz blocks unidentified
        // traffic, and one clear config error beats a 403 per track.
        this.client = contactEmail.length > 0 ? new MusicBrainzClient(host, baseUrl, contactEmail) : undefined;

        host.logger.info('musicbrainz enrichment ready', { configured: this.client !== undefined, baseUrl });
    }

    async dispose(): Promise<void> {
        this.host = undefined;
        this.client = undefined;
    }

    async testConnection(): Promise<PluginConnectionResult> {
        if (!this.client) return { ok: false, message: 'Add a contact email address. MusicBrainz refuses clients that do not identify themselves.' };

        try {
            const artist = await this.client.get<MusicBrainzArtistRef>(`artist/${TEST_ARTIST_MBID}`);
            // The known-MBID lookup is a health check, so the assertion is that
            // the answer is a MusicBrainz artist document and not merely a 200
            // from whatever is listening on the configured address.
            if (!artist.name) return { ok: false, message: 'That URL answered, but not with a MusicBrainz artist. Check the web service path.' };
            return { ok: true, message: 'Connected to MusicBrainz.' };
        } catch (error) {
            if (error instanceof MusicBrainzRequestError) return { ok: false, message: `MusicBrainz replied HTTP ${error.status}.` };
            return { ok: false, message: errorText(error) };
        }
    }

    /**
     * Identify the track, then say what MusicBrainz knows about it.
     *
     * A miss is `{}`, per the SDK contract: no match, an unconfigured plugin
     * and a 404 are all "nothing to add" to the caller, and none of them are
     * worth failing an enrichment pass over. A broken upstream still throws,
     * because that is the host's to see.
     */
    async enrichTrack(ref: TrackRef): Promise<Partial<TrackEnrichment>> {
        if (!this.client) return {};

        const match = await this.identify(ref);
        if (!match) return {};

        const recording = await this.loadRecording(match.recording);
        const summary = selectRelease(recording, ref);

        // The release detail goes underneath, so what the recording knows wins
        // and this only fills the gaps it left. See `mapRelease`.
        const release = await this.optional('release', () => this.loadRelease(summary?.id));
        return { ...mapRelease(release ?? summary, this.includeArtwork), ...mapRecording(recording, summary, ref) };
    }

    /**
     * Runs a step the enrichment would rather have than fail over.
     *
     * Two ways out, and both return `undefined` instead of throwing. The budget
     * check comes first: at one request per second, an optional lookup started
     * with no time left is a second of the caller's deadline spent on a result
     * that arrives after the call is abandoned. The catch is the second: an
     * identified track with no label on it is a good answer, and an upstream
     * hiccup on the third request should not throw away the two that worked.
     */
    private async optional<T>(step: string, run: () => Promise<T | undefined>): Promise<T | undefined> {
        const remainingMs = (await this.host?.remainingMs()) ?? 0;
        if (remainingMs < OPTIONAL_STEP_MIN_MS) {
            this.host?.logger.debug('musicbrainz skipped an optional lookup, out of budget', { step, remainingMs });
            return undefined;
        }

        try {
            return await run();
        } catch (error) {
            this.host?.logger.debug('musicbrainz dropped an optional lookup', { step, reason: errorText(error) });
            return undefined;
        }
    }

    /**
     * `/release/{id}?inc=labels`, for the label and the cover art flag. The
     * release summary carried on the recording has neither: it is the stub
     * MusicBrainz embeds, not the entity.
     */
    private async loadRelease(releaseId: string | undefined): Promise<MusicBrainzRelease | undefined> {
        if (!releaseId) return undefined;
        return this.client!.get<MusicBrainzRelease>(`release/${releaseId}`, { inc: RELEASE_INC });
    }

    /** The ISRC when there is one, the search when there is not. */
    private async identify(ref: TrackRef): Promise<RecordingMatch | undefined> {
        if (ref.isrc) {
            const byIsrc = await this.lookupIsrc(ref);
            if (byIsrc) return byIsrc;
        }

        return this.searchRecording(ref);
    }

    /**
     * `/isrc/{code}`. A 404 is the ordinary answer for a code MusicBrainz has
     * never seen, so it falls through to the search rather than failing: plenty
     * of a provider's ISRCs are simply not in the database.
     */
    private async lookupIsrc(ref: TrackRef): Promise<RecordingMatch | undefined> {
        if (!ref.isrc) return undefined;

        try {
            const response = await this.client!.get<MusicBrainzIsrcResponse>(`isrc/${encodeURIComponent(ref.isrc)}`, { inc: CANDIDATE_INC });
            const match = selectByIsrc(response.recordings ?? [], ref);
            if (!match) this.host?.logger.debug('musicbrainz isrc resolved to nothing usable', { isrc: ref.isrc });
            return match;
        } catch (error) {
            if (error instanceof MusicBrainzRequestError && error.status === 404) return undefined;
            throw error;
        }
    }

    private async searchRecording(ref: TrackRef): Promise<RecordingMatch | undefined> {
        const response = await this.client!.get<MusicBrainzRecordingSearchResponse>('recording', {
            query: buildRecordingQuery(ref),
            limit: String(SEARCH_LIMIT),
        });

        const match = selectRecording(response.recordings ?? [], ref, this.matchScore);
        if (!match) {
            this.host?.logger.debug('musicbrainz found no confident match', { artist: ref.artist, title: ref.title, minScore: this.matchScore });
        }
        return match;
    }

    /**
     * The full recording document for a match.
     *
     * The candidate this plugin already holds came back under a narrower `inc`
     * (it only had to be good enough to choose between), so the genres, ISRCs
     * and release groups the mapping wants need the lookup. If that second
     * request fails, the candidate is mapped as-is: a partial answer built from
     * what is in hand beats losing a confident match to a hiccup.
     */
    private async loadRecording(candidate: MusicBrainzRecording): Promise<MusicBrainzRecording> {
        if (!candidate.id) return candidate;

        try {
            return await this.client!.get<MusicBrainzRecording>(`recording/${candidate.id}`, { inc: RECORDING_INC });
        } catch (error) {
            this.host?.logger.warn('musicbrainz recording lookup failed, using the search result', {
                recordingId: candidate.id,
                reason: errorText(error),
            });
            return candidate;
        }
    }
}
