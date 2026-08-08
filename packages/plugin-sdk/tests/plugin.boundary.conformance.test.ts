import { describe, expect, it } from 'vitest';

import {
    albumEnrichmentFixture,
    albumRefFixture,
    artistEnrichmentFixture,
    artistRefFixture,
    assertCrossesBoundary,
    getPlaylistTracksOptionsFixture,
    hostFetchInitFixture,
    hostFetchResponseFixture,
    hostStreamChunkDoneFixture,
    hostStreamChunkFixture,
    hostStreamOpenFixture,
    listPlaylistsOptionsFixture,
    playbackStateFixture,
    pluginConfigGetFixture,
    pluginConnectionResultFixture,
    pluginEventsEmitPayloadFixture,
    pluginLoggerMetaFixture,
    pluginManifestFixtureWithoutConfigSchema,
    pluginOAuthTokensFixture,
    pluginSecretsGetFixture,
    pluginStorageListFixture,
    pluginStorageValueFixture,
    providerPlaylistFixture,
    providerStreamFixture,
    providerTrackFixture,
    searchTracksOptionsFixture,
    speechHandleFixture,
    speechRequestFixture,
    speechVoiceFixture,
    trackEnrichmentBatchFixture,
    trackFetchRequestFixture,
    trackEnrichmentFixture,
    trackRefBatchFixture,
    trackRefFixture,
} from './boundary.payloads.fixture.js';

describe('plugin boundary conformance: positive fixtures', () => {
    it.each([
        ['HostFetchInit', hostFetchInitFixture],
        ['HostFetchResponse', hostFetchResponseFixture],
        ['HostStreamOpen', hostStreamOpenFixture],
        ['HostStreamChunk', hostStreamChunkFixture],
        ['HostStreamChunk (terminal)', hostStreamChunkDoneFixture],
        ['SpeechRequest', speechRequestFixture],
        ['SpeechHandle', speechHandleFixture],
        ['SpeechVoice', speechVoiceFixture],
        ['PluginLogger meta', pluginLoggerMetaFixture],
        ['PluginStorage value', pluginStorageValueFixture],
        ['PluginStorage.list return', pluginStorageListFixture],
        ['PluginSecrets.get return', pluginSecretsGetFixture],
        ['PluginConfigAccess.get return', pluginConfigGetFixture],
        ['PluginOAuth tokens', pluginOAuthTokensFixture],
        ['PluginEvents.emit payload', pluginEventsEmitPayloadFixture],
        ['ProviderTrack', providerTrackFixture],
        ['ProviderPlaylist', providerPlaylistFixture],
        ['ProviderStream', providerStreamFixture],
        ['TrackFetchRequest', trackFetchRequestFixture],
        ['SearchTracksOptions', searchTracksOptionsFixture],
        ['ListPlaylistsOptions', listPlaylistsOptionsFixture],
        ['GetPlaylistTracksOptions', getPlaylistTracksOptionsFixture],
        ['PlaybackState', playbackStateFixture],
        ['TrackRef', trackRefFixture],
        ['Partial<TrackEnrichment>', trackEnrichmentFixture],
        ['TrackRef[]', trackRefBatchFixture],
        ['Partial<TrackEnrichment>[]', trackEnrichmentBatchFixture],
        ['ArtistRef', artistRefFixture],
        ['Partial<ArtistEnrichment>', artistEnrichmentFixture],
        ['AlbumRef', albumRefFixture],
        ['Partial<AlbumEnrichment>', albumEnrichmentFixture],
        ['PluginConnectionResult', pluginConnectionResultFixture],
        ['PluginManifest (minus configSchema)', pluginManifestFixtureWithoutConfigSchema],
    ] as const)('%s crosses the boundary', (label, value) => {
        expect(() => assertCrossesBoundary(value, label)).not.toThrow();
    });

    it('accepts an ISO-8601 string releaseDate', () => {
        expect(() => assertCrossesBoundary({ releaseDate: '2000-10-02' }, 'releaseDate as string')).not.toThrow();
    });
});

describe('plugin boundary conformance: negative cases', () => {
    it('rejects a Date', () => {
        expect(() => assertCrossesBoundary({ expiresAt: new Date() }, 'Date payload')).toThrow(/Date/);
    });

    it('rejects a Date specifically in place of releaseDate (the string-only field)', () => {
        expect(() => assertCrossesBoundary({ releaseDate: new Date('2000-10-02') }, 'releaseDate as Date')).toThrow(/Date/);
    });

    it('rejects a Uint8Array', () => {
        expect(() => assertCrossesBoundary({ body: new Uint8Array([1, 2, 3]) }, 'Uint8Array payload')).toThrow(/typed array/);
    });

    it('rejects a function property', () => {
        expect(() => assertCrossesBoundary({ onDone: () => {} }, 'function payload')).toThrow();
    });

    it('rejects a class instance', () => {
        class Marker {
            tag = 'nope';
        }
        expect(() => assertCrossesBoundary({ marker: new Marker() }, 'class instance payload')).toThrow(/not a plain object/);
    });

    it('rejects NaN', () => {
        expect(() => assertCrossesBoundary({ score: Number.NaN }, 'NaN payload')).toThrow(/non-finite/);
    });

    it('rejects Infinity', () => {
        expect(() => assertCrossesBoundary({ score: Number.POSITIVE_INFINITY }, 'Infinity payload')).toThrow(/non-finite/);
    });

    it('rejects an undefined array element', () => {
        expect(() => assertCrossesBoundary({ items: ['a', undefined, 'b'] }, 'undefined array element payload')).toThrow(/undefined array element/);
    });

    it('names the offending property path in the failure message', () => {
        expect(() => assertCrossesBoundary({ nested: { deeper: new Date() } }, 'nested Date payload')).toThrow(
            /nested Date payload.*\$\.nested\.deeper/,
        );
    });

    it('allows undefined as an object property value (an unset optional field)', () => {
        expect(() => assertCrossesBoundary({ description: undefined, id: 'x' }, 'unset optional field')).not.toThrow();
    });

    it('rejects a Map', () => {
        expect(() => assertCrossesBoundary({ index: new Map() }, 'Map payload')).toThrow(/Map/);
    });

    it('rejects a Set', () => {
        expect(() => assertCrossesBoundary({ tags: new Set() }, 'Set payload')).toThrow(/Set/);
    });

    it('rejects a RegExp', () => {
        expect(() => assertCrossesBoundary({ pattern: /x/ }, 'RegExp payload')).toThrow(/RegExp/);
    });
});
