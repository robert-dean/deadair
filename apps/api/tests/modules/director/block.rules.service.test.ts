// The console's door onto never-play rules. What is pinned: a half-written scope is refused with a
// sentence rather than reaching the table's pair checks as a 500, each rule says whether it holds
// right now for what is on air, and a lean is trimmed, de-duplicated and refused when it names nothing.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { BlockRulesService } from '../../../src/modules/director/block.rules.service.js';
import type { BlockRule } from '../../../src/modules/director/block.rules.js';

function build(options: { rules?: BlockRule[]; mode?: 'rotation' | 'setlist' | 'feature'; slotId?: string } = {}) {
    const rules = {
        list: vi.fn(async () => options.rules ?? []),
        add: vi.fn(async () => undefined),
        change: vi.fn(async (id: string) => (options.rules?.some(rule => rule.id === id) ? options.rules[0] : undefined)),
        remove: vi.fn(async (id: string) => options.rules?.some(rule => rule.id === id) ?? false),
        steer: vi.fn(async () => undefined),
        setSteer: vi.fn(async (genres: string[]) => ({ genres, endsAt: '2026-10-04T15:00:00.000Z' })),
        clearSteer: vi.fn(async () => undefined),
    };
    const director = {
        order: vi.fn(() => (options.mode === undefined ? undefined : { mode: options.mode })),
        status: vi.fn(() => ({ active: true, ...(options.slotId === undefined ? {} : { slotId: options.slotId }) })),
    };
    const config = { get: vi.fn((key: string, fallback: unknown) => (key === 'station.timezone' ? 'UTC' : fallback)) };

    return { service: new BlockRulesService(rules as never, director as never, config as never), rules };
}

const statusOf = async (call: Promise<unknown>): Promise<number | undefined> =>
    call.then(
        () => undefined,
        (error: { statusCode?: number }) => error.statusCode,
    );

describe('BlockRulesService', () => {
    it('refuses half a season or half a window of hours with a sentence, before the table can', async () => {
        const { service, rules } = build();

        expect(await statusOf(service.add({ field: 'genre', value: 'Christmas', seasonFrom: '12-01' }))).toBe(400);
        expect(await statusOf(service.add({ field: 'genre', value: 'Christmas', seasonFrom: '13-01', seasonTo: '12-31' }))).toBe(400);
        expect(await statusOf(service.add({ field: 'genre', value: 'Metal', fromHour: 6 }))).toBe(400);
        expect(await statusOf(service.add({ field: 'genre', value: '   ' }))).toBe(400);
        expect(rules.add).not.toHaveBeenCalled();
    });

    it('stores a rule trimmed, with its expiry in UTC', async () => {
        const { service, rules } = build();

        await service.add({ field: 'genre', value: ' Country ', endsAt: DateTime.fromISO('2026-10-04T18:00:00+01:00') });

        expect(rules.add).toHaveBeenCalledWith({ field: 'genre', value: 'Country', endsAt: '2026-10-04T17:00:00.000Z' });
    });

    it('says which rules hold right now, for the mode on air', async () => {
        const { service } = build({
            mode: 'feature',
            rules: [
                { id: 'a', field: 'genre', value: 'Country' },
                { id: 'b', field: 'genre', value: 'Metal', modes: ['rotation'] },
                { id: 'c', field: 'tag', value: 'live', endsAt: '2000-01-01T00:00:00.000Z' },
            ],
        });

        const { rules } = await service.list();

        expect(rules.map(rule => [rule.id, rule.inForce])).toEqual([
            ['a', true],
            ['b', false],
            ['c', false],
        ]);
    });

    it('answers a rule this station does not have with a 404', async () => {
        const { service } = build();

        expect(await statusOf(service.remove('missing'))).toBe(404);
        expect(await statusOf(service.change('missing', { field: 'genre', value: 'Jazz' }))).toBe(404);
    });

    it('leans toward the genres named once each, and refuses a lean that names none', async () => {
        const { service, rules } = build();

        const reading = await service.steer({ genres: [' Soul ', 'Soul', 'Funk'], hours: 3 });

        expect(rules.setSteer).toHaveBeenCalledWith(['Soul', 'Funk'], 3);
        expect(reading.steer?.genres).toEqual(['Soul', 'Funk']);
        expect(await statusOf(service.steer({ genres: ['  '], hours: 3 }))).toBe(400);
    });
});
