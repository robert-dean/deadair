/**
 * Compile-time enforcement of the JSON-safe boundary rule.
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
 * plus two name arrays, so the runtime cost is the arrays alone.
 */

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
    ProviderSessionCredentials,
    ProviderStream,
    ProviderTrack,
    SearchTracksOptions,
} from './capabilities/music.provider.js';
import type { ConfigField, ConfigFieldOption } from './plugin.config.fields.js';
import type { HostFetchInit, HostFetchResponse, TrackFetchRequest, TrackFetchSession } from './plugin.host.js';
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
 * because the deferred isolation target is a subprocess over IPC rather than
 * `worker_threads`, and a subprocess boundary is framing plus a serialization
 * format, in practice JSON. See `docs/decisions/plugin-isolation.md`.
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
 * Every data payload that crosses the plugin boundary, asserted in one place.
 *
 * ADDING A BOUNDARY TYPE? Add it here and to {@link JSON_SAFE_PAYLOAD_TYPES}.
 * `tests/boundary.registry.test.ts` fails if an exported interface in a
 * boundary source file is in neither registry, so this cannot be skipped by
 * accident.
 *
 * `PluginManifest` is asserted without `configSchema`, which is a zod schema:
 * a class instance, deliberately never serialized, and stripped by the host
 * before a manifest is sent anywhere.
 */
export type AssertAllBoundaryPayloadsAreJsonSafe = AssertAllTrue<{
    HostFetchInit: IsJsonSafe<HostFetchInit>;
    HostFetchResponse: IsJsonSafe<HostFetchResponse>;
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
    ProviderSessionCredentials: IsJsonSafe<ProviderSessionCredentials>;
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
}>;

/**
 * Names of the interfaces asserted above. Kept as a runtime array so the
 * registry-coverage test can compare it against what is actually exported
 * from the boundary source files.
 */
export const JSON_SAFE_PAYLOAD_TYPES = [
    'HostFetchInit',
    'HostFetchResponse',
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
    'ProviderSessionCredentials',
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
] as const;
