import { z } from 'zod';

import type { PluginOAuth, TrackFetchRequest } from '../src/plugin.host.js';
import type { PlaybackState, ProviderPlaylist, ProviderStream, ProviderTrack } from '../src/capabilities/music.provider.js';
import type {
    AlbumEnrichment,
    AlbumRef,
    ArtistEnrichment,
    ArtistRef,
    ExternalId,
    ExternalLink,
    TrackEnrichment,
    TrackRef,
} from '../src/capabilities/enrichment.js';
import type { PluginConnectionResult } from '../src/plugin.lifecycle.js';
import type { PluginManifest } from '../src/plugin.manifest.js';
import type { ConfigField } from '../src/plugin.config.fields.js';
import type { SpeechRequest, SpeechVoice } from '../src/capabilities/speech.js';
import type { LlmModelInfo, LlmRequest, LlmResult } from '../src/capabilities/llm.js';
import type { AnalysisRef, TrackAnalysis, TrackCuePoints, TrackLoudness, TrackTaggedLoudness } from '../src/capabilities/analysis.js';
import type { ChartDescriptor, ChartEntry, ChartQuery } from '../src/capabilities/charts.js';
import type { NewsFeedDescriptor, NewsItem, NewsQuery } from '../src/capabilities/news.js';
import type { ArtistTrack, SimilarArtist } from '../src/capabilities/similarity.js';
import type { ScrobblePlay, ScrobbleRejection, ScrobbleResult } from '../src/capabilities/scrobble.js';

/**
 * Throws with the offending property path when `value` is not JSON-safe.
 *
 * JSON-safe is strictly narrower than structured-clone-safe: no `Date`,
 * `Map`, `Set`, `RegExp`, `BigInt`, `ArrayBuffer`, typed array, or any object
 * whose prototype is neither `Object.prototype` nor `null` nor
 * `Array.prototype`. `undefined` is allowed as an object property value
 * (means "not set") but forbidden as an array element, since
 * `JSON.stringify` silently drops the former and turns the latter into
 * `null`.
 */
export function assertJsonSafe(value: unknown, path = '$'): void {
    if (value === null) return;
    if (value === undefined) {
        // Callers of assertJsonSafe from an array element pass a path that
        // already flags the context; the array walker below never lets an
        // `undefined` element reach this branch without failing first.
        return;
    }

    const type = typeof value;
    if (type === 'string' || type === 'boolean') return;

    if (type === 'number') {
        if (!Number.isFinite(value as number)) {
            throw new Error(`boundary payload not JSON-safe: non-finite number at ${path} (${String(value)})`);
        }
        return;
    }

    if (type === 'function') {
        throw new Error(`boundary payload not JSON-safe: function at ${path}`);
    }
    if (type === 'symbol') {
        throw new Error(`boundary payload not JSON-safe: symbol at ${path}`);
    }
    if (type === 'bigint') {
        throw new Error(`boundary payload not JSON-safe: bigint at ${path}`);
    }

    if (Array.isArray(value)) {
        value.forEach((element, index) => {
            if (element === undefined) {
                throw new Error(`boundary payload not JSON-safe: undefined array element at ${path}[${index}]`);
            }
            assertJsonSafe(element, `${path}[${index}]`);
        });
        return;
    }

    // Anything left is an object. Only a plain object (or a null-prototype
    // one) is allowed; anything else is a class instance, and this is the
    // single check that catches Date, Map, Set, RegExp and typed arrays
    // without a special case for each.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
        const named = namedClassCheck(value, path);
        throw new Error(named ?? `boundary payload not JSON-safe: object at ${path} is not a plain object (prototype is ${describeProto(value)})`);
    }

    for (const [key, propertyValue] of Object.entries(value as Record<string, unknown>)) {
        // undefined is legal here: an optional field explicitly set to
        // undefined is indistinguishable from one never set, and both are
        // legal per the repo's `?:` convention.
        if (propertyValue === undefined) continue;
        assertJsonSafe(propertyValue, `${path}.${key}`);
    }
}

/** Names the common offenders explicitly so the failure message is legible. */
function namedClassCheck(value: object, path: string): string | undefined {
    if (value instanceof Date) return `boundary payload not JSON-safe: Date at ${path}`;
    if (value instanceof Map) return `boundary payload not JSON-safe: Map at ${path}`;
    if (value instanceof Set) return `boundary payload not JSON-safe: Set at ${path}`;
    if (value instanceof RegExp) return `boundary payload not JSON-safe: RegExp at ${path}`;
    if (value instanceof ArrayBuffer) return `boundary payload not JSON-safe: ArrayBuffer at ${path}`;
    if (ArrayBuffer.isView(value)) return `boundary payload not JSON-safe: typed array at ${path}`;
    return undefined;
}

function describeProto(value: object): string {
    const proto = Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null;
    return proto?.constructor?.name ?? 'unknown';
}

/**
 * `structuredClone` round-trip plus {@link assertJsonSafe}. `structuredClone`
 * catches functions, class instances with behaviour, getters and symbols
 * (it throws on those); `assertJsonSafe` catches the narrower JSON-only rule
 * that `structuredClone` alone would happily pass (Date, Map, Set, typed
 * arrays all survive a structured clone but are still forbidden here).
 */
export function assertCrossesBoundary(value: unknown, label: string): void {
    let cloned: unknown;
    try {
        cloned = structuredClone(value);
    } catch (error) {
        throw new Error(`boundary payload "${label}" failed structuredClone: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!deepEqual(cloned, value)) {
        throw new Error(`boundary payload "${label}" changed shape across structuredClone`);
    }

    try {
        assertJsonSafe(value, '$');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`boundary payload "${label}" ${message}`);
    }
}

/** Structural equality good enough for the fixture shapes here: no cycles, no exotic types expected post-clone. */
function deepEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;

    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        return a.every((element, index) => deepEqual(element, b[index]));
    }

    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aRecord), ...Object.keys(bRecord)]);
    for (const key of keys) {
        if (!deepEqual(aRecord[key], bRecord[key])) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Fixtures: one realistic value per boundary shape, every optional field
// populated. See plugin.host.ts, capabilities/music.provider.ts,
// capabilities/enrichment.ts, plugin.lifecycle.ts, plugin.manifest.ts and
// plugin.config.fields.ts for the shapes these mirror.
// ---------------------------------------------------------------------------

export const speechRequestFixture: SpeechRequest = {
    text: "You're listening to Deadair. That was Boards of Canada.",
    voice: 'host',
    format: 'mp3',
};

export const speechVoiceFixture: SpeechVoice = {
    id: 'host',
    label: 'Station host',
    description: 'Warm, mid-register, the one that says the station name.',
};

/**
 * A whole tool round trip in one conversation: the ask, the assistant turn that
 * requested a tool, and the turn answering it. That ordering is the thing worth
 * pinning, because a model cannot make sense of a `tool` message without seeing
 * the call it answers.
 */
export const llmRequestFixture: LlmRequest = {
    messages: [
        { role: 'system', content: 'You are the voice of a radio station. Never invent a song.' },
        { role: 'user', content: 'Back-announce the last record and tease the next one.' },
        {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_1', name: 'search_catalog', arguments: { query: 'Boards of Canada', limit: 3 } }],
        },
        { role: 'tool', toolCallId: 'call_1', content: '[{"title":"Roygbiv","artist":"Boards of Canada"}]' },
    ],
    model: 'gpt-oss:20b',
    temperature: 0.8,
    maxOutputTokens: 200,
    reasoningEffort: 'low',
    tools: [
        {
            name: 'search_catalog',
            description:
                'Find tracks the station can actually play, by title or artist. Use it before naming anything you are not certain is in the library.',
            parameters: {
                type: 'object',
                properties: { query: { type: 'string' }, limit: { type: 'number' } },
                required: ['query'],
            },
        },
    ],
};

export const llmResultFixture: LlmResult = {
    text: 'That was Roygbiv, by Boards of Canada.',
    toolCalls: [{ id: 'call_2', name: 'search_catalog', arguments: { query: 'Telefon Tel Aviv' } }],
    usage: { inputTokens: 412, outputTokens: 28, totalTokens: 440 },
    finishReason: 'tool-calls',
};

export const llmModelInfoFixture: LlmModelInfo = {
    id: 'gpt-oss:20b',
    label: 'GPT-OSS 20B',
    tools: true,
};

export const analysisRefFixture: AnalysisRef = {
    trackId: '6d3f2b1a-0c4e-4f8a-9b7d-2e5a1c8f3b60',
    audioUrl: 'https://shim.example.com/track/abc123?exp=1767225600&sig=deadbeef',
    durationMs: 214_000,
};

export const trackCuePointsFixture: TrackCuePoints = {
    cueIn: 180,
    introEnd: 12_400,
    outroStart: 198_200,
    cueOut: 213_600,
};

/** A loud modern master: already near its ceiling, and overshooting between samples. */
export const trackLoudnessFixture: TrackLoudness = {
    integratedLufs: -8.4,
    truePeakDb: 1.2,
    samplePeakDb: -0.1,
};

/** The same master as tagged by whoever mastered it, which is a claim rather than a measurement. */
export const trackTaggedLoudnessFixture: TrackTaggedLoudness = {
    tagGainDb: -9.6,
    tagReferenceLufs: -18,
    tagPeakDb: -0.1,
};

/**
 * A v2-shaped payload rather than a v1 one, deliberately.
 *
 * `data` is `TrackCuePoints & Record<string, unknown>` precisely so a later
 * schema version can add fields the host never learns about, and a fixture that
 * only carried the four points would round-trip without ever exercising that.
 * The extra keys here are the beat layer as [track-analysis](https://github.com/robert-dean/deadair/discussions/45)
 * describes it, including an array, which is the shape most likely to be got
 * wrong.
 */
export const trackAnalysisFixture: TrackAnalysis = {
    schemaVersion: 2,
    complete: true,
    durationMs: 213_880,
    analyzer: 'deadair-analysis/0.2.1',
    data: {
        ...trackCuePointsFixture,
        ...trackLoudnessFixture,
        ...trackTaggedLoudnessFixture,
        bpm: 126.02,
        beatConfidence: 0.71,
        downbeats: [1840, 3744, 5648, 7552],
        vocalOnset: 21_300,
    },
};

/** The `meta` argument accepted by every `PluginLogger` method. */
export const pluginLoggerMetaFixture: Record<string, unknown> = {
    plugin: 'test.conformance',
    attempt: 2,
    nested: { hostname: 'api.example.com', retryable: true },
};

/** A nested POJO, the kind of value a plugin actually stores via `host.storage`. */
export const pluginStorageValueFixture: Record<string, unknown> = {
    lastSyncedAt: '2026-01-01T00:00:00.000Z',
    cursor: 'abc123',
    counts: { imported: 42, skipped: 0 },
    tags: ['a', 'b'],
};

export const pluginStorageListFixture: string[] = ['playlist:1', 'playlist:2', 'cursor'];

export const pluginSecretsGetFixture: string | undefined = 'sk-live-example';

export const pluginConfigGetFixture: Record<string, unknown> = {
    region: 'us',
    pageSize: 50,
    verbose: false,
};

export const pluginOAuthTokensFixture: Record<string, string> | undefined = {
    accessToken: 'access-token-value',
    refreshToken: 'refresh-token-value',
};

/** `PluginEvents.emit`'s payload argument. */
export const pluginEventsEmitPayloadFixture: Record<string, unknown> = {
    trackId: 'trk_1',
    status: 'playing',
};

export const providerTrackFixture: ProviderTrack = {
    id: 'trk_1',
    title: 'Everything In Its Right Place',
    artists: ['Radiohead'],
    album: 'Kid A',
    durationMs: 249_000,
    isrc: 'GBAYE0000351',
    artworkUrl: 'https://images.example.com/kid-a.jpg',
};

export const providerPlaylistFixture: ProviderPlaylist = {
    id: 'pl_1',
    name: 'Late Night',
    description: 'Slow songs for slow nights',
    trackCount: 12,
    artworkUrl: 'https://images.example.com/late-night.jpg',
};

export const providerStreamFixture: ProviderStream = {
    url: 'https://stream.example.com/trk_1.mp3?sig=abc',
    expiresAt: 1_893_456_000_000,
    mimeType: 'audio/mpeg',
};

export const trackFetchRequestFixture: TrackFetchRequest = {
    trackId: '4PTG3Z6ehGkBFwjybzWkR8',
    session: {
        username: 'the-station',
        accessToken: 'BQC_not_a_real_token',
        expiresAt: 1_893_456_000_000,
    },
};

export const searchTracksOptionsFixture = { limit: 20, offset: 40 };
export const listPlaylistsOptionsFixture = { limit: 20, offset: 0 };
export const getPlaylistTracksOptionsFixture = { limit: 20, offset: 0 };

export const playbackStateFixture: PlaybackState = {
    status: 'playing',
    trackId: 'trk_1',
    positionMs: 12_345,
    durationMs: 249_000,
};

export const trackRefFixture: TrackRef = {
    isrc: 'GBAYE0000351',
    artist: 'Radiohead',
    title: 'Everything In Its Right Place',
    album: 'Kid A',
    durationMs: 249_000,
    year: 2000,
};

export const chartDescriptorFixture: ChartDescriptor = {
    id: 'top-100-gb',
    name: 'Top 100 Songs',
    country: 'GB',
    description: 'The most played songs in the United Kingdom, updated daily.',
};

/** `date` is an ISO-8601 string, never a `Date`: a chart is a weekly document with a history. */
export const chartQueryFixture: ChartQuery = {
    chartId: 'top-100-gb',
    limit: 25,
    date: '1994-11-05',
};

/**
 * A collaboration, deliberately: `artist` is the LEAD credit alone and the rest ride in
 * `featuring`. A fixture that used a solo credit would round-trip just as happily and would
 * document nothing about the rule that actually matters here.
 */
export const chartEntryFixture: ChartEntry = {
    rank: 3,
    title: 'Under Pressure',
    artist: 'Queen',
    featuring: ['David Bowie'],
    album: 'Hot Space',
    year: 1981,
    peak: 1,
    weeksOn: 14,
};

export const newsFeedDescriptorFixture: NewsFeedDescriptor = {
    id: 'world',
    name: 'World news',
    category: 'world',
    language: 'en',
    description: 'Headlines from around the world.',
    pollHintMs: 300_000,
};

/** `since` is an ISO-8601 string, never a `Date`: it is how a caller asks what is new. */
export const newsQueryFixture: NewsQuery = {
    feedId: 'world',
    limit: 25,
    since: '2026-08-15T09:00:00.000Z',
};

/**
 * `summary` is plain text, deliberately: a fixture carrying markup would round-trip perfectly well
 * and would document the opposite of the rule, which is that nothing downstream strips tags.
 */
export const newsItemFixture: NewsItem = {
    id: 'urn:example:1',
    feedId: 'world',
    feedName: 'World news',
    title: 'Bridge reopens after four years',
    summary: 'The crossing reopened this morning and traffic is moving.',
    url: 'https://example.com/bridge',
    publishedAt: '2026-08-15T08:41:00.000Z',
    categories: ['Local', 'Transport'],
};

/** Carries both ids, since a source that knows an MBID and its own id should hand over both. */
export const similarArtistFixture: SimilarArtist = {
    name: 'Massive Attack',
    mbid: '10adbe5e-a2c0-4bf3-8249-2b4cbf6e6ca8',
    providerRef: 'lastfm:massive-attack',
    match: 0.82,
};

export const artistTrackFixture: ArtistTrack = {
    title: 'Teardrop',
    artist: 'Massive Attack',
    album: 'Mezzanine',
    year: 1998,
};

/** `playedAt` is epoch millis as an integer, never a `Date`: this one goes into a jsonb column. */
export const scrobblePlayFixture: ScrobblePlay = {
    title: 'Teardrop',
    artist: 'Massive Attack',
    album: 'Mezzanine',
    albumArtist: 'Massive Attack',
    durationMs: 330_000,
    trackNumber: 2,
    mbid: '0e0b4b4a-3b1e-4f0a-9c2d-6a1b7c8d9e0f',
    playedAt: 1_767_225_600_000,
};

/** A permanent refusal: the host drops it rather than retrying forever. */
export const scrobbleRejectionFixture: ScrobbleRejection = {
    index: 3,
    reason: 'the service will not accept a timestamp that old',
    retryable: false,
};

export const scrobbleResultFixture: ScrobbleResult = {
    accepted: 9,
    rejected: [scrobbleRejectionFixture],
};

const externalIdFixture: ExternalId = { source: 'musicbrainz', id: 'mb-123' };
const externalLinkFixture: ExternalLink = { label: 'MusicBrainz', url: 'https://musicbrainz.org/recording/mb-123' };

/**
 * `releaseDate` is an ISO-8601 string, never a `Date`. This is the
 * positive counterpart to the negative case in the conformance test that
 * proves a `Date` there fails.
 */
export const trackEnrichmentFixture: Partial<TrackEnrichment> = {
    artist: 'Radiohead',
    title: 'Everything In Its Right Place',
    album: 'Kid A',
    year: 2000,
    releaseDate: '2000-10-02',
    genres: ['electronic', 'art rock'],
    moods: ['melancholic'],
    biography: 'Recorded during the sessions that also produced Amnesiac.',
    facts: ['Built around a Prophet-5 synthesizer riff.'],
    bpm: 128,
    musicalKey: 'A minor',
    label: 'Parlophone',
    isrc: 'GBAYE0000351',
    artworkUrl: 'https://images.example.com/kid-a.jpg',
    externalIds: [externalIdFixture],
    links: [externalLinkFixture],
};

/**
 * The bulk form of the same question. An array crosses the boundary as an
 * array: nothing about `enrichTracks` relaxes the rule, and a batch is the
 * easiest place to smuggle a live object in behind a payload that looked fine
 * on its own.
 */
export const trackRefBatchFixture: TrackRef[] = [trackRefFixture, { artist: 'Boards of Canada', title: 'Roygbiv' }];

export const trackEnrichmentBatchFixture: Partial<TrackEnrichment>[] = [trackEnrichmentFixture, {}];

export const artistRefFixture: ArtistRef = {
    name: 'Radiohead',
    mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    providerRef: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
};

export const artistEnrichmentFixture: Partial<ArtistEnrichment> = {
    name: 'Radiohead',
    biography: 'Formed in Abingdon in 1985.',
    facts: ['Radiohead formed in Abingdon in 1985.'],
    genres: ['art rock'],
    imageUrl: 'https://images.example.com/radiohead.jpg',
    externalIds: [externalIdFixture],
    links: [externalLinkFixture],
};

export const albumRefFixture: AlbumRef = {
    name: 'Kid A',
    artist: 'Radiohead',
    mbid: '3ba0c2b6-3b1a-4e6a-b8b0-2e2b0b6f4a2f',
    providerRef: '3ba0c2b6-3b1a-4e6a-b8b0-2e2b0b6f4a2f',
};

export const albumEnrichmentFixture: Partial<AlbumEnrichment> = {
    name: 'Kid A',
    artist: 'Radiohead',
    year: 2000,
    releaseDate: '2000-10-02',
    label: 'Parlophone',
    genres: ['electronic'],
    facts: ['Recorded in Paris, Copenhagen and Gloucestershire.'],
    artworkUrl: 'https://images.example.com/kid-a.jpg',
    externalIds: [externalIdFixture],
    links: [externalLinkFixture],
};

export const pluginConnectionResultFixture: PluginConnectionResult = {
    ok: true,
    message: 'Connected as user@example.com',
};

const configFieldFixture: ConfigField = {
    key: 'region',
    label: 'Region',
    type: 'select',
    required: true,
    default: 'us',
    placeholder: 'Pick a region',
    help: 'Where the provider should route requests from.',
    options: [{ value: 'us', label: 'US' }],
    columns: [{ key: 'url', label: 'Address', type: 'url', required: true, placeholder: 'https://', optionsFrom: 'station.newsCategories' }],
    dependsOn: 'enabled',
};

/**
 * `configSchema` is host-side metadata read at load time, not a payload
 * passed to a plugin method, so it is intentionally excluded from the
 * boundary check: it is a zod schema (a class instance) and correctly fails
 * the plain-object check on purpose.
 */
export const pluginManifestFixtureWithoutConfigSchema: Omit<PluginManifest, 'configSchema'> = {
    id: 'deadair.conformance',
    name: 'Conformance Fixture',
    version: '1.2.3',
    capabilities: ['enrichment'],
    apiVersion: '^1.0.0',
    description: 'A fixture manifest exercising every optional field.',
    homepage: 'https://example.com/plugins/conformance',
    icon: 'https://example.com/plugins/conformance/icon.png',
    permissions: { network: ['api.example.com', '*.example.org'], storage: true, oauth: true },
    configFields: [configFieldFixture],
};

export const pluginManifestConfigSchemaFixture = z.object({});

/** A minimal manifest used to drive `PluginHostFactory` in the apps/api conformance test. */
export function conformanceManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id: 'test.conformance',
        name: 'Conformance',
        version: '0.0.1',
        capabilities: ['enrichment'],
        apiVersion: '^1.0.0',
        permissions: { network: ['api.example.com'], storage: true, oauth: true },
        configFields: [],
        configSchema: z.object({}),
        ...overrides,
    };
}

/** `saveTokens`'s argument / `getTokens`'s return type. */
export type PluginOAuthTokens = Awaited<ReturnType<PluginOAuth['getTokens']>>;
