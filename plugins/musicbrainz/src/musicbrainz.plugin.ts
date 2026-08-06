import {
    type AlbumEnrichment,
    type AlbumRef,
    type ArtistEnrichment,
    type ArtistRef,
    type EnrichmentMatchKey,
    type EnrichmentPluginInstance,
    type PluginConnectionResult,
    type PluginHost,
    type TrackEnrichment,
    type TrackRef,
} from '@deadair/plugin-sdk';

import { MusicBrainzClient, MusicBrainzRequestError } from './musicbrainz.client.js';
import { DEFAULT_BASE_URL, DEFAULT_MATCH_SCORE, TEST_ARTIST_MBID } from './musicbrainz.manifest.js';
import { mapArtist } from './musicbrainz.artist.js';
import { mapAlbum, mapRecording, selectRelease, selectReleaseFromGroup } from './musicbrainz.mapping.js';
import { buildRecordingQuery, escapeLucene, selectByIsrc, selectRecording, type RecordingMatch } from './musicbrainz.match.js';
import type {
    MusicBrainzArtist,
    MusicBrainzArtistRef,
    MusicBrainzArtistSearchResponse,
    MusicBrainzIsrcResponse,
    MusicBrainzRecording,
    MusicBrainzRecordingSearchResponse,
    MusicBrainzRelease,
    MusicBrainzReleaseGroup,
    MusicBrainzReleaseGroupSearchResponse,
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

/** Links out. The artist's own area and life span come with the entity itself. */
const ARTIST_INC = 'url-rels';

/** What the release-group lookup asks for: the pressings to choose from, plus the record's own vocabulary. */
const RELEASE_GROUP_INC = 'artist-credits+releases+genres+tags';

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
 *
 * That budget is also why the artist lives in `enrichArtist` rather than in
 * `enrichTrack`. The host asks about an artist once per artist, so the answer
 * covers every track they appear on instead of being bought again for each.
 */
export class MusicBrainzPlugin implements EnrichmentPluginInstance {
    /** Canonical source, per the SDK's own scale. Lower runs first and wins conflicts on merge. */
    readonly priority = 100;

    readonly matchKeys: EnrichmentMatchKey[] = ['isrc', 'artist-title'];

    private host?: PluginHost;
    private client?: MusicBrainzClient;
    private matchScore = DEFAULT_MATCH_SCORE;
    private includeArtwork = true;
    private includeArtistFacts = true;

    async init(host: PluginHost): Promise<void> {
        this.host = host;

        const config = await host.config.get();
        const contactEmail = typeof config.contactEmail === 'string' ? config.contactEmail.trim() : '';
        const baseUrl = typeof config.baseUrl === 'string' && config.baseUrl.length > 0 ? config.baseUrl : DEFAULT_BASE_URL;
        const matchScore = Number(config.matchScore);
        this.matchScore = Number.isFinite(matchScore) ? matchScore : DEFAULT_MATCH_SCORE;
        this.includeArtwork = config.includeArtwork !== false;
        this.includeArtistFacts = config.includeArtistFacts !== false;

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
     *
     * Nothing is remembered here. The host stores every answer against the
     * track, per provider, with its own expiry, and does not call this at all
     * while that row is live — so a cache on this side would only ever be
     * consulted for a track the host had already decided was stale.
     */
    async enrichTrack(ref: TrackRef): Promise<Partial<TrackEnrichment>> {
        if (!this.client) return {};
        return (await this.resolve(ref)) ?? {};
    }

    /**
     * What MusicBrainz knows about an artist rather than about one of their
     * recordings.
     *
     * Asked once per artist by the host, which is the whole reason this is a
     * method and not a step inside `enrichTrack`. A rotation revisits the same
     * few hundred artists constantly and an artist's background changes on a
     * scale of years, so paying for this per track was paying forty times for
     * one answer.
     *
     * Identity first, and free when the host already has it: `mbid` is what the
     * track pass promoted onto `artists.mbid`, and `providerRef` is the id this
     * plugin itself answered under last time. They are the same id here, and
     * either one turns a search into a lookup.
     */
    async enrichArtist(ref: ArtistRef): Promise<Partial<ArtistEnrichment>> {
        if (!this.client || !this.includeArtistFacts) return {};

        const artistId = ref.mbid ?? ref.providerRef ?? (await this.searchArtist(ref.name));
        if (!artistId) return {};

        const artist = await this.loadArtist(artistId);
        return mapArtist(artist);
    }

    /**
     * What MusicBrainz knows about a record.
     *
     * Two requests: the release group for identity, dates and genres, then one
     * release out of it for the label and the cover, which are the only things
     * a release group document cannot say. Those two facts used to cost a
     * `release/{id}` request per *track*, so a twelve track album bought the
     * same answer twelve times.
     */
    async enrichAlbum(ref: AlbumRef): Promise<Partial<AlbumEnrichment>> {
        if (!this.client) return {};

        const groupId = ref.mbid ?? ref.providerRef ?? (await this.searchReleaseGroup(ref));
        if (!groupId) return {};

        const group = await this.loadReleaseGroup(groupId);
        const chosen = selectReleaseFromGroup(group);

        // Optional, not required: an identified record with no label on it is a
        // good answer, and this is the request most likely to be the one that
        // runs out of budget.
        const release = await this.optional('release', () => this.loadRelease(chosen?.id));

        return mapAlbum(group, release ?? chosen, this.includeArtwork);
    }

    /**
     * `/release-group?query=`, for a record the host has no id for yet.
     *
     * Artist and title together, because a title alone is not a record: half
     * the catalogue has a "Greatest Hits".
     */
    private async searchReleaseGroup(ref: AlbumRef): Promise<string | undefined> {
        const response = await this.client!.get<MusicBrainzReleaseGroupSearchResponse>('release-group', {
            query: `releasegroup:"${escapeLucene(ref.name)}" AND artist:"${escapeLucene(ref.artist)}"`,
            limit: '1',
        });

        const found = response['release-groups']?.[0];
        if (!found?.id) this.host?.logger.debug('musicbrainz found no release group', { album: ref.name, artist: ref.artist });
        return found?.id;
    }

    private async loadReleaseGroup(groupId: string): Promise<MusicBrainzReleaseGroup> {
        return this.client!.get<MusicBrainzReleaseGroup>(`release-group/${groupId}`, { inc: RELEASE_GROUP_INC });
    }

    /**
     * The whole request sequence for one track. `undefined` is a genuine miss.
     *
     * Two requests now: identify, then the recording document. The label and
     * the cover art moved to {@link enrichAlbum}, where they are bought once
     * per record rather than once per track — they are properties of a
     * pressing, not of a performance.
     */
    private async resolve(ref: TrackRef): Promise<Partial<TrackEnrichment> | undefined> {
        const match = await this.identify(ref);
        if (!match) return undefined;

        const recording = await this.loadRecording(match.recording);

        // The release summary embedded in the recording document, which costs
        // no request of its own: the album title, the release ids, and a date
        // to fall back on.
        return mapRecording(recording, selectRelease(recording, ref), ref);
    }

    /**
     * `/artist?query=`, for an artist the host has no id for yet.
     *
     * One result, and no scoring: an artist name is a far less ambiguous
     * question than a recording title, and the failure mode of a wrong artist
     * here is a stored payload against a canonical row rather than the DJ
     * introducing the wrong song. `undefined` when the search says nothing,
     * which the host remembers as a miss on a short clock.
     */
    private async searchArtist(name: string): Promise<string | undefined> {
        const response = await this.client!.get<MusicBrainzArtistSearchResponse>('artist', {
            query: `artist:"${escapeLucene(name)}"`,
            limit: '1',
        });

        const found = response.artists?.[0];
        if (!found?.id) this.host?.logger.debug('musicbrainz found no artist by that name', { artist: name });
        return found?.id;
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

    /**
     * `/artist/{id}?inc=url-rels`, for the background and the links out.
     *
     * Only the relations are asked for. The artist's own genres are broader
     * than the track's and would drown the recording's in the merge, and the
     * point of this request is the things a recording document cannot say:
     * where they are from, when they were around, and where to read more.
     */
    private async loadArtist(artistId: string | undefined): Promise<MusicBrainzArtist | undefined> {
        if (!artistId) return undefined;
        return this.client!.get<MusicBrainzArtist>(`artist/${artistId}`, { inc: ARTIST_INC });
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
