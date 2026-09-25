// Who gets cast, and the two rules that decide it: a kind the operator said has callers, and a
// rotation over the roster. Everything else here is about the failure directions — a station with no
// callers, a roster that could not be read — because both have to end in a production the presenter
// reads alone rather than a production that does not happen.

import { describe, expect, it, vi } from 'vitest';

import { ProductionCaster } from '../../../src/modules/productions/production.caster.js';
import type { Production } from '../../../src/modules/productions/production.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const caller = (key: string) => ({ id: `id-${key}`, key, kind: 'caller' as const, label: key, style: 'somebody', voice: key, defaultHost: false });

const production = (over: Partial<Production> = {}): Production =>
    ({
        id: 'prod-1',
        stationKey: 'main',
        kind: 'callin',
        title: 'Phone-in',
        writingMode: 'outlined',
        targetMs: 180_000,
        state: 'planned',
        createdAt: 0,
        ...over,
    }) as Production;

function build(
    options: {
        roster?: ReturnType<typeof caller>[];
        heard?: Map<string, number>;
        rosterThrows?: boolean;
        kinds?: string;
        djName?: string;
        nobodyPresents?: boolean;
        keen?: boolean;
        played?: { trackId?: string; title: string; artist: string }[];
        playsThrow?: boolean;
        facts?: Map<string, string[]>;
    } = {},
) {
    const personas = {
        presenting: vi.fn(async () =>
            options.nobodyPresents
                ? undefined
                : {
                      id: 'host-1',
                      key: 'classic',
                      kind: 'host',
                      label: 'Classic',
                      style: 'warm',
                      voice: 'classic',
                      ...(options.keen ? { trivia: 'keen' } : {}),
                  },
        ),
        castable: vi.fn(async () => {
            if (options.rosterThrows) throw new Error('the roster could not be read');
            return options.roster ?? [];
        }),
    };
    const segments = { lastSpokenBy: vi.fn(async () => options.heard ?? new Map<string, number>()) };
    // Strings, because every layer of AppConfig holds strings. A double that answered a real value
    // here would prove nothing about how the setting is actually read.
    const settings: Record<string, string | undefined> = { 'render.dialogueKinds': options.kinds, 'station.djName': options.djName };
    const config = { get: (key: string, fallback: string) => settings[key] ?? fallback };

    const plays = {
        recordsDuringBroadcast: vi.fn(async () => {
            if (options.playsThrow) throw new Error('play history could not be read');
            return options.played ?? [];
        }),
    };
    const enrichment = { factsForTracks: vi.fn(async () => options.facts ?? new Map<string, string[]>()) };

    return {
        personas,
        segments,
        plays,
        enrichment,
        caster: new ProductionCaster(personas as never, segments as never, plays as never, enrichment as never, config as never, logger as never),
    };
}

describe('casting a production', () => {
    it('casts the presenter alone for a kind that has no callers', async () => {
        const { caster, personas } = build({ roster: [caller('skeptic')] });

        const cast = await caster.cast(production({ kind: 'podcast' }), 9);

        expect(cast).toEqual([{ role: 'host', personaId: 'host-1', personaKey: 'classic', voice: 'classic' }]);
        // Not even asked for: a podcast is one voice thinking out loud, and the roster read is a
        // question that does not arise.
        expect(personas.castable).not.toHaveBeenCalled();
    });

    it('casts somebody to ring in for a kind that does', async () => {
        const { caster } = build({ roster: [caller('skeptic')] });

        const cast = await caster.cast(production(), 9);

        expect(cast.map(member => member.role)).toEqual(['host', 'caller']);
        expect(cast[1]?.personaKey).toBe('skeptic');
    });

    it('takes the least recently heard first, so a station with five callers has five', async () => {
        const { caster } = build({
            roster: [caller('skeptic'), caller('grumbler'), caller('pedant')],
            heard: new Map([
                ['id-skeptic', 5_000],
                ['id-grumbler', 1_000],
            ]),
        });

        const cast = await caster.cast(production(), 9);

        // `pedant` has never spoken at all, so it sorts in front of both of them.
        expect(cast[1]?.personaKey).toBe('pedant');
    });

    it('casts the presenter alone on a station that has written no callers', async () => {
        const { caster } = build({ roster: [] });

        expect(await caster.cast(production(), 9)).toHaveLength(1);
    });

    it('casts the presenter alone when the roster could not be read at all', async () => {
        // A programme with one voice is what every production was until recently. Failing one over
        // who was going to be on it is the outcome this must never have.
        const { caster } = build({ rosterThrows: true });

        expect(await caster.cast(production(), 9)).toEqual([{ role: 'host', personaId: 'host-1', personaKey: 'classic', voice: 'classic' }]);
    });

    it('casts nobody into a block too short to introduce them in', async () => {
        const { caster } = build({ roster: [caller('skeptic')] });

        expect(await caster.cast(production(), 1)).toHaveLength(1);
    });

    it("names an unnamed presenter with the station's presenter name, and no caller with it", async () => {
        const { caster } = build({ roster: [caller('skeptic')], djName: 'Casey' });

        const cast = await caster.cast(production(), 9);

        expect(cast[0]?.name).toBe('Casey');
        expect(cast[1]?.name).toBeUndefined();
    });

    it('reads the kinds the operator actually named', async () => {
        const { caster } = build({ roster: [caller('skeptic')], kinds: 'podcast, PHONE-IN' });

        expect(await caster.cast(production({ kind: 'phone-in' }), 9)).toHaveLength(2);
        expect(await caster.cast(production({ kind: 'callin' }), 9)).toHaveLength(1);
    });
});

// A caller can be tied to the hosts it rings in to. Which callers qualify is the repository's SQL and
// is held there; what the caster owes it is the right host, and a rotation run over what comes back.
describe('casting the callers who ring this host', () => {
    it('asks for the callers of whoever is presenting', async () => {
        const { caster, personas } = build({ roster: [caller('skeptic')] });

        await caster.cast(production({ personaId: 'host-1' }), 9);

        expect(personas.presenting).toHaveBeenCalledWith('host-1');
        expect(personas.castable).toHaveBeenCalledWith('host-1');
    });

    it('asks for the untied alone when the station presents as nobody', async () => {
        const { caster, personas } = build({ roster: [caller('skeptic')], nobodyPresents: true });

        await caster.cast(production(), 9);

        expect(personas.castable).toHaveBeenCalledWith(undefined);
    });

    it('rotates over the callers that came back and nobody else', async () => {
        // The repository has already narrowed the roster to this host's callers; a caller it left out
        // must not reach the cast however long ago it last rang.
        const { caster } = build({ roster: [caller('tipster'), caller('trucker')], heard: new Map([['id-trucker', 1]]) });

        const cast = await caster.cast(production(), 9);

        expect(cast.filter(member => member.role === 'caller').map(member => member.personaKey)).toEqual(['tipster']);
    });
});

// A presenter whose show is the records (the countdown host, `trivia: 'keen'`) brings what the show has
// just played to the call, so its callers ring about the records. Nobody else's callers are handed any.
describe('the records a keen host brings to a call', () => {
    const played = [
        { trackId: 't1', title: 'Enter Sandman', artist: 'Metallica' },
        { title: 'Holy Wars', artist: 'Megadeth' },
    ];

    it('puts what the show just played, and what the station knows about it, on the host', async () => {
        const { caster, plays, enrichment } = build({
            roster: [caller('pedant')],
            keen: true,
            played,
            facts: new Map([['t1', ['It opened the album.']]]),
        });

        const cast = await caster.cast(production({ broadcastId: 'b1' }), 9);

        expect(plays.recordsDuringBroadcast).toHaveBeenCalledWith('b1', 4);
        expect(enrichment.factsForTracks).toHaveBeenCalledWith(['t1'], expect.any(Number), { budget: { limit: 2, spread: true } });
        expect(cast[0]?.records).toEqual([
            { title: 'Enter Sandman', artist: 'Metallica', facts: ['It opened the album.'] },
            { title: 'Holy Wars', artist: 'Megadeth' },
        ]);
    });

    // The conspiracy host's callers talked about records because a playlist reached their call. A list
    // of titles in the prompt would be the same failure through a different door.
    it('hands no records to a host who is not keen', async () => {
        const { caster, plays } = build({ roster: [caller('skeptic')], played });

        const cast = await caster.cast(production({ broadcastId: 'b1' }), 9);

        expect(cast[0]).not.toHaveProperty('records');
        expect(plays.recordsDuringBroadcast).not.toHaveBeenCalled();
    });

    it('reads nothing for a programme with nobody on the phone', async () => {
        const { caster, plays } = build({ roster: [], keen: true, played });

        const cast = await caster.cast(production({ broadcastId: 'b1' }), 9);

        expect(cast).toHaveLength(1);
        expect(plays.recordsDuringBroadcast).not.toHaveBeenCalled();
    });

    it('reads nothing for a production commissioned outside any broadcast', async () => {
        const { caster, plays } = build({ roster: [caller('pedant')], keen: true, played });

        await caster.cast(production(), 9);

        expect(plays.recordsDuringBroadcast).not.toHaveBeenCalled();
    });

    // The records make a call better and never make it possible.
    it('keeps the caller when the records cannot be read', async () => {
        const { caster } = build({ roster: [caller('pedant')], keen: true, playsThrow: true });

        const cast = await caster.cast(production({ broadcastId: 'b1' }), 9);

        expect(cast.map(member => member.role)).toEqual(['host', 'caller']);
        expect(cast[0]).not.toHaveProperty('records');
    });
});
