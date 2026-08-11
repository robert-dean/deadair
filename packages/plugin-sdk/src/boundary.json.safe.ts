/**
 * Compile-time enforcement of the JSON-safe rule, over the payloads it applies
 * to.
 *
 * ## Which payloads, and why
 *
 * This rule used to cover everything a plugin touched, on the strength of a
 * deferred move behind a subprocess: JSON was going to be the wire format, so
 * nothing could carry a `Date`, a `Uint8Array` or a live object. That move is
 * closed (`docs/decisions/plugin-trust.md`), and with it the reason to apply the
 * rule to `host.fetch`'s arguments and return value, which nothing serializes.
 *
 * What is registered here is what has an INDEPENDENT reason to survive
 * `JSON.parse(JSON.stringify(x))`: it is stored in Postgres, or sent to the
 * console over HTTP, or both. A `Date` in `TrackEnrichment` is a bug whether or
 * not plugins ever move anywhere, which is why that half of the rule outlived
 * the argument that introduced it.
 *
 * ## Why compile time
 *
 * The runtime conformance suite in `tests/` round-trips hand-written fixtures,
 * which catches a value that violates the rule despite a type that permits it
 * (a class instance where the type says `object`). What it cannot catch is a
 * newly added field: nothing populates it, so nothing round-trips it, and CI
 * stays green while a `Date` crosses the boundary.
 *
 * TypeScript types are erased, so no runtime walk can ever be exhaustive over
 * a type. That check has to happen at compile time, which is what this file
 * is. {@link AssertAllBoundaryPayloadsAreJsonSafe} fails `tsc` the moment any
 * field of any registered payload stops being JSON-safe, without anyone
 * writing a fixture for it.
 *
 * This lives in `src/` rather than `tests/` on purpose: per the repo
 * convention the build tsconfig includes only `./src/**\/*`, so an assertion
 * in `tests/` would never run during `tsc --noEmit`. Everything here is types
 * plus three name arrays, so the runtime cost is the arrays alone.
 */

import type { AnalysisRef, TrackAnalysis, TrackCuePoints, TrackLoudness } from './capabilities/analysis.js';
import type {
    AlbumEnrichment,
    AlbumRef,
    ArtistEnrichment,
    ArtistRef,
    ExternalId,
    ExternalLink,
    TrackEnrichment,
    TrackRef,
} from './capabilities/enrichment.js';
import type {
    GetPlaylistTracksOptions,
    ListPlaylistsOptions,
    PlaybackState,
    ProviderPlaylist,
    ProviderStream,
    ProviderTrack,
    SearchTracksOptions,
} from './capabilities/music.provider.js';
import type { LlmMessage, LlmModelInfo, LlmRequest, LlmResult, LlmToolCall, LlmToolDeclaration, LlmUsage } from './capabilities/llm.js';
import type { SpeechRequest, SpeechVoice } from './capabilities/speech.js';
import type { ConfigField, ConfigFieldOption } from './plugin.config.fields.js';
import type { TrackFetchRequest, TrackFetchSession } from './plugin.host.js';
import type { PluginConnectionResult } from './plugin.lifecycle.js';
import type { PluginManifest } from './plugin.manifest.js';
import type { NetworkPermissionFromConfig, NetworkPermissionHost, PluginPermissions } from './plugin.permissions.js';

/**
 * `T` with every part that cannot survive `JSON.parse(JSON.stringify(x))`
 * replaced by `never`, so `T extends JsonSafe<T>` holds only for a genuinely
 * JSON-safe `T`.
 *
 * Deliberately narrower than structured-clone-safe. `Date`, `Map`, `Set` and
 * typed arrays all survive `structuredClone` and are still rejected here,
 * because what these payloads actually have to survive is Postgres and HTTP,
 * and both of those are JSON. A `Date` that round-trips through
 * `structuredClone` still comes back out of a `jsonb` column as a string.
 *
 * `any` and `unknown` pass through unchecked: there is nothing to inspect at
 * compile time, which is exactly the case the runtime fixture round-trip
 * covers.
 */
export type JsonSafe<T> = 0 extends 1 & T
    ? T // `any`
    : unknown extends T
      ? T // `unknown`
      : T extends string | number | boolean | null | undefined
        ? T
        : T extends (...args: never[]) => unknown
          ? never
          : T extends Date | RegExp | Map<unknown, unknown> | Set<unknown> | WeakMap<object, unknown> | WeakSet<object> | Promise<unknown>
            ? never
            : T extends ArrayBuffer | SharedArrayBuffer | ArrayBufferView
              ? never
              : T extends bigint | symbol
                ? never
                : T extends readonly (infer TElement)[]
                  ? readonly JsonSafe<TElement>[]
                  : T extends object
                    ? { [K in keyof T]: JsonSafe<T[K]> }
                    : never;

/**
 * `true` when `T` survives the boundary, `false` when any part of it does not.
 *
 * The tuple wrappers stop the conditional from distributing over a union, so a
 * field typed `string | Date` fails as a whole rather than partially matching.
 *
 * Written as a conditional rather than the more obvious
 * `T extends JsonSafe<T>` constraint, because TypeScript rejects that form as
 * a circular constraint (TS2313).
 */
type IsJsonSafe<T> = [T] extends [JsonSafe<T>] ? true : false;

/**
 * Compiles only when every value in `T` is `true`. When one is not, the error
 * lands on that property, so the diagnostic names the offending boundary type.
 */
type AssertAllTrue<T extends Record<string, true>> = T;

/**
 * Every payload that is stored or sent, asserted in one place.
 *
 * ADDING A BOUNDARY TYPE? Add it here and to {@link JSON_SAFE_PAYLOAD_TYPES}.
 * `tests/boundary.registry.test.ts` fails if an exported interface in a
 * boundary source file is in none of the three registries, so this cannot be
 * skipped by accident.
 *
 * `PluginManifest` is asserted without `configSchema`, which is a zod schema:
 * a class instance, deliberately never serialized, and stripped by the host
 * before a manifest is sent anywhere.
 */
export type AssertAllBoundaryPayloadsAreJsonSafe = AssertAllTrue<{
    PluginConnectionResult: IsJsonSafe<PluginConnectionResult>;
    PluginPermissions: IsJsonSafe<PluginPermissions>;
    NetworkPermissionHost: IsJsonSafe<NetworkPermissionHost>;
    NetworkPermissionFromConfig: IsJsonSafe<NetworkPermissionFromConfig>;
    ConfigField: IsJsonSafe<ConfigField>;
    ConfigFieldOption: IsJsonSafe<ConfigFieldOption>;
    PluginManifestWithoutConfigSchema: IsJsonSafe<Omit<PluginManifest, 'configSchema'>>;
    ProviderTrack: IsJsonSafe<ProviderTrack>;
    ProviderPlaylist: IsJsonSafe<ProviderPlaylist>;
    ProviderStream: IsJsonSafe<ProviderStream>;
    TrackFetchSession: IsJsonSafe<TrackFetchSession>;
    TrackFetchRequest: IsJsonSafe<TrackFetchRequest>;
    SearchTracksOptions: IsJsonSafe<SearchTracksOptions>;
    ListPlaylistsOptions: IsJsonSafe<ListPlaylistsOptions>;
    GetPlaylistTracksOptions: IsJsonSafe<GetPlaylistTracksOptions>;
    PlaybackState: IsJsonSafe<PlaybackState>;
    TrackRef: IsJsonSafe<TrackRef>;
    ArtistRef: IsJsonSafe<ArtistRef>;
    AlbumRef: IsJsonSafe<AlbumRef>;
    ExternalId: IsJsonSafe<ExternalId>;
    ExternalLink: IsJsonSafe<ExternalLink>;
    TrackEnrichment: IsJsonSafe<TrackEnrichment>;
    ArtistEnrichment: IsJsonSafe<ArtistEnrichment>;
    AlbumEnrichment: IsJsonSafe<AlbumEnrichment>;
    SpeechRequest: IsJsonSafe<SpeechRequest>;
    SpeechVoice: IsJsonSafe<SpeechVoice>;
    LlmMessage: IsJsonSafe<LlmMessage>;
    LlmToolDeclaration: IsJsonSafe<LlmToolDeclaration>;
    LlmToolCall: IsJsonSafe<LlmToolCall>;
    LlmUsage: IsJsonSafe<LlmUsage>;
    LlmRequest: IsJsonSafe<LlmRequest>;
    LlmResult: IsJsonSafe<LlmResult>;
    LlmModelInfo: IsJsonSafe<LlmModelInfo>;
    AnalysisRef: IsJsonSafe<AnalysisRef>;
    TrackCuePoints: IsJsonSafe<TrackCuePoints>;
    TrackLoudness: IsJsonSafe<TrackLoudness>;
    TrackAnalysis: IsJsonSafe<TrackAnalysis>;
}>;

/**
 * Names of the interfaces asserted above. Kept as a runtime array so the
 * registry-coverage test can compare it against what is actually exported
 * from the boundary source files.
 */
export const JSON_SAFE_PAYLOAD_TYPES = [
    'PluginConnectionResult',
    'PluginPermissions',
    'NetworkPermissionHost',
    'NetworkPermissionFromConfig',
    'ConfigField',
    'ConfigFieldOption',
    'PluginManifest',
    'ProviderTrack',
    'ProviderPlaylist',
    'ProviderStream',
    'TrackFetchSession',
    'TrackFetchRequest',
    'SearchTracksOptions',
    'ListPlaylistsOptions',
    'GetPlaylistTracksOptions',
    'PlaybackState',
    'TrackRef',
    'ArtistRef',
    'AlbumRef',
    'ExternalId',
    'ExternalLink',
    'TrackEnrichment',
    'ArtistEnrichment',
    'AlbumEnrichment',
    'SpeechRequest',
    'SpeechVoice',
    'LlmMessage',
    'LlmToolDeclaration',
    'LlmToolCall',
    'LlmUsage',
    'LlmRequest',
    'LlmResult',
    'LlmModelInfo',
    'AnalysisRef',
    'TrackCuePoints',
    'TrackLoudness',
    'TrackAnalysis',
] as const;

/**
 * Boundary interfaces that are deliberately NOT payloads: they describe
 * methods, so they carry functions by definition and can never be JSON-safe.
 *
 * The arguments and return values of those methods are payloads, and those
 * are what {@link JSON_SAFE_PAYLOAD_TYPES} covers. Listing the method-bearing
 * interfaces explicitly is what makes "is this a payload or a contract?" a
 * conscious decision for anyone adding one, rather than a silent omission.
 */
export const BOUNDARY_METHOD_TYPES = [
    'PluginLogger',
    'PluginStorage',
    'PluginSecrets',
    'PluginConfigAccess',
    'PluginOAuth',
    'PluginEvents',
    'PluginTrackFetcher',
    'PluginHost',
    'PluginLifecycle',
    'MusicProviderCatalog',
    'MusicProviderStream',
    'MusicProviderSteer',
    'MusicProviderOAuth',
    'MusicProvider',
    'EnrichmentProvider',
    'SpeechPluginInstance',
    'LlmPluginInstance',
    'AnalysisProvider',
] as const;

/**
 * Boundary interfaces that deliberately carry a LIVE object, and so are neither
 * payloads nor method contracts.
 *
 * The host and the plugin share a realm, permanently (see
 * `docs/decisions/plugin-trust.md`), so handing over a real `AbortSignal` or a
 * real stream is the correct design rather than a shortcut around the rule.
 * They are listed rather than simply left out, because the registry-coverage
 * test treats an unclassified boundary interface as an omission, and "this one
 * holds a live object on purpose" is a decision somebody should have to make in
 * writing.
 */
export const BOUNDARY_LIVE_OBJECT_TYPES = [
    // `signal`: the invocation's own `AbortSignal`, watched by `host.fetch` and
    // passed on by the plugin to anything else that takes one.
    'HostFetchInit',
    // `audio`: the engine's response body, usually forwarded straight through,
    // so the bytes are never held whole on either side of the call.
    'SpeechHandle',
    // `text`: the words as the model produces them, and `result`: a promise that
    // settles when it stops. The stream is what lets the host hold its single
    // model slot until the generation really ends rather than until the call
    // returns. `LlmResult` is the payload half, and it is JSON-safe.
    'LlmHandle',
] as const;
