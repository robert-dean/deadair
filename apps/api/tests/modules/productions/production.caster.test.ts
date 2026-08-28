// Who gets cast, and the two rules that decide it: a kind the operator said has callers, and a
// rotation over the roster. Everything else here is about the failure directions — a station with no
// callers, a roster that could not be read — because both have to end in a production the presenter
// reads alone rather than a production that does not happen.

import { describe, expect, it, vi } from 'vitest';

import { ProductionCaster } from '../../../src/modules/productions/production.caster.js';
import type { Production } from '../../../src/modules/productions/production.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const caller = (key: string) => ({ id: `id-${key}`, key, kind: 'caller' as const, label: key, style: 'somebody', voice: key, active: false });

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

function build(options: { roster?: ReturnType<typeof caller>[]; heard?: Map<string, number>; rosterThrows?: boolean; kinds?: string } = {}) {
    const personas = {
        presenting: vi.fn(async () => ({ id: 'host-1', key: 'classic', kind: 'host', label: 'Classic', style: 'warm', voice: 'classic' })),
        castable: vi.fn(async () => {
            if (options.rosterThrows) throw new Error('the roster could not be read');
            return options.roster ?? [];
        }),
    };
    const segments = { lastSpokenBy: vi.fn(async () => options.heard ?? new Map<string, number>()) };
    // Strings, because every layer of AppConfig holds strings. A double that answered a real value
    // here would prove nothing about how the setting is actually read.
    const config = { get: (key: string, fallback: string) => (key === 'render.dialogueKinds' ? (options.kinds ?? fallback) : fallback) };

    return { personas, segments, caster: new ProductionCaster(personas as never, segments as never, config as never, logger as never) };
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

    it('reads the kinds the operator actually named', async () => {
        const { caster } = build({ roster: [caller('skeptic')], kinds: 'podcast, PHONE-IN' });

        expect(await caster.cast(production({ kind: 'phone-in' }), 9)).toHaveLength(2);
        expect(await caster.cast(production({ kind: 'callin' }), 9)).toHaveLength(1);
    });
});
