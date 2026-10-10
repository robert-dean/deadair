// A route between two artists over a graph of facts (shared credits) and opinions (similarity). What
// matters is that it only ever goes through artists the station can air, that a fact is preferred to an
// opinion, that it keeps the link each hop took, and that it gives up inside its bounds.

import { describe, expect, it, vi } from 'vitest';

import { normalizeKey } from '../../../src/modules/catalog/catalog.keys.js';
import { hopCost, MAX_EXPANSIONS, planRoute, similarStrength, type RoutePorts } from '../../../src/modules/director/route.planner.js';
import type { CoCredit, OwnedArtist } from '../../../src/modules/director/route.repository.js';
import type { Neighbour } from '../../../src/modules/similarity/similarity.service.js';

const LASTFM = 'deadair.lastfm';

interface World {
    /** Artists the library can air. */
    owned: string[];
    /** Who each artist's similarity sources name, best first, with an optional score. */
    similar?: Record<string, [string, number?][]>;
    /** Shared credits, both ways. */
    credits?: [string, string, string][];
}

function ports(world: World) {
    const owned = new Map(world.owned.map(name => [normalizeKey(name), { artistKey: normalizeKey(name), name } as OwnedArtist]));
    const credits = world.credits ?? [];
    return {
        owned: vi.fn(async (keys: readonly string[]) => new Map(keys.flatMap(key => (owned.has(key) ? [[key, owned.get(key)!] as const] : [])))),
        coCredits: vi.fn(async (key: string): Promise<CoCredit[]> =>
            credits.flatMap(([a, b, title]) => {
                if (normalizeKey(a) === key) return [{ artistKey: normalizeKey(b), name: b, title, lead: a }];
                if (normalizeKey(b) === key) return [{ artistKey: normalizeKey(a), name: a, title, lead: a }];
                return [];
            }),
        ),
        neighbours: vi.fn(async (name: string): Promise<Neighbour[]> =>
            (world.similar?.[name] ?? []).map(([neighbour, match]) => ({
                name: neighbour,
                source: LASTFM,
                ...(match === undefined ? {} : { match }),
            })),
        ),
    } satisfies RoutePorts;
}

const names = (route: { name: string }[] | undefined) => route?.map(stop => stop.name);

describe('planRoute', () => {
    it('walks from one artist to another through artists the station can air', async () => {
        const world = ports({
            owned: ['Portishead', 'Massive Attack', 'Daft Punk'],
            similar: {
                Portishead: [
                    ['Massive Attack', 0.9],
                    ['Tricky', 0.95],
                ],
                'Massive Attack': [['Daft Punk', 0.4]],
            },
        });

        const route = await planRoute('Portishead', 'Daft Punk', world);

        // Tricky is the stronger opinion and is skipped: the library holds nothing by them.
        expect(names(route)).toEqual(['Portishead', 'Massive Attack', 'Daft Punk']);
        expect(route![0]!.link).toBeUndefined();
        expect(route![1]!.link).toEqual({ kind: 'similar', source: LASTFM, match: 0.9 });
    });

    it('prefers a shared credit to an opinion, and keeps the record it rests on', async () => {
        const world = ports({
            owned: ['Gorillaz', 'Daft Punk', 'Blur'],
            similar: { Gorillaz: [['Blur', 0.6]], Blur: [['Daft Punk', 0.6]] },
            credits: [['Gorillaz', 'Daft Punk', 'Some Collab']],
        });

        const route = await planRoute('Gorillaz', 'Daft Punk', world);

        expect(names(route)).toEqual(['Gorillaz', 'Daft Punk']);
        expect(route![1]!.link).toEqual({ kind: 'credit', title: 'Some Collab', lead: 'Gorillaz' });
    });

    it('answers nothing when either end is not an artist the station can air', async () => {
        expect(await planRoute('Portishead', 'Nobody', ports({ owned: ['Portishead'] }))).toBeUndefined();
        expect(await planRoute('Nobody', 'Portishead', ports({ owned: ['Portishead'] }))).toBeUndefined();
    });

    it('answers nothing when the two are not connected, and stops inside its bounds', async () => {
        // A long chain away from the goal: every artist leads only to the next.
        const chain = Array.from({ length: MAX_EXPANSIONS + 10 }, (_, n) => `Artist ${n}`);
        const similar = Object.fromEntries(chain.map((name, n) => [name, n + 1 < chain.length ? [[chain[n + 1]!, 0.9]] : []])) as World['similar'];
        const world = ports({ owned: [...chain, 'Island'], similar });

        expect(await planRoute('Artist 0', 'Island', world)).toBeUndefined();
        expect(world.neighbours.mock.calls.length).toBeLessThanOrEqual(MAX_EXPANSIONS);
    });

    it('is one stop when it starts where it ends', async () => {
        expect(names(await planRoute('Portishead', 'portishead', ports({ owned: ['Portishead'] })))).toEqual(['Portishead']);
    });

    it('keeps going when a source or the credits cannot answer for one artist', async () => {
        const world = ports({ owned: ['A', 'B', 'C'], similar: { A: [['B', 0.8]], B: [['C', 0.8]] } });
        world.coCredits.mockRejectedValue(new Error('the table is gone'));

        expect(names(await planRoute('A', 'C', world))).toEqual(['A', 'B', 'C']);
    });
});

describe('the hop costs', () => {
    it('charges a weak link more than a strong one, and every hop something', () => {
        expect(hopCost(1)).toBeLessThan(hopCost(0.5));
        expect(hopCost(0)).toBeGreaterThan(hopCost(0.5));
        expect(hopCost(1)).toBeGreaterThan(0.5);
    });

    it('reads a score where the source gave one, and a rank where it did not', () => {
        expect(similarStrength({ match: 0.7 }, 5, 10)).toBe(0.7);
        expect(similarStrength({}, 0, 10)).toBe(1);
        expect(similarStrength({}, 5, 10)).toBe(0.5);
    });
});
