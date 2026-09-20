// The similarity capability, answered from ListenBrainz's radio endpoint.
//
// Four things are load-bearing and each is asserted here. The endpoint returns the SEED artist
// among its keys, because it is built to fill a radio station and such a station plays that artist,
// so the mapping has to drop them or the host is handed the artist it just asked about. It works
// with NO token, which is the reason a station that has pasted one in and a station that has not
// both get similar artists. It answers in MBIDs, so a name costs a MusicBrainz search first. And
// every failure is an empty answer rather than a throw, because three thrown failures quarantine
// the plugin and would take this station's enrichment down over a similarity endpoint that changed
// its mind.

import { beforeEach, describe, expect, it } from 'vitest';

import { MusicBrainzPlugin } from '../src/musicbrainz.plugin.js';
import { musicbrainzManifest } from '../src/musicbrainz.manifest.js';
import { toSimilarArtists } from '../src/listenbrainz.mapping.js';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

const SEED_MBID = '5a2b9dd6-b605-4f90-9b08-fa4f54e40330';
const KALAX_MBID = '11111111-1111-1111-1111-111111111111';
const LAZERHAWK_MBID = '22222222-2222-2222-2222-222222222222';

let host: FakePluginHost;
let plugin: MusicBrainzPlugin;

/** No token is the default, because that is how an operator who has not set one arrives. */
const initialize = async (token = ''): Promise<void> => {
    host.seedConfig({ contactEmail: 'station@example.test', matchScore: 90 });
    host.seedSecret('listenBrainzToken', token);
    await plugin.init(host);
};

/** The radio endpoint's shape: keyed by artist mbid, the seed among them. */
const radio = JSON.stringify({
    [SEED_MBID]: [{ recording_mbid: 'rec-0', similar_artist_mbid: SEED_MBID, similar_artist_name: 'Mitch Murder' }],
    [KALAX_MBID]: [{ recording_mbid: 'rec-1', similar_artist_mbid: KALAX_MBID, similar_artist_name: 'Kalax', total_listen_count: 900 }],
    [LAZERHAWK_MBID]: [{ recording_mbid: 'rec-2', similar_artist_mbid: LAZERHAWK_MBID, similar_artist_name: 'Lazerhawk' }],
});

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new MusicBrainzPlugin();
});

describe('manifest', () => {
    it('declares similarity beside enrichment, and says so in its name', () => {
        expect(musicbrainzManifest.capabilities).toContain('similarity');
        expect(musicbrainzManifest.capabilities).toContain('enrichment');
        expect(musicbrainzManifest.name).toContain('ListenBrainz');
    });
});

describe('similarArtists', () => {
    it('asks the radio endpoint by mbid and drops the seed artist from the answer', async () => {
        await initialize();
        host.queueResponse({ body: radio });

        const found = await plugin.similarArtists({ name: 'Mitch Murder', mbid: SEED_MBID }, 8);

        expect(host.calls[0]?.url).toContain(`1/lb-radio/artist/${SEED_MBID}`);
        expect(host.calls[0]?.url).toContain('mode=easy');
        expect(found).toEqual([
            { name: 'Kalax', mbid: KALAX_MBID },
            { name: 'Lazerhawk', mbid: LAZERHAWK_MBID },
        ]);
    });

    it('works with no token at all, and sends no authorization header', async () => {
        await initialize('');
        host.queueResponse({ body: radio });

        expect(await plugin.similarArtists({ name: 'Mitch Murder', mbid: SEED_MBID }, 8)).toHaveLength(2);
        expect(host.calls[0]?.headers?.authorization).toBeUndefined();
    });

    it('sends the token when the operator has set one', async () => {
        await initialize('lb-token');
        host.queueResponse({ body: radio });

        await plugin.similarArtists({ name: 'Mitch Murder', mbid: SEED_MBID }, 8);

        expect(host.calls[0]?.headers?.authorization).toBe('Token lb-token');
    });

    it('searches MusicBrainz for an mbid first when the host only has a name', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify({ artists: [{ id: SEED_MBID, name: 'Mitch Murder' }] }) });
        host.queueResponse({ body: radio });

        const found = await plugin.similarArtists({ name: 'Mitch Murder' }, 8);

        expect(host.calls[0]?.url).toContain('/artist?query=');
        expect(host.calls[1]?.url).toContain('1/lb-radio/artist/');
        expect(found).toHaveLength(2);
    });

    it('answers nothing for a name MusicBrainz cannot place, without asking ListenBrainz', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify({ artists: [] }) });

        expect(await plugin.similarArtists({ name: 'Nobody At All' }, 8)).toEqual([]);
        expect(host.calls).toHaveLength(1);
    });

    it('answers nothing rather than throwing when ListenBrainz closes the endpoint', async () => {
        // Not hypothetical: /1/metadata/lookup and /1/popularity/... already answer 401 this way.
        await initialize();
        host.queueResponse({ body: JSON.stringify({ code: 401, error: 'You need to provide an Authorization header.' }), status: 401 });

        expect(await plugin.similarArtists({ name: 'Mitch Murder', mbid: SEED_MBID }, 8)).toEqual([]);
    });

    it('answers nothing rather than throwing when the service is down', async () => {
        await initialize();
        host.queueResponse({ body: 'bad gateway', status: 502 });

        expect(await plugin.similarArtists({ name: 'Mitch Murder', mbid: SEED_MBID }, 8)).toEqual([]);
    });

    it('sends every parameter the endpoint demands, over the whole popularity range', async () => {
        // All five are mandatory and the service enforces them ONE AT A TIME: the first
        // version of this shipped without pop_begin and pop_end and got a 400 on every call,
        // which the capability turns into an empty answer, so the plugin looked healthy and
        // simply never named anybody. The range is the whole of it because the window decides
        // which artists come back at all.
        await initialize();
        host.queueResponse({ body: radio });

        await plugin.similarArtists({ name: 'Mitch Murder', mbid: SEED_MBID }, 8);

        const url = host.calls[0]?.url ?? '';
        for (const param of ['mode=easy', 'max_similar_artists=', 'max_recordings_per_artist=', 'pop_begin=0', 'pop_end=100']) {
            expect(url).toContain(param);
        }
    });

    it('asks for one more artist than the host wanted, since the seed is about to be dropped', async () => {
        await initialize();
        host.queueResponse({ body: radio });

        await plugin.similarArtists({ name: 'Mitch Murder', mbid: SEED_MBID }, 5);

        expect(host.calls[0]?.url).toContain('max_similar_artists=6');
        expect(host.calls[0]?.url).toContain('max_recordings_per_artist=1');
    });

    it('trims to the limit the host asked for', async () => {
        await initialize();
        host.queueResponse({ body: radio });

        expect(await plugin.similarArtists({ name: 'Mitch Murder', mbid: SEED_MBID }, 1)).toEqual([{ name: 'Kalax', mbid: KALAX_MBID }]);
    });
});

describe('toSimilarArtists', () => {
    it('carries no match score, because the endpoint publishes none', () => {
        // `total_listen_count` is popularity, not resemblance, and passing it off as `match`
        // would hand the host a number it is entitled to compare against Last.fm's.
        const [first] = toSimilarArtists(JSON.parse(radio), SEED_MBID);

        expect(first).not.toHaveProperty('match');
    });

    it('skips an artist whose rows carry no name', () => {
        const answer = { [KALAX_MBID]: [{ recording_mbid: 'rec-1', similar_artist_mbid: KALAX_MBID, similar_artist_name: '  ' }] };

        expect(toSimilarArtists(answer, SEED_MBID)).toEqual([]);
    });

    it('reads the name off whichever row carries one', () => {
        const answer = {
            [KALAX_MBID]: [{ recording_mbid: 'rec-1' }, { recording_mbid: 'rec-2', similar_artist_name: 'Kalax' }],
        };

        expect(toSimilarArtists(answer, SEED_MBID)).toEqual([{ name: 'Kalax', mbid: KALAX_MBID }]);
    });
});
