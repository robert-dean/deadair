// `levelingEnabled` is a record-only knob: it stops `gainAnnotations` from asking `gainFor` at all,
// and it must not reach a break, which has no live follower behind it the way a record has
// `normalize` in `radio.liq` — see `AnnotationContext.levelingEnabled` and `gain.ts`'s
// `DEFAULT_LEVELING_ENABLED` for why.

import { describe, expect, it } from 'vitest';

import { itemAnnotations, type AnnotationContext } from '../../../src/modules/playout/annotate.js';
import { DEFAULT_SPEECH_TRIM_DB, DEFAULT_TARGET_LUFS, programmeGainFor, speechGainFor } from '../../../src/modules/playout/gain.js';
import { RENDER_PLUGIN_ID } from '../../../src/modules/render/segment.source.js';
import type { RundownItem } from '../../../src/modules/playout/rundown.js';

const context = (levelingEnabled: boolean): AnnotationContext => ({
    targetLufs: DEFAULT_TARGET_LUFS,
    speechTrimDb: DEFAULT_SPEECH_TRIM_DB,
    levelingEnabled,
    crossfade: false,
    stationName: STATION_NAME,
    publicUrl: '',
});

const STATION_NAME = 'Deadair';

const record = (loudnessLufs: number): RundownItem => ({
    id: 'item-1',
    pluginId: 'deadair.spotify',
    externalId: 'ext-1',
    title: 'A Record',
    artists: ['An Artist'],
    artist: 'An Artist',
    loudnessLufs,
    truePeakDb: -6,
});

const speech = (loudnessLufs: number): RundownItem => ({
    id: 'item-2',
    pluginId: RENDER_PLUGIN_ID,
    externalId: 'ext-2',
    title: 'A Break',
    artists: [],
    artist: '',
    loudnessLufs,
    truePeakDb: -6,
});

describe('gainAnnotations, through itemAnnotations', () => {
    it('stamps a measured record when leveling is on', () => {
        const annotations = itemAnnotations(record(-9), context(true));

        expect(annotations.liq_amplify).toBeDefined();
    });

    it('stamps nothing for a record when leveling is off, however loud or quiet it is', () => {
        const annotations = itemAnnotations(record(-9), context(false));

        expect(annotations.liq_amplify).toBeUndefined();
    });

    it('still stamps a break when leveling is off, exactly as when it is on', () => {
        const off = itemAnnotations(speech(-9), context(false));
        const on = itemAnnotations(speech(-9), context(true));

        const expected = `${speechGainFor({ loudnessLufs: -9 }, DEFAULT_TARGET_LUFS, DEFAULT_SPEECH_TRIM_DB)} dB`;
        expect(off.liq_amplify).toBe(expected);
        expect(on.liq_amplify).toBe(expected);
    });
});

// A segment's title is `segments.label`, which is written for a producer. The mount is the one
// place it must not reach: it is the whole display ceiling on a hardware player, so a break
// captioned `Talk break: X into Y` spends it on the station's own paperwork. See `listenerTitle`.
describe('listenerTitle, through itemAnnotations', () => {
    const labelled = (title: string): RundownItem => ({ ...speech(-16), title });

    it('labels a break with the station name rather than the producer label it carries', () => {
        const annotations = itemAnnotations(labelled('Talk break: Straight Tequila Night into My Boo'), context(true));

        expect(annotations.title).toBe(STATION_NAME);
    });

    it('labels every kind of segment the same way, so no vocabulary has to be kept in step', () => {
        for (const label of ['Talk break: A into B', 'Back-announce: A', 'Intro: B', 'Station ident', 'News']) {
            expect(itemAnnotations(labelled(label), context(true)).title).toBe(STATION_NAME);
        }
    });

    // The asymmetry is the point: a record has a real title and a listener wants it.
    it('leaves a record alone', () => {
        expect(itemAnnotations(record(-9), context(true)).title).toBe('A Record');
    });

    // A blank title leaves the mount saying whatever it last said, which is the record BEFORE the
    // break — a display naming a record that has finished misinforms rather than merely over-shares.
    it('falls back to the label when the station has no name, rather than sending nothing', () => {
        const unnamed = { ...context(true), stationName: '   ' };

        expect(itemAnnotations(labelled('Talk break: A into B'), unnamed).title).toBe('Talk break: A into B');
    });

    // `artists` is empty for a segment, so the ICY line Icecast composes is the bare station name.
    it('sends no artist for a break, so the mount does not read as a band nobody has heard of', () => {
        expect(itemAnnotations(labelled('Station ident'), context(true)).artist).toBeUndefined();
    });
});

// Somebody else's programme comes out of the station's own store as a segment, and is spoken word to
// the mixer, but it is not the station talking: it has a title a listener wants and a level somebody
// mastered. See `RundownItem.programme`.
describe('a carried programme, through itemAnnotations', () => {
    const programme = (loudnessLufs?: number): RundownItem => ({
        id: 'item-3',
        pluginId: RENDER_PLUGIN_ID,
        externalId: 'seg-3',
        title: 'Episode 12: The night shift',
        artists: ['The Long Wave'],
        artist: '',
        programme: true,
        ...(loudnessLufs === undefined ? {} : { loudnessLufs }),
    });

    it('names the episode and the show on the mount, as a record would be named', () => {
        const annotations = itemAnnotations(programme(), context(true));

        expect(annotations.title).toBe('Episode 12: The night shift');
        expect(annotations.artist).toBe('The Long Wave');
    });

    it('is still spoken word to the mixer, so nothing is ever faded into it', () => {
        expect(itemAnnotations(programme(), context(true)).deadair_speech).toBe('1');
    });

    // The loudest way this could go wrong: an unmeasured episode levelled as though it came out of the
    // station's speech engine gets eleven and a half decibels it does not need, for an hour.
    it("levels an unmeasured episode from a mastered level, not a speech engine's", () => {
        const stamped = itemAnnotations(programme(), context(true)).liq_amplify;

        expect(stamped).toBe(`${programmeGainFor({}, DEFAULT_TARGET_LUFS, DEFAULT_SPEECH_TRIM_DB)} dB`);
        expect(stamped).not.toBe(`${speechGainFor({}, DEFAULT_TARGET_LUFS, DEFAULT_SPEECH_TRIM_DB)} dB`);
    });

    it("levels it whether or not record levelling is on, like the station's own voice", () => {
        expect(itemAnnotations(programme(-20), context(false)).liq_amplify).toBe(itemAnnotations(programme(-20), context(true)).liq_amplify);
    });
});

describe('listenerArtwork, through itemAnnotations', () => {
    // The ICY `StreamUrl` beside the title. Two rules decide it, and both are absolute: only the
    // station's own art goes on the wire, and every item says what to show. See `listenerArtwork`
    // for the credential half of the first and Icecast's tag-keeping for the second.
    const reachable = (): AnnotationContext => ({ ...context(true), publicUrl: 'https://radio.test/' });
    const labelled = (title: string): RundownItem => ({ ...speech(-16), title });
    const programme = (): RundownItem => ({ ...speech(-16), id: 'item-3', title: 'Episode 12', artists: ['The Long Wave'], programme: true });
    const CACHED = 'art/0b1e4a52-1111-4222-8333-444455556666/cover.jpg';
    const LOGO = 'https://radio.test/logo.png';

    it("sends the station's own cached copy, as the catalog read hands it over, absolute under the API", () => {
        // The shape `catalog.art.ts` mints: a path under the API root, carrying the filename a
        // player needs before it will fetch anything at all.
        const item: RundownItem = { ...record(-9), artworkUrl: CACHED };

        expect(itemAnnotations(item, reachable()).url).toBe(`https://radio.test/api/${CACHED}`);
    });

    it('takes the leading slash off a path that has one, rather than doubling it', () => {
        // A device at the far end of a stream cannot resolve a relative path, and the trailing
        // slash an operator may well type into the setting must not become a double one.
        const item: RundownItem = { ...record(-9), artworkUrl: `/${CACHED}` };

        expect(itemAnnotations(item, reachable()).url).toBe(`https://radio.test/api/${CACHED}`);
    });

    it('still sends an asset the store recorded no extension for, under its bare id', () => {
        // `cachedOrUpstream` leaves the filename off when it has nothing true to call the file.
        // A player that wants an extension ignores it, which is the same as today; a browser and
        // the console do not care.
        const item: RundownItem = { ...record(-9), artworkUrl: 'art/0b1e4a52-1111-4222-8333-444455556666' };

        expect(itemAnnotations(item, reachable()).url).toBe('https://radio.test/api/art/0b1e4a52-1111-4222-8333-444455556666');
    });

    it("sends the station's logo instead of a provider's URL, which is never put on the wire", () => {
        // Two reasons, either of which is enough. A player will not fetch a URL that does not look
        // like a picture, and this field is broadcast to every listener, so a Subsonic cover URL
        // would hand the operator's own credentials to anybody who connected.
        const item: RundownItem = { ...record(-9), artworkUrl: 'https://cdn.example/ab67616d0000b273' };

        expect(itemAnnotations(item, reachable()).url).toBe(LOGO);
    });

    it('sends it instead of a provider URL that carries a credential, whatever it ends in', () => {
        const item: RundownItem = { ...record(-9), artworkUrl: 'http://navidrome.lan/rest/getCoverArt.view?u=robert&t=abc123&s=salt&id=al-42' };

        expect(itemAnnotations(item, reachable()).url).toBe(LOGO);
    });

    it("shows the station's logo for a break, as the mount carries the station's name for one", () => {
        expect(itemAnnotations(labelled('Talk break: A into B'), reachable()).url).toBe(LOGO);
    });

    it("shows the station's logo for a record with no cover rather than saying nothing", () => {
        expect(itemAnnotations(record(-9), reachable()).url).toBe(LOGO);
    });

    it("carries a programme's own cover once the station holds one, as a record's is carried", () => {
        const item: RundownItem = { ...programme(), artworkUrl: CACHED };

        expect(itemAnnotations(item, reachable()).url).toBe(`https://radio.test/api/${CACHED}`);
    });

    it('sends no artwork at all without a public URL, since nothing could fetch it', () => {
        const item: RundownItem = { ...record(-9), artworkUrl: `/${CACHED}` };

        expect(itemAnnotations(item, context(true)).url).toBeUndefined();
        expect(itemAnnotations(labelled('Station ident'), context(true)).url).toBeUndefined();
    });
});
