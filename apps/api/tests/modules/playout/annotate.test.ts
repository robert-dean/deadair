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
    // The ICY `StreamUrl` beside the title: a record's cover, or the station's logo when the
    // station itself is what is playing. Icecast keeps a tag an update does not mention, so
    // every item says what to show or the previous record's cover stays up under it.
    const reachable = (): AnnotationContext => ({ ...context(true), publicUrl: 'https://radio.test/' });
    const labelled = (title: string): RundownItem => ({ ...speech(-16), title });
    const programme = (): RundownItem => ({ ...speech(-16), id: 'item-3', title: 'Episode 12', artists: ['The Long Wave'], programme: true });

    it("sends a record's cover as it is when the provider's URL is absolute", () => {
        const item: RundownItem = { ...record(-9), artworkUrl: 'https://cdn.example/cover.jpg' };

        expect(itemAnnotations(item, reachable()).url).toBe('https://cdn.example/cover.jpg');
    });

    it("sends the station's own cached copy, as the catalog read hands it over, absolute under the API", () => {
        // `art/<id>` with no leading slash is the shape `catalog.art.ts` mints, and it is what
        // every cached cover on the station arrives as: the amp fetches from the station, not
        // from whichever provider the record came from.
        const item: RundownItem = { ...record(-9), artworkUrl: 'art/0b1e4a52-1111-4222-8333-444455556666' };

        expect(itemAnnotations(item, reachable()).url).toBe('https://radio.test/api/art/0b1e4a52-1111-4222-8333-444455556666');
    });

    it("makes the station's own cached copy absolute under the API, off the public origin", () => {
        // A device at the far end of a stream cannot resolve a relative path, and the trailing
        // slash an operator may well type into the setting must not become a double one.
        const item: RundownItem = { ...record(-9), artworkUrl: '/art/0b1e4a52-1111-4222-8333-444455556666' };

        expect(itemAnnotations(item, reachable()).url).toBe('https://radio.test/api/art/0b1e4a52-1111-4222-8333-444455556666');
    });

    it("shows the station's logo for a break, as the mount carries the station's name for one", () => {
        expect(itemAnnotations(labelled('Talk break: A into B'), reachable()).url).toBe('https://radio.test/logo.png');
    });

    it("shows the station's logo for a record with no cover rather than saying nothing", () => {
        expect(itemAnnotations(record(-9), reachable()).url).toBe('https://radio.test/logo.png');
    });

    it("carries a programme's own artwork, since it has a real title too", () => {
        const item: RundownItem = { ...programme(), artworkUrl: 'https://feeds.example/show.jpg' };

        expect(itemAnnotations(item, reachable()).url).toBe('https://feeds.example/show.jpg');
    });

    it('sends no artwork at all without a public URL, since nothing could fetch it', () => {
        const item: RundownItem = { ...record(-9), artworkUrl: '/art/0b1e4a52-1111-4222-8333-444455556666' };

        expect(itemAnnotations(item, context(true)).url).toBeUndefined();
        expect(itemAnnotations(labelled('Station ident'), context(true)).url).toBeUndefined();
    });
});
