import { DateTime } from 'luxon';
import { eventEnvelope, type EventStation } from './event.envelope.js';
import type {
    EventType,
    ProductionStartedData,
    ProgrammeStartedData,
    StationAirData,
    TalkStartedData,
    TrackStartedData,
} from './types/events.types.js';

/** The event a test delivery sends. Not subscribable: only the test route sends it. */
export const DESTINATION_TEST = 'destination.test';

/** A record began playing, as listeners heard it. */
export const TRACK_STARTED = 'track.started';
/** The station began speaking, in a break or a bulletin. */
export const TALK_STARTED = 'talk.started';
/** A produced piece (a phone-in, a guest, banter between hosts) began. Once per production. */
export const PRODUCTION_STARTED = 'production.started';
/** A programme the station carries began: a podcast episode, or a reading. */
export const PROGRAMME_STARTED = 'programme.started';

/** The station went on air. */
export const STATION_ON_AIR = 'station.onAir';
/** The station came off air. */
export const STATION_OFF_AIR = 'station.offAir';

/** One kind of event the station sends, as `/events/types` describes it. */
interface CatalogueEntry {
    type: string;
    description: string;
    subscribable: boolean;
    /** What `data` holds, filled in with believable values. */
    exampleData: Record<string, unknown>;
}

const exampleOnAir: StationAirData = { reason: 'programme', programme: 'Late Night Lows' };
const exampleOffAir: StationAirData = { reason: 'stopped' };

const exampleTrack: TrackStartedData = {
    itemId: 'b4f1c9a2-6d3e-4f70-8a19-2c5e7d9f0b31',
    title: 'Pink Moon',
    artists: ['Nick Drake'],
    artist: 'Nick Drake',
    album: 'Pink Moon',
    year: 1972,
    trackId: '3e8a1f42-9b6c-4d27-a5e0-71c2f8d9b4a6',
    durationMs: 124_000,
    endsAt: '2026-10-14T20:16:07.120Z',
    artworkUrl: 'https://radio.example.com/api/art/0f2c4e6a8b1d3f5a7c9e/cover.jpg',
};

const exampleTalk: TalkStartedData = {
    itemId: 'c71e0d3b-5a24-4b8f-9e16-3d4f6a8c0b52',
    segmentId: '9a2b4c6d-8e0f-4a1b-8c3d-5e7f9a1b3c5d',
    kind: 'talkbreak',
    label: 'Between the records',
    durationMs: 38_000,
    endsAt: '2026-10-14T20:14:41.120Z',
};

const exampleProduction: ProductionStartedData = {
    itemId: 'd82f1e4c-6b35-4c90-8f27-4e5a7b9d1c63',
    productionId: '5f7a9c1e-3b5d-4f7a-9c1e-3b5d7f9a1c3e',
    kind: 'callin',
    title: 'Your calls: the record that changed your mind',
    durationMs: 214_000,
    endsAt: '2026-10-14T20:17:37.120Z',
};

const exampleProgramme: ProgrammeStartedData = {
    itemId: 'e93a2f5d-7c46-4da1-9038-5f6b8cae2d74',
    segmentId: '1c3e5a7b-9d1f-4b3d-8f5a-7c9e1b3d5f7a',
    source: 'podcast',
    show: 'The Long Wave',
    episode: 'Episode 12: Pirate radio',
    durationMs: 1_740_000,
    endsAt: '2026-10-14T20:43:03.120Z',
};

/**
 * Every kind of event the station sends, in the order the console lists them.
 *
 * A list rather than something each producer registers, on the house rule that what the station can
 * do should be readable in one place. It grows by one row on the day a producer starts sending that
 * event, never before, so the catalogue never offers a subscription to something nothing sends.
 *
 * The four "started" events between them say what is on air at every moment, so a receiver that
 * wants an On Air light turns it on for talk and productions and off for the other two, and needs no
 * "ended" event: what ends something is the next thing starting.
 */
const CATALOGUE: readonly CatalogueEntry[] = [
    {
        type: TRACK_STARTED,
        description: 'A record began playing, at the moment listeners heard it. `endsAt` is when it should finish.',
        subscribable: true,
        exampleData: exampleTrack,
    },
    {
        type: TALK_STARTED,
        description:
            'The station began speaking: a talk break, a bulletin, a welcome. `kind` says which. A produced piece such as a phone-in is `production.started` instead.',
        subscribable: true,
        exampleData: exampleTalk,
    },
    {
        type: PRODUCTION_STARTED,
        description:
            'A produced piece began: a phone-in (`callin`), a guest (`visit`), banter between hosts. Sent once per production, when it first airs.',
        subscribable: true,
        exampleData: exampleProduction,
    },
    {
        type: PROGRAMME_STARTED,
        description: 'A programme the station carries began: an episode of a podcast, or something the station reads out itself (`narration`).',
        subscribable: true,
        exampleData: exampleProgramme,
    },
    {
        type: STATION_ON_AIR,
        description:
            'The station went on air: with a new running order (`programme`, named when it has a name), or on the one it was stopped on (`resumed`).',
        subscribable: true,
        exampleData: exampleOnAir,
    },
    {
        type: STATION_OFF_AIR,
        description: 'The station came off air: somebody stopped it (`stopped`), or its running order ran out and said to stop (`ranOut`).',
        subscribable: true,
        exampleData: exampleOffAir,
    },
    {
        type: DESTINATION_TEST,
        description:
            'Sent only when somebody presses Send test on a destination, to show it can be reached and the signature checks out. `data` names the destination.',
        subscribable: false,
        exampleData: { destinationId: '7d3c2f5e-8a41-4b6f-9c2d-1e0f3a4b5c6d' },
    },
];

/** Whether a destination may ask for this type: one the station sends, and not the test. */
export const isSubscribable = (type: string): boolean => CATALOGUE.some(entry => entry.type === type && entry.subscribable);

/** A fixed moment and id, so an example reads the same every time it is asked for. */
const EXAMPLE_AT = DateTime.fromISO('2026-10-14T20:14:03.120Z');
const EXAMPLE_ID = '0b9f6a2e-3c1d-4e5f-8a7b-6c5d4e3f2a1b';

/** The catalogue as `/events/types` answers it, each example stamped with this station. */
export function eventTypes(station: EventStation): EventType[] {
    return CATALOGUE.map(entry => ({
        type: entry.type,
        description: entry.description,
        subscribable: entry.subscribable,
        example: eventEnvelope(entry.type, entry.exampleData, station, EXAMPLE_AT, EXAMPLE_ID),
    }));
}
