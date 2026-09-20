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

describe('artistTopTracks', () => {
    /** The popularity endpoint's shape, already ordered by listen count. */
    const topRecordings = JSON.stringify([
        { recording_mbid: 'rec-1', recording_name: 'Breeze', release_name: 'Interceptor', artist_name: 'Mitch Murder', total_listen_count: 4000 },
        { recording_mbid: 'rec-2', recording_name: 'Out of Time', artist_name: 'Mitch Murder feat. Pyxis', total_listen_count: 900 },
    ]);

    const metadata = JSON.stringify({
        'rec-1': { recording: { name: 'Breeze' }, artist: { name: 'Mitch Murder', artists: [{ name: 'Mitch Murder' }] } },
        'rec-2': {
            recording: { name: 'Out of Time' },
            artist: { name: 'Mitch Murder feat. Pyxis', artists: [{ name: 'Mitch Murder' }, { name: 'Pyxis' }] },
        },
    });

    it('asks the popularity endpoint and keeps its order', async () => {
        await initialize('lb-token');
        host.queueResponse({ body: topRecordings });
        host.queueResponse({ body: metadata });

        const found = await plugin.artistTopTracks({ name: 'Mitch Murder', mbid: SEED_MBID }, 5);

        expect(host.calls[0]?.url).toContain(`1/popularity/top-recordings-for-artist/${SEED_MBID}`);
        expect(host.calls[1]?.url).toContain('1/metadata/recording/');
        expect(found).toEqual([
            { title: 'Breeze', artist: 'Mitch Murder', album: 'Interceptor' },
            { title: 'Out of Time', artist: 'Mitch Murder' },
        ]);
    });

    it('names a featured record by its lead artist, never the credit line', async () => {
        // "Mitch Murder feat. Pyxis" is what the row says; everything downstream matches on
        // the lead alone, so that would be a record named correctly and then never found.
        await initialize('lb-token');
        host.queueResponse({ body: topRecordings });
        host.queueResponse({ body: metadata });

        const found = await plugin.artistTopTracks({ name: 'Mitch Murder', mbid: SEED_MBID }, 5);

        expect(found[1]?.artist).toBe('Mitch Murder');
    });

    it('answers nothing without a token, and asks for nothing', async () => {
        // The endpoint refuses an anonymous caller, and the open substitute — the radio
        // endpoint — samples a catalogue for variety, so it answered B-sides and mashups
        // where a station meant to play the record. Neighbours only, and another source
        // names the records.
        await initialize('');

        expect(await plugin.artistTopTracks({ name: 'Mitch Murder', mbid: SEED_MBID }, 5)).toEqual([]);
        expect(host.calls).toHaveLength(0);
    });

    it('trims to the limit before spending a metadata request on the rest', async () => {
        await initialize('lb-token');
        host.queueResponse({ body: topRecordings });
        host.queueResponse({ body: metadata });

        await plugin.artistTopTracks({ name: 'Mitch Murder', mbid: SEED_MBID }, 1);

        expect(JSON.parse(String(host.calls[1]?.body)).recording_mbids).toEqual(['rec-1']);
    });

    it('searches MusicBrainz for an mbid when the host only has a name', async () => {
        await initialize('lb-token');
        host.queueResponse({ body: JSON.stringify({ artists: [{ id: SEED_MBID, name: 'Mitch Murder' }] }) });
        host.queueResponse({ body: topRecordings });
        host.queueResponse({ body: metadata });

        expect(await plugin.artistTopTracks({ name: 'Mitch Murder' }, 5)).toHaveLength(2);
        expect(host.calls[0]?.url).toContain('/artist?query=');
    });

    it('drops a record whose lead artist never arrived rather than guessing one', async () => {
        await initialize('lb-token');
        host.queueResponse({ body: topRecordings });
        host.queueResponse({ body: JSON.stringify({ 'rec-1': { recording: { name: 'Breeze' }, artist: { name: 'Mitch Murder' } } }) });

        expect(await plugin.artistTopTracks({ name: 'Mitch Murder', mbid: SEED_MBID }, 5)).toEqual([]);
    });

    it('answers nothing rather than throwing when the token is refused', async () => {
        await initialize('lb-token');
        host.queueResponse({ body: 'nope', status: 401 });

        expect(await plugin.artistTopTracks({ name: 'Mitch Murder', mbid: SEED_MBID }, 5)).toEqual([]);
    });
});

describe('similarTracks', () => {
    const CANONICAL = 'f3bba4cd-8018-468b-902e-bc8f029593e5';

    /** ListenBrainz's own lookup, which is the only thing that yields an id the dataset knows. */
    const lookupHit = JSON.stringify([{ artist_name_arg: 'Massive Attack', recording_name_arg: 'Teardrop', recording_mbid: CANONICAL }]);

    /** The labs answer, highest score first, with the reference itself among the rows. */
    const similar = JSON.stringify([
        { recording_mbid: CANONICAL, recording_name: 'Teardrop', reference_mbid: CANONICAL, score: 9999 },
        { recording_mbid: 'rec-a', recording_name: 'Glory Box', artist_credit_name: 'Portishead', artist_credit_mbids: null, score: 1131 },
        { recording_mbid: 'rec-b', recording_name: 'Porcelain', artist_credit_name: 'Moby feat. Nobody', artist_credit_mbids: null, score: 741 },
    ]);

    const metadata = JSON.stringify({
        'rec-a': { recording: { name: 'Glory Box' }, artist: { name: 'Portishead', artists: [{ name: 'Portishead' }] } },
        'rec-b': { recording: { name: 'Porcelain' }, artist: { name: 'Moby feat. Nobody', artists: [{ name: 'Moby' }, { name: 'Nobody' }] } },
    });

    it('resolves the canonical recording through ListenBrainz, then asks the labs endpoint', async () => {
        await initialize('lb-token');
        host.queueResponse({ body: lookupHit });
        host.queueResponse({ body: similar });
        host.queueResponse({ body: metadata });

        const found = await plugin.similarTracks({ artist: 'Massive Attack', title: 'Teardrop' }, 5);

        expect(host.calls[0]?.url).toContain('1/metadata/lookup/');
        expect(host.calls[1]?.url).toContain('labs.api.listenbrainz.org/similar-recordings/json');
        expect(host.calls[1]?.url).toContain(`recording_mbids=${CANONICAL}`);
        expect(host.calls[1]?.url).toContain('algorithm=session_based_');
        expect(found).toEqual([
            { title: 'Glory Box', artist: 'Portishead' },
            { title: 'Porcelain', artist: 'Moby' },
        ]);
    });

    it('never resolves through the MusicBrainz search, which yields an id the dataset has never heard of', async () => {
        // Measured: "Massive Attack — Teardrop" identifies at score 100 on the MusicBrainz
        // search, and the labs endpoint answers [] for the id it gives. MusicBrainz holds a
        // recording id per release; the similarity data exists only against ListenBrainz's
        // canonical one.
        await initialize('lb-token');
        host.queueResponse({ body: lookupHit });
        host.queueResponse({ body: similar });
        host.queueResponse({ body: metadata });

        await plugin.similarTracks({ artist: 'Massive Attack', title: 'Teardrop' }, 5);

        expect(host.calls.some(call => call.url.includes('/recording?query='))).toBe(false);
    });

    it('drops the record that was asked about, which is in its own neighbourhood', async () => {
        await initialize('lb-token');
        host.queueResponse({ body: lookupHit });
        host.queueResponse({ body: similar });
        host.queueResponse({ body: metadata });

        const found = await plugin.similarTracks({ artist: 'Massive Attack', title: 'Teardrop' }, 5);

        expect(found.map(track => track.title)).not.toContain('Teardrop');
        expect(JSON.parse(String(host.calls[2]?.body)).recording_mbids).toEqual(['rec-a', 'rec-b']);
    });

    it('names a featured record by its lead artist, never the credit line', async () => {
        await initialize('lb-token');
        host.queueResponse({ body: lookupHit });
        host.queueResponse({ body: similar });
        host.queueResponse({ body: metadata });

        const found = await plugin.similarTracks({ artist: 'Massive Attack', title: 'Teardrop' }, 5);

        expect(found[1]).toEqual({ title: 'Porcelain', artist: 'Moby' });
    });

    it('answers nothing without a token, and asks for nothing', async () => {
        await initialize('');

        expect(await plugin.similarTracks({ artist: 'Massive Attack', title: 'Teardrop' }, 5)).toEqual([]);
        expect(host.calls).toHaveLength(0);
    });

    it('answers nothing for a record ListenBrainz cannot place', async () => {
        await initialize('lb-token');
        host.queueResponse({ body: JSON.stringify([]) });

        expect(await plugin.similarTracks({ artist: 'Nobody', title: 'Nothing' }, 5)).toEqual([]);
        expect(host.calls).toHaveLength(1);
    });

    it('answers nothing rather than throwing when the algorithm enum has been retired', async () => {
        await initialize('lb-token');
        host.queueResponse({ body: lookupHit });
        host.queueResponse({ body: 'value is not a valid enumeration member', status: 400 });

        expect(await plugin.similarTracks({ artist: 'Massive Attack', title: 'Teardrop' }, 5)).toEqual([]);
    });

    it('stops before the labs call when the budget has run out', async () => {
        await initialize('lb-token');
        host.seedRemainingMs(500);
        host.queueResponse({ body: lookupHit });

        expect(await plugin.similarTracks({ artist: 'Massive Attack', title: 'Teardrop' }, 5)).toEqual([]);
        expect(host.calls).toHaveLength(1);
    });
});

describe('manifest network', () => {
    it('allowlists the labs host on the same bucket as the main service', () => {
        // One published limit covers a service rather than a hostname, so pacing the two
        // independently would quietly buy twice the allowance.
        const entries = musicbrainzManifest.permissions.network ?? [];
        const labs = entries.find(entry => 'host' in entry && entry.host === 'labs.api.listenbrainz.org');
        const main = entries.find(entry => 'host' in entry && entry.host === 'api.listenbrainz.org');

        expect(labs).toBeDefined();
        expect(labs && 'bucket' in labs ? labs.bucket : undefined).toBe(main && 'bucket' in main ? main.bucket : 'different');
    });
});
