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
import { ListenBrainzClient, ListenBrainzRequestError, LOOKUP_BATCH_SIZE, METADATA_BATCH_SIZE } from './listenbrainz.client.js';
import { lookupKey, mapListenBrainz, resultKey, toLookupQuery } from './listenbrainz.mapping.js';
import { DEFAULT_BASE_URL, DEFAULT_MATCH_SCORE, TEST_ARTIST_MBID } from './musicbrainz.manifest.js';
import { mapArtist } from './musicbrainz.artist.js';
import { mapAlbum, mapRecording, selectRelease, selectReleaseFromGroup } from './musicbrainz.mapping.js';
import {
    buildIsrcBatchQuery,
    buildRecordingQuery,
    escapeLucene,
    selectByIsrc,
    selectFromTracklist,
    selectRecording,
    baseForm,
    type RecordingMatch,
} from './musicbrainz.match.js';
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
 * What the batch path's release lookup asks for: the whole tracklist, with
 * enough on each recording to match a ref against it and then map it.
 *
 * No `genres`, which a release lookup will not take. That is the one thing a
 * track identified this way gives up, and it is why {@link enrichTracks} only
 * takes this path for a record with several outstanding tracks on it: a genre
 * per track is worth less than the twenty requests it would cost to keep.
 */
const RELEASE_TRACKLIST_INC = 'recordings+artist-credits+isrcs+release-groups';

/**
 * Outstanding tracks on one record below which the release lookup is not worth
 * it. Two tracks cost two requests either way (a release-group search plus the
 * release), so the path only starts paying at three.
 */
const TRACKLIST_MIN_TRACKS = 3;

/**
 * ISRCs per batched search.
 *
 * The same as {@link MAX_BATCH_SIZE}, so one `enrichTracks` call is one search
 * and never two. It was fifty, which is what the query syntax will take but not
 * what the response will fit in: see {@link MusicBrainzPlugin.searchIsrcBatch}.
 */
const ISRC_BATCH_SIZE = 25;

/** Hard ceiling on results asked for, well under the host's five megabyte body cap. */
const ISRC_SEARCH_LIMIT = 40;

/** Slack over the chunk size, for the codes that resolve to more than one recording. */
const ISRC_SEARCH_HEADROOM = 5;

/**
 * Refs handed over in one {@link MusicBrainzPlugin.enrichTracks} call.
 *
 * The host chunks to this, and it is sized to the batch identification step:
 * one OR'd ISRC search covers the whole chunk, so a bigger number would not buy
 * another request's worth of saving while a smaller one would waste the query.
 */
const MAX_BATCH_SIZE = 25;

/**
 * Budget below which an optional lookup is not worth starting: the one second
 * of pacing it will wait for a rate-limit slot, plus enough left over for the
 * request to be worth making at all.
 *
 * Deliberately not `REQUEST_TIMEOUT_MS`, which is a ceiling rather than an
 * expectation. The host caps each fetch by what remains of the invocation, so a
 * step begun with three seconds left gets a three second attempt, and most
 * answers arrive well inside that. Requiring a full timeout's worth of headroom
 * would skip the label on almost every record instead.
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

    /** See {@link enrichTracks}: sized to one batched ISRC search. */
    readonly maxBatchSize = MAX_BATCH_SIZE;

    private host?: PluginHost;
    private client?: MusicBrainzClient;
    private listenBrainz?: ListenBrainzClient;
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

        // The fast path, when the operator supplied a token. Absent is the
        // ordinary case and costs nothing: every path below falls back to the
        // web service, so a station with no token is exactly as correct and
        // only slower.
        const token = (await host.secrets.get('listenBrainzToken'))?.trim() ?? '';
        this.listenBrainz = token.length > 0 ? new ListenBrainzClient(host, token) : undefined;

        host.logger.info('musicbrainz enrichment ready', {
            configured: this.client !== undefined,
            baseUrl,
            listenBrainz: this.listenBrainz !== undefined,
        });
    }

    async dispose(): Promise<void> {
        this.host = undefined;
        this.client = undefined;
        this.listenBrainz = undefined;
    }

    async testConnection(): Promise<PluginConnectionResult> {
        if (!this.client) return { ok: false, message: 'Add a contact email address. MusicBrainz refuses clients that do not identify themselves.' };

        try {
            const artist = await this.client.get<MusicBrainzArtistRef>(`artist/${TEST_ARTIST_MBID}`);
            // The known-MBID lookup is a health check, so the assertion is that
            // the answer is a MusicBrainz artist document and not merely a 200
            // from whatever is listening on the configured address.
            if (!artist.name) return { ok: false, message: 'That URL answered, but not with a MusicBrainz artist. Check the web service path.' };

            // Both transports are reported, because "connected" is not the
            // question an operator is really asking here: they want to know
            // whether the token they just pasted in is doing anything.
            if (!this.listenBrainz) {
                return { ok: true, message: 'Connected to MusicBrainz. No ListenBrainz token, so enrichment runs one request per second.' };
            }

            try {
                await this.listenBrainz.lookup([{ artist_name: 'Portishead', recording_name: 'Glory Box' }]);
                return { ok: true, message: 'Connected to MusicBrainz, with ListenBrainz batching enabled.' };
            } catch (error) {
                const reason = error instanceof ListenBrainzRequestError ? `HTTP ${error.status}` : errorText(error);
                return {
                    ok: true,
                    message: `Connected to MusicBrainz, but ListenBrainz refused the token (${reason}). Enrichment will fall back to one request per second.`,
                };
            }
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
     * The same question as {@link enrichTrack} about a whole batch, answered in
     * as few requests as the batch's shape allows.
     *
     * Three strategies, cheapest per track first, each one handing what it could
     * not account for to the next:
     *
     * 1. **A record at a time.** Refs that share an album, three or more of
     *    them, are answered by one `release/{id}?inc=recordings` lookup: two
     *    requests for the whole record instead of two per track on it. The
     *    catalog arrives clustered by album precisely so this can happen.
     * 2. **The rest of the ISRCs, together.** One `recording?query=isrc:A OR
     *    isrc:B …` identifies up to fifty codes in a single request. The results
     *    do not say which code answered which, so they are scored back against
     *    the refs rather than read positionally.
     * 3. **One at a time**, which is {@link enrichTrack}'s path, for whatever is
     *    left: no album, no ISRC, or simply not found by the two above.
     *
     * The array returned is index-aligned with `refs` and the same length, per
     * the SDK contract. A ref nothing could account for is `{}`, which the host
     * stores as a miss on a short clock rather than as an answer.
     */
    async enrichTracks(refs: TrackRef[]): Promise<Partial<TrackEnrichment>[]> {
        const answers: Partial<TrackEnrichment>[] = refs.map(() => ({}));
        if (!this.client) return answers;

        // Positions rather than refs throughout: every answer has to find its
        // way back to the slot it belongs in, and two refs in a batch can be
        // the same recording on two different pressings.
        let outstanding = refs.map((_ref, index) => index);

        outstanding = await this.resolveByListenBrainz(refs, outstanding, answers);
        outstanding = await this.resolveByRelease(refs, outstanding, answers);
        outstanding = await this.resolveByIsrcBatch(refs, outstanding, answers);

        for (const index of outstanding) {
            // The per-ref path is allowed to fail without taking the batch with
            // it: the requests already spent on the other refs are real, and a
            // miss here is recoverable next pass while losing them is not.
            // This is the tail, and the expensive part: two paced requests per
            // ref, where everything above answered many refs at once. `optional`
            // sheds it as soon as the budget runs low, which is what stops a
            // slow upstream from spending the whole invocation here and having
            // the host abandon the call with every answer above still in hand.
            const resolved = await this.optional('track', () => this.resolve(refs[index]!));
            if (resolved) answers[index] = resolved;
        }

        return answers;
    }

    /**
     * Strategy zero, and the one that changes the order of magnitude: the whole
     * batch through ListenBrainz, in two requests.
     *
     * One `metadata/lookup` turns up to fifty artist-and-title pairs into
     * MusicBrainz ids; one `metadata/recording` describes every id it returned.
     * Twenty-five tracks that would cost thirty-eight paced requests on the web
     * service cost two here, on a limiter with a hundred times the headroom.
     *
     * Skipped entirely when no token is configured, which is the default. Every
     * ref it cannot account for falls through to the MusicBrainz paths below, so
     * this is a shortcut and never the only way through.
     *
     * The lookup's answers are matched to refs by the echoed `_arg` fields
     * rather than by position: a pair it could not resolve is absent from the
     * response, so the array is not parallel to the one that was sent.
     */
    private async resolveByListenBrainz(refs: TrackRef[], outstanding: number[], answers: Partial<TrackEnrichment>[]): Promise<number[]> {
        if (!this.listenBrainz || outstanding.length === 0) return outstanding;

        const answered = new Set<number>();

        for (let cursor = 0; cursor < outstanding.length; cursor += LOOKUP_BATCH_SIZE) {
            const chunk = outstanding.slice(cursor, cursor + LOOKUP_BATCH_SIZE);

            const results = await this.optional('listenbrainz lookup', async () =>
                this.listenBrainz!.lookup(chunk.map(index => toLookupQuery(refs[index]!))),
            );
            if (!results || results.length === 0) continue;

            const byKey = new Map(results.filter(result => result.recording_mbid).map(result => [resultKey(result), result]));
            if (byKey.size === 0) continue;

            // One metadata request for everything the lookup identified. A
            // failure here is not fatal: the ids alone are a real answer, and
            // mapping without the metadata block is exactly what happens.
            const mbids = [...byKey.values()].map(result => result.recording_mbid!);
            const metadata =
                (await this.optional('listenbrainz metadata', async () =>
                    this.listenBrainz!.recordingMetadata(mbids.slice(0, METADATA_BATCH_SIZE)),
                )) ?? {};

            for (const index of chunk) {
                const ref = refs[index]!;
                const result = byKey.get(lookupKey(ref.artist, ref.title));
                if (!result?.recording_mbid) continue;

                const mapped = mapListenBrainz(result, metadata[result.recording_mbid], ref);
                if (Object.keys(mapped).length === 0) continue;

                answers[index] = mapped;
                answered.add(index);
            }

            this.host?.logger.debug('listenbrainz answered a batch', {
                asked: chunk.length,
                matched: chunk.filter(index => answered.has(index)).length,
            });
        }

        return outstanding.filter(index => !answered.has(index));
    }

    /**
     * Strategy one: the refs that share a record, answered off its tracklist.
     *
     * Returns the positions this could not account for. A group whose release
     * could not be identified is handed on whole rather than half-answered, and
     * so is any individual track the tracklist did not contain — a provider's
     * "album" is often a deluxe edition or a compilation whose contents do not
     * line up with the release MusicBrainz chose.
     */
    private async resolveByRelease(refs: TrackRef[], outstanding: number[], answers: Partial<TrackEnrichment>[]): Promise<number[]> {
        const groups = new Map<string, number[]>();
        for (const index of outstanding) {
            const album = refs[index]!.album;
            if (!album) continue;
            const key = `${baseForm(refs[index]!.artist)} ${baseForm(album)}`;
            groups.set(key, [...(groups.get(key) ?? []), index]);
        }

        const answered = new Set<number>();

        for (const indices of groups.values()) {
            if (indices.length < TRACKLIST_MIN_TRACKS) continue;

            const release = await this.optional('release tracklist', () => this.loadTracklist(refs[indices[0]!]!));
            if (!release) continue;

            const tracklist = (release.media ?? [])
                .flatMap(medium => medium.tracks ?? [])
                .flatMap(track => (track.recording ? [track.recording] : []));
            if (tracklist.length === 0) continue;

            for (const index of indices) {
                const match = selectFromTracklist(tracklist, refs[index]!, this.matchScore);
                if (!match) continue;
                answers[index] = mapRecording(match.recording, release, refs[index]!);
                answered.add(index);
            }

            this.host?.logger.debug('musicbrainz answered a record from its tracklist', {
                album: refs[indices[0]!]!.album,
                asked: indices.length,
                matched: indices.filter(index => answered.has(index)).length,
            });
        }

        return outstanding.filter(index => !answered.has(index));
    }

    /**
     * Strategy two: everything left that carries an ISRC, identified and
     * described by a single search.
     *
     * The answers are mapped straight out of the search documents. That is the
     * whole point, and it was the mistake in the first version of this method:
     * it identified twenty-five tracks in one request and then spent one
     * `recording/{id}` lookup on each of them to fill in the genres, which is
     * twenty-five paced seconds — past the batch call's deadline, so the
     * invocation was killed and every one of those answers, including the
     * identification that had already succeeded, was thrown away. A batch path
     * that ends in a per-entity lookup is not a batch path.
     *
     * What a search document cannot give is `genres`, so a track described this
     * way has none. That is the same trade the tracklist path already makes,
     * and it is the right one: the alternative on a rate-limited source is not
     * "the same answer plus genres", it is no answer at all.
     *
     * The pool is scored against every ref rather than assumed to be in order,
     * because a search document does not reliably echo the code it matched. A
     * recording may answer only one ref: two refs that genuinely are the same
     * recording are rare, and letting one document satisfy both would hide a
     * mismatch rather than fall through to the per-ref path that would catch it.
     */
    private async resolveByIsrcBatch(refs: TrackRef[], outstanding: number[], answers: Partial<TrackEnrichment>[]): Promise<number[]> {
        const withIsrc = outstanding.filter(index => refs[index]!.isrc);
        if (withIsrc.length < 2) return outstanding;

        const answered = new Set<number>();

        for (let cursor = 0; cursor < withIsrc.length; cursor += ISRC_BATCH_SIZE) {
            const chunk = withIsrc.slice(cursor, cursor + ISRC_BATCH_SIZE);
            const pool = await this.optional('isrc batch', () => this.searchIsrcBatch(chunk.map(index => refs[index]!.isrc!)));
            if (!pool || pool.length === 0) continue;

            const taken = new Set<string>();
            for (const index of chunk) {
                const available = pool.filter(recording => recording.id && !taken.has(recording.id));
                const match = selectRecording(available, refs[index]!, this.matchScore);
                if (!match?.recording.id) continue;

                taken.add(match.recording.id);
                answers[index] = mapRecording(match.recording, selectRelease(match.recording, refs[index]!), refs[index]!);
                answered.add(index);
            }

            this.host?.logger.debug('musicbrainz identified a batch of isrcs in one search', { asked: chunk.length, matched: taken.size });
        }

        return outstanding.filter(index => !answered.has(index));
    }

    /** The record a ref names, as a release with its whole tracklist on it. */
    private async loadTracklist(ref: TrackRef): Promise<MusicBrainzRelease | undefined> {
        const groupId = await this.searchReleaseGroup({ name: ref.album!, artist: ref.artist });
        if (!groupId) return undefined;

        const group = await this.loadReleaseGroup(groupId);
        const chosen = selectReleaseFromGroup(group);
        if (!chosen?.id) return undefined;

        return this.client!.get<MusicBrainzRelease>(`release/${chosen.id}`, { inc: RELEASE_TRACKLIST_INC });
    }

    /**
     * One `recording?query=isrc:A OR isrc:B …`, for a whole chunk of codes.
     *
     * `limit` is barely above the number of codes asked about, and that is a
     * size limit rather than a relevance one. A search document carries every
     * release the recording appears on, which for a charting single is
     * hundreds; at a hundred results the response came back over five megabytes
     * and the host refused it outright, losing the whole chunk. A little
     * headroom over the chunk covers the codes that map to more than one
     * recording, and nothing more.
     */
    private async searchIsrcBatch(isrcs: string[]): Promise<MusicBrainzRecording[]> {
        const response = await this.client!.get<MusicBrainzRecordingSearchResponse>('recording', {
            query: buildIsrcBatchQuery(isrcs),
            limit: String(Math.min(ISRC_SEARCH_LIMIT, isrcs.length + ISRC_SEARCH_HEADROOM)),
        });

        return response.recordings ?? [];
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
     *
     * The title is searched in its {@link baseForm}, which is what makes this
     * work on a real library. A provider's album names are full of pressing
     * detail that MusicBrainz keeps on the release rather than the release
     * group — "Jagged Little Pill (2015 Remaster)", "Check Your Head (Deluxe
     * Edition/Remastered/2009)" — and the query is a quoted phrase, so every
     * one of those tokens has to appear, in order, in a title that is really
     * just "Jagged Little Pill". They matched nothing, which cost a request and
     * then a week-long miss row, on most of the remastered catalogue.
     */
    private async searchReleaseGroup(ref: AlbumRef): Promise<string | undefined> {
        const title = baseForm(ref.name) || ref.name;
        const response = await this.client!.get<MusicBrainzReleaseGroupSearchResponse>('release-group', {
            query: `releasegroup:"${escapeLucene(title)}" AND artist:"${escapeLucene(ref.artist)}"`,
            limit: '1',
        });

        const found = response['release-groups']?.[0];
        if (!found?.id) this.host?.logger.debug('musicbrainz found no release group', { album: ref.name, searched: title, artist: ref.artist });
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

        // Upper case, because MusicBrainz answers 400 rather than 404 for a
        // lower case code and providers are not consistent about it: Spotify
        // hands back both `GBDHC2551205` and `usbhp0500081`. An ISRC is defined
        // as upper case, so this is normalising rather than guessing.
        const isrc = ref.isrc.toUpperCase();

        try {
            const response = await this.client!.get<MusicBrainzIsrcResponse>(`isrc/${encodeURIComponent(isrc)}`, { inc: CANDIDATE_INC });
            const match = selectByIsrc(response.recordings ?? [], ref);
            if (!match) this.host?.logger.debug('musicbrainz isrc resolved to nothing usable', { isrc });
            return match;
        } catch (error) {
            // 404 is a code MusicBrainz has never seen; 400 is one it will not
            // accept at all. Both mean this key cannot answer, and neither is a
            // reason to fail a track that the search could still identify —
            // less still to spend a strike on the breaker and have one bad code
            // in a rotation quarantine the plugin.
            if (error instanceof MusicBrainzRequestError && (error.status === 404 || error.status === 400)) {
                this.host?.logger.debug('musicbrainz would not take that isrc, falling back to the search', { isrc, status: error.status });
                return undefined;
            }
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
