// An audition is only worth running if a break written for it is written from the same substrate an
// on-air break gets: a measurement taken against a thinner prompt measures a different station. So
// what is pinned here is the parity — the persona, the notebook, the story, the facts, the time of
// day — and, just as hard, the four things an audition deliberately does NOT carry, each of which
// would be wrong rather than merely missing.
//
// The other half is `recent`. The rehearsal passes an empty list on purpose, because one break
// against a fixed pair has to be repeatable; over a playlist that same choice would let the host
// land its signature phrase at every transition and would report a repetition no broadcast ever
// produces. Carrying the run's own scripts is what makes an audition measure the thing it claims to.

import { describe, expect, it } from 'vitest';

import { auditionRequest, toBreakTrack } from '../../../src/modules/personas/persona.audition.request.js';
import type { AuditionRecord } from '../../../src/modules/personas/persona.audition.js';
import type { Persona } from '../../../src/modules/personas/persona.js';

const persona = (over: Partial<Persona> = {}): Persona => ({
    id: 'p1',
    key: 'pirate',
    kind: 'host',
    label: 'Pirate captain',
    style: 'a pirate captain who runs a radio station',
    active: false,
    ...over,
});

const record = (over: Partial<AuditionRecord> = {}): AuditionRecord => ({
    pluginId: 'spotify',
    externalId: 'track-1',
    title: 'Green Onions',
    artist: 'Booker T. & the M.G.s',
    ...over,
});

/** Half past two in the afternoon, London: an hour with a greeting and an unambiguous day part. */
const AFTERNOON = Date.UTC(2026, 4, 12, 14, 30);
/** Half past three in the morning: the stretch a greeting has nothing for. */
const SMALL_HOURS = Date.UTC(2026, 4, 12, 3, 30);

const input = (over: Partial<Parameters<typeof auditionRequest>[0]> = {}) => ({
    persona: persona(),
    previous: record(),
    next: record({ externalId: 'track-2', title: "Ain't No Sunshine", artist: 'Bill Withers' }),
    recent: [] as readonly string[],
    turn: 'audition-1:0',
    station: 'Dead Air',
    zone: 'Europe/London',
    now: AFTERNOON,
    ...over,
});

describe('toBreakTrack', () => {
    it('carries everything the catalog knew about the record', () => {
        const track = toBreakTrack(record({ trackId: 't1', year: 1962, album: 'Green Onions', durationMs: 174_000 }));

        // A writer told a title and a name has nothing specific to be specific ABOUT, which is how a
        // 1980 record gets dated to the year the band formed. These four are what the run already
        // holds.
        expect(track).toEqual({
            title: 'Green Onions',
            artist: 'Booker T. & the M.G.s',
            trackId: 't1',
            year: 1962,
            album: 'Green Onions',
            durationMs: 174_000,
        });
    });

    it('leaves out what nothing knows rather than passing a blank through', () => {
        // `describe` in the prompt tests truthiness and drops what is empty, so a field arriving as
        // an empty string reaches the model as "album ." — which aired.
        const track = toBreakTrack(record());

        expect(Object.keys(track)).toEqual(['title', 'artist']);
    });

    it('names an unknown artist rather than announcing a record by nobody', () => {
        // A provider that gave no credit carries the empty string rather than nothing, which is why
        // this is `||` and not `??`.
        expect(toBreakTrack(record({ artist: '' })).artist).toBe('an unknown artist');
    });

    it('attaches the facts it was given, and nothing when there are none', () => {
        expect(toBreakTrack(record(), ['It was cut in a single afternoon.'])?.facts).toEqual(['It was cut in a single afternoon.']);
        expect(Object.keys(toBreakTrack(record(), []))).not.toContain('facts');
        expect(Object.keys(toBreakTrack(record()))).not.toContain('facts');
    });
});

describe('auditionRequest', () => {
    it('asks for a talk break under the character it was given', () => {
        const request = auditionRequest(input({ persona: persona({ key: 'latenight' }) }));

        expect(request.kind).toBe('talkbreak');
        expect(request.persona?.key).toBe('latenight');
        expect(request.station).toBe('Dead Air');
    });

    it('always yields the model to the station', () => {
        // `preview` queues behind everything the station does for itself and is preempted the moment
        // a real break wants the model. An audition that outranked a refill would be the console
        // making the station worse by being looked at.
        expect(auditionRequest(input()).priority).toBe('preview');
    });

    it('shows both records with what the catalog knew about them', () => {
        const request = auditionRequest(
            input({
                previous: record({ trackId: 't1', year: 1962 }),
                next: record({ externalId: 'track-2', title: "Ain't No Sunshine", artist: 'Bill Withers', trackId: 't2', album: 'Just As I Am' }),
            }),
        );

        expect(request.previous).toMatchObject({ title: 'Green Onions', trackId: 't1', year: 1962 });
        expect(request.next).toMatchObject({ title: "Ain't No Sunshine", trackId: 't2', album: 'Just As I Am' });
    });

    it('attaches each side’s own facts to that side', () => {
        const request = auditionRequest(input({ facts: { previous: ['Cut in a single afternoon.'], next: ['Written in one sitting.'] } }));

        expect(request.previous?.facts).toEqual(['Cut in a single afternoon.']);
        expect(request.next?.facts).toEqual(['Written in one sitting.']);
    });

    it('carries what the run has already said, newest first', () => {
        const request = auditionRequest(input({ recent: ['the third thing said', 'the second', 'the first'] }));

        // The order is the whole meaning of this list: `spentOpenings` reads the newest and the
        // floor's second round avoids `recent[0]` specifically.
        expect(request.recent).toEqual(['the third thing said', 'the second', 'the first']);
    });

    it('carries the notebook and the story when it was handed them', () => {
        const request = auditionRequest(
            input({
                notebook: { trait: ['has taken against the Eurovision key change'], said: ['"as I live and breathe"'] },
                story: { title: 'The Barstow lights', story: 'Three lights over the desert.', details: [], timesTold: 2 },
            }),
        );

        expect(request.notebook?.trait).toEqual(['has taken against the Eurovision key change']);
        expect(request.story?.title).toBe('The Barstow lights');
    });

    it('omits the notebook and the story rather than passing empty ones', () => {
        // A prompt built around a bare persona has to stay byte-identical to one built before either
        // of these existed.
        const request = auditionRequest(input());

        expect(Object.keys(request)).not.toContain('notebook');
        expect(Object.keys(request)).not.toContain('story');
    });

    it('offers one preoccupation, and the same one for the same transition', () => {
        const sheet = persona({ preoccupations: ['the price of a pint', 'the state of the buses'] });

        const first = auditionRequest(input({ persona: sheet, turn: 'audition-1:3' }));
        const again = auditionRequest(input({ persona: sheet, turn: 'audition-1:3' }));

        expect(first.preoccupation).toBeDefined();
        // Spread over the transition rather than drawn per call, so re-reading a run does not report
        // a break written about something else.
        expect(again.preoccupation).toBe(first.preoccupation);
    });

    it('spreads the preoccupations across the transitions of a run', () => {
        const sheet = persona({ preoccupations: ['the price of a pint', 'the state of the buses'] });

        const chosen = new Set(
            ['0', '1', '2', '3'].map(ordinal => auditionRequest(input({ persona: sheet, turn: `audition-1:${ordinal}` })).preoccupation),
        );

        // A run that offered one character's single obsession at every transition would measure a
        // host with one idea, which is a property of the run rather than of the sheet.
        expect(chosen.size).toBeGreaterThan(1);
    });

    it('offers no preoccupation for a character with none', () => {
        expect(Object.keys(auditionRequest(input()))).not.toContain('preoccupation');
    });

    it('tells the writers what time of day it is', () => {
        const request = auditionRequest(input({ now: AFTERNOON }));

        expect(request.dayPart?.words).toBeTypeOf('string');
        expect(request.greeting?.words).toBeTypeOf('string');
        expect(request.moment).toEqual({ at: AFTERNOON, zone: 'Europe/London' });
    });

    it('has a day part in the small hours, where a greeting has nothing', () => {
        const request = auditionRequest(input({ now: SMALL_HOURS }));

        // The stretch a presenter has the most to say about and a greeting has no words for.
        expect(request.dayPart?.words).toBeTypeOf('string');
        expect(Object.keys(request)).not.toContain('greeting');
    });

    it('names no clock time, because an audition has no slot', () => {
        // An hour phrasing is only as true as the slot it was computed for. A break written now and
        // read in an hour would name a time that never applied to it.
        expect(Object.keys(auditionRequest(input()))).not.toContain('clock');
    });

    it('carries no air time, so the model is given a watcher’s patience', () => {
        // `patienceFor(undefined)` is the 30-second default, which is the right wait for something
        // an operator is sitting in front of.
        expect(Object.keys(auditionRequest(input()))).not.toContain('airsAt');
    });

    it('offers no pads and no cues, which are things to PERFORM', () => {
        // An audition is read on a page. Offering a soundboard would have the host reach for a sting
        // nothing here can play.
        const request = auditionRequest(input());

        expect(Object.keys(request)).not.toContain('pads');
        expect(Object.keys(request)).not.toContain('reactions');
    });

    it('offers no play history, which belongs to a broadcast', () => {
        expect(Object.keys(auditionRequest(input()))).not.toContain('played');
    });
});
