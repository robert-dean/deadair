// The chain exists to make a second generator safe to add, so everything worth testing here is a
// way that second generator can misbehave: throwing, answering short, answering with junk, or
// naming what the floor is about to name again. None of them may cost the station a running order,
// and none of them may discard the good half of a partial answer.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { SetGeneratorChain } from '../../../src/modules/director/set.generator.chain.js';
import { SetGenerator, type SetInputs, type TrackPick } from '../../../src/modules/director/set.generator.js';
import { DEFAULT_RULES } from '../../../src/modules/director/rotation.rules.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

/** A generator that answers with whatever it was built with, and records what it was asked. */
class Fake extends SetGenerator {
    readonly asked: SetInputs[] = [];

    constructor(
        readonly name: string,
        private readonly answer: TrackPick[] | Error,
    ) {
        super();
    }

    async generate(inputs: SetInputs): Promise<TrackPick[]> {
        this.asked.push(inputs);
        if (this.answer instanceof Error) throw this.answer;
        return this.answer;
    }
}

/** `count` picks by distinct artists, named for the generator that produced them. */
const picks = (prefix: string, count: number): TrackPick[] =>
    Array.from({ length: count }, (_, index) => ({ title: `${prefix}-title-${index}`, artist: `${prefix}-artist-${index}` }));

const inputs = (count: number, overrides: Partial<SetInputs> = {}): SetInputs => ({ count, rules: DEFAULT_RULES, ...overrides });

describe('SetGeneratorChain', () => {
    it('takes the first generator’s answer when it fills the request', async () => {
        const first = new Fake('model', picks('model', 5));
        const floor = new Fake('catalog', picks('catalog', 5));

        const chosen = await new SetGeneratorChain([first, floor], logger).generate(inputs(5));

        expect(chosen).toHaveLength(5);
        expect(floor.asked).toHaveLength(0);
    });

    it('tops up a partial answer instead of discarding it', async () => {
        // The whole reason this is not the writer registry. Six good picks are six good picks.
        const first = new Fake('model', picks('model', 6));
        const floor = new Fake('catalog', picks('catalog', 20));

        const chosen = await new SetGeneratorChain([first, floor], logger).generate(inputs(15));

        expect(chosen).toHaveLength(15);
        expect(chosen.filter(pick => pick.artist.startsWith('model'))).toHaveLength(6);
        expect(chosen.filter(pick => pick.artist.startsWith('catalog'))).toHaveLength(9);
    });

    it('asks each generator only for what is still missing', async () => {
        const first = new Fake('model', picks('model', 6));
        const floor = new Fake('catalog', picks('catalog', 20));

        await new SetGeneratorChain([first, floor], logger).generate(inputs(15));

        expect(first.asked[0]?.count).toBe(15);
        expect(floor.asked[0]?.count).toBe(9);
    });

    it('costs nothing when a generator throws', async () => {
        const broken = new Fake('model', new Error('the model host is down'));
        const floor = new Fake('catalog', picks('catalog', 10));

        const chosen = await new SetGeneratorChain([broken, floor], logger).generate(inputs(10));

        expect(chosen).toHaveLength(10);
        expect(logger.warn).toHaveBeenCalled();
    });

    it('answers short rather than throwing when every generator comes up empty', async () => {
        // A small library under a wide repeat window genuinely has less to offer, and the caller
        // appends what it got rather than failing.
        const chain = new SetGeneratorChain([new Fake('model', []), new Fake('catalog', [])], logger);

        expect(await chain.generate(inputs(10))).toEqual([]);
    });

    it('threads what has been chosen down as songs to avoid', async () => {
        const first = new Fake('model', [{ title: 'Windowlicker', artist: 'Aphex Twin' }]);
        const floor = new Fake('catalog', picks('catalog', 5));

        await new SetGeneratorChain([first, floor], logger).generate(inputs(5));

        expect([...(floor.asked[0]?.avoidSongKeys ?? [])]).toContain('aphex twin:windowlicker');
    });

    it('keeps the caller’s own avoid set on the way down', async () => {
        const floor = new Fake('catalog', picks('catalog', 5));
        const already = new Set(['someone:something']);

        await new SetGeneratorChain([floor], logger).generate(inputs(5, { avoidSongKeys: already }));

        expect([...(floor.asked[0]?.avoidSongKeys ?? [])]).toContain('someone:something');
    });

    it('refuses a duplicate even from a generator that ignored the avoid set', async () => {
        // The avoid keys are advice a generator is trusted to honour. A record airing twice in an
        // hour is cheap enough to make impossible rather than to trust.
        const first = new Fake('model', [{ title: 'Windowlicker', artist: 'Aphex Twin' }]);
        const stubborn = new Fake('catalog', [
            { title: 'Windowlicker', artist: 'Aphex Twin' },
            { title: 'Xtal', artist: 'Aphex Twin' },
        ]);

        const chosen = await new SetGeneratorChain([first, stubborn], logger).generate(inputs(5));

        expect(chosen.map(pick => pick.title)).toEqual(['Windowlicker', 'Xtal']);
    });

    it('never hands back more than was asked for', async () => {
        // The caller sized its oversample against this number.
        const greedy = new Fake('model', picks('model', 40));

        expect(await new SetGeneratorChain([greedy], logger).generate(inputs(5))).toHaveLength(5);
    });

    it('drops a pick with no title or no artist rather than sending it to be resolved', async () => {
        const sloppy = new Fake('model', [
            { title: '   ', artist: 'One' },
            { title: 'B', artist: '' },
            { title: 'C', artist: 'Three' },
        ]);

        const chosen = await new SetGeneratorChain([sloppy], logger).generate(inputs(5));

        expect(chosen.map(pick => pick.title)).toEqual(['C']);
    });

    it('asks nobody for nothing', async () => {
        const floor = new Fake('catalog', picks('catalog', 5));

        expect(await new SetGeneratorChain([floor], logger).generate(inputs(0))).toEqual([]);
        expect(floor.asked).toHaveLength(0);
    });

    it('reports the bindings in the order they will be asked', () => {
        const chain = new SetGeneratorChain([new Fake('model', []), new Fake('catalog', [])], logger);

        expect(chain.bindings()).toEqual(['model', 'catalog']);
    });
});
