// The plugin against the host's own capability views, which is the check neither side can do
// alone. `implementsX` requires the manifest to DECLARE a capability and the instance to actually
// have the methods, precisely because a plugin that promises one and forgets the other is a
// `TypeError` in the middle of a request rather than an honest "not supported".
//
// The Last.fm plugin declares five at once, so it is the first thing in the tree that could get
// that wrong in five ways. It imports the real manifest and the real factory — a fixture here would
// be testing the fixture.

import { describe, expect, it } from 'vitest';

import { LastfmPlugin, lastfmManifest } from '../../../../../plugins/lastfm/src/lastfm.plugin.js';
import { asChartsPlugin, asEnrichmentPlugin, asScrobblePlugin, asSimilarityPlugin } from '../../../src/modules/plugins/plugin.capabilities.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';

/** The record the host would hold for a loaded, running installation of it. */
const record = (): PluginRecord => ({
    id: lastfmManifest.id,
    dir: '/plugins/lastfm',
    origin: 'bundled',
    status: 'active',
    manifest: lastfmManifest,
    instance: new LastfmPlugin() as never,
});

describe('the manifest', () => {
    it('declares exactly the capabilities the class implements', () => {
        expect([...lastfmManifest.capabilities].sort()).toEqual(['charts', 'enrichment', 'oauth', 'scrobble', 'similarity']);
    });

    it('allows the one host it talks to, on a shared bucket', () => {
        // A published rate limit covers a SERVICE, so two entries against two buckets would quietly
        // buy twice the allowance and get the station blocked.
        expect(lastfmManifest.permissions.network).toEqual([expect.objectContaining({ host: 'ws.audioscrobbler.com', bucket: 'lastfm' })]);
    });

    it('does not ask for the consent-screen host, which it never fetches', () => {
        // `www.last.fm` is handed to a browser by the console. It has to stay out of the allowlist
        // unless something here actually starts fetching it.
        const hosts = JSON.stringify(lastfmManifest.permissions.network);
        expect(hosts).not.toContain('www.last.fm');
    });

    it('asks for the OAuth vault and not for storage', () => {
        // Everything it learns is stored by the host against the record it is about; the session
        // key lives in the vault. There is nothing for a plugin-private store to hold.
        expect(lastfmManifest.permissions.oauth).toBe(true);
        expect(lastfmManifest.permissions.storage).toBe(false);
    });

    it('keeps both credentials as secrets, so neither is ever read back', () => {
        const secrets = lastfmManifest.configFields.filter(field => field.type === 'secret').map(field => field.key);
        expect(secrets).toEqual(['apiKey', 'apiSecret']);
    });

    it('ships with scrobbling OFF, because reading a service and publishing to it are two decisions', () => {
        expect(lastfmManifest.configFields.find(field => field.key === 'scrobbling')?.default).toBe(false);
    });
});

describe('the host accepts it as', () => {
    it('an enrichment source, at supplementary priority', () => {
        const view = asEnrichmentPlugin(record());

        expect(view).toBeDefined();
        // 500 is the SDK's own figure for a supplementary source. Lower would have a folksonomy
        // overruling the identity database on a release year.
        expect(view?.priority).toBe(500);
        expect(view?.enrichesArtists).toBe(true);
        expect(view?.enrichesAlbums).toBe(true);
    });

    it('a chart source', () => {
        expect(asChartsPlugin(record())).toBeDefined();
    });

    it('a similarity source that can also name records', () => {
        // Both halves: without `artistTopTracks` it could inform a DJ and not programme an hour.
        const view = asSimilarityPlugin(record());

        expect(view).toBeDefined();
        expect(view?.namesTracks).toBe(true);
    });

    it('a scrobble destination that can be told to stop', () => {
        const view = asScrobblePlugin(record());

        expect(view).toBeDefined();
        expect(view?.declarable).toBe(true);
        expect(view?.saysNowPlaying).toBe(true);
        // The service's own documented ceiling for one request.
        expect(view?.maxBatchSize).toBe(50);
    });

    it('nothing at all while it is not running', () => {
        const stopped = { ...record(), status: 'failed' as const, error: 'boom' };

        expect(asEnrichmentPlugin(stopped)).toBeUndefined();
        expect(asChartsPlugin(stopped)).toBeUndefined();
        expect(asSimilarityPlugin(stopped)).toBeUndefined();
        expect(asScrobblePlugin(stopped)).toBeUndefined();
    });
});
