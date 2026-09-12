// The chain exists to make a second generator safe to add, so everything worth testing here is a
// way that second generator can misbehave: throwing, answering short, answering with junk, or
// naming what the floor is about to name again. None of them may cost the station a running order,
// and none of them may discard the good half of a partial answer.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';
import { BRIEF_ONLY_KEY, SetGeneratorChain } from '../../../src/modules/director/set.generator.chain.js';
import { SetGenerator, type SetInputs, type TrackPick } from '../../../src/modules/director/set.generator.js';
import { CatalogSetGenerator } from '../../../src/modules/director/catalog.set.generator.js';
import { ModelSetGenerator } from '../../../src/modules/director/model.set.generator.js';
import { DEFAULT_RULES } from '../../../src/modules/director/rotation.rules.js';
import { songKey } from '../../../src/modules/director/rotation.keys.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

/** The feed's write side. What reaches it is asserted in its own describe below. */
const activity = { record: vi.fn(async () => undefined) } as unknown as ActivityRecorder;

/** Settings, defaulting to whatever the caller did not override. Only `rotation.briefOnly` is read. */
const settings = (rows: Record<string, unknown> = {}): AppConfig =>
    ({ get: (key: string, fallback: unknown) => rows[key] ?? fallback }) as unknown as AppConfig;

/** The chain under test, with the two collaborators every case shares. */
const chain = (generators: SetGenerator[], rows: Record<string, unknown> = {}): SetGeneratorChain =>
    new SetGeneratorChain(generators, activity, settings(rows), logger);

/** A generator that answers with whatever it was built with, and records what it was asked. */
class Fake extends SetGenerator {
    readonly asked: SetInputs[] = [];

    /** Redeclared without `readonly` so a case can mark this one deaf to the brief after building it. */
    override ignoresBrief = false;

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

        const chosen = await chain([first, floor]).generate(inputs(5));

        expect(chosen).toHaveLength(5);
        expect(floor.asked).toHaveLength(0);
    });

    it('tops up a partial answer instead of discarding it', async () => {
        // The whole reason this is not the writer registry. Six good picks are six good picks.
        const first = new Fake('model', picks('model', 6));
        const floor = new Fake('catalog', picks('catalog', 20));

        const chosen = await chain([first, floor]).generate(inputs(15));

        expect(chosen).toHaveLength(15);
        expect(chosen.filter(pick => pick.artist.startsWith('model'))).toHaveLength(6);
        expect(chosen.filter(pick => pick.artist.startsWith('catalog'))).toHaveLength(9);
    });

    it('asks each generator only for what is still missing', async () => {
        const first = new Fake('model', picks('model', 6));
        const floor = new Fake('catalog', picks('catalog', 20));

        await chain([first, floor]).generate(inputs(15));

        expect(first.asked[0]?.count).toBe(15);
        expect(floor.asked[0]?.count).toBe(9);
    });

    it('costs nothing when a generator throws', async () => {
        const broken = new Fake('model', new Error('the model host is down'));
        const floor = new Fake('catalog', picks('catalog', 10));

        const chosen = await chain([broken, floor]).generate(inputs(10));

        expect(chosen).toHaveLength(10);
        expect(logger.warn).toHaveBeenCalled();
    });

    it('answers short rather than throwing when every generator comes up empty', async () => {
        // A small library under a wide repeat window genuinely has less to offer, and the caller
        // appends what it got rather than failing.
        const built = chain([new Fake('model', []), new Fake('catalog', [])]);

        expect(await built.generate(inputs(10))).toEqual([]);
    });

    it('threads what has been chosen down as songs to avoid', async () => {
        const first = new Fake('model', [{ title: 'Windowlicker', artist: 'Aphex Twin' }]);
        const floor = new Fake('catalog', picks('catalog', 5));

        await chain([first, floor]).generate(inputs(5));

        expect([...(floor.asked[0]?.avoidSongKeys ?? [])]).toContain('aphex twin:windowlicker');
    });

    it('keeps the caller’s own avoid set on the way down', async () => {
        const floor = new Fake('catalog', picks('catalog', 5));
        const already = new Set(['someone:something']);

        await chain([floor]).generate(inputs(5, { avoidSongKeys: already }));

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

        const chosen = await chain([first, stubborn]).generate(inputs(5));

        expect(chosen.map(pick => pick.title)).toEqual(['Windowlicker', 'Xtal']);
    });

    it('never hands back more than was asked for', async () => {
        // The caller sized its oversample against this number.
        const greedy = new Fake('model', picks('model', 40));

        expect(await chain([greedy]).generate(inputs(5))).toHaveLength(5);
    });

    it('drops a pick with no title or no artist rather than sending it to be resolved', async () => {
        const sloppy = new Fake('model', [
            { title: '   ', artist: 'One' },
            { title: 'B', artist: '' },
            { title: 'C', artist: 'Three' },
        ]);

        const chosen = await chain([sloppy]).generate(inputs(5));

        expect(chosen.map(pick => pick.title)).toEqual(['C']);
    });

    it('asks nobody for nothing', async () => {
        const floor = new Fake('catalog', picks('catalog', 5));

        expect(await chain([floor]).generate(inputs(0))).toEqual([]);
        expect(floor.asked).toHaveLength(0);
    });

    it('still asks a brief-blind generator when the operator has not made the brief binding', async () => {
        // The default, and the guarantee the whole architecture rests on: the floor finishes the
        // job whether or not it could read what was asked for.
        const floor = new Fake('catalog', picks('catalog', 20));
        floor.ignoresBrief = true;

        const chosen = await chain([new Fake('model', picks('model', 5)), floor]).generate(inputs(15, { brief: 'flamenco guitar' }));

        expect(chosen).toHaveLength(15);
    });

    it('leaves the slots empty rather than filling them from a generator that cannot read the brief', async () => {
        const floor = new Fake('catalog', picks('catalog', 20));
        floor.ignoresBrief = true;

        const chosen = await chain([new Fake('model', picks('model', 5)), floor], { [BRIEF_ONLY_KEY]: true }).generate(
            inputs(15, { brief: 'flamenco guitar' }),
        );

        expect(chosen).toHaveLength(5);
        // Not asked at all, rather than asked and discarded: the point is to spend nothing on picks
        // the operator has said they do not want.
        expect(floor.asked).toHaveLength(0);
    });

    it('leaves a generator that CAN read the brief alone, however short the answer', async () => {
        // The setting is about deafness to the brief and not about which generator is last. A model
        // that read the instruction and found four records has honoured it.
        const model = new Fake('model', picks('model', 4));

        const chosen = await chain([model], { [BRIEF_ONLY_KEY]: true }).generate(inputs(15, { brief: 'flamenco guitar' }));

        expect(chosen).toHaveLength(4);
        expect(model.asked).toHaveLength(1);
    });

    it('is inert on an unbriefed refill, where the floor is the station rather than a mismatch', async () => {
        // The foot-gun this avoids: read as "never draw from the catalog" it would silence an
        // ordinary hour with a full library and nothing saying why.
        const floor = new Fake('catalog', picks('catalog', 20));
        floor.ignoresBrief = true;

        const chosen = await chain([floor], { [BRIEF_ONLY_KEY]: true }).generate(inputs(15));

        expect(chosen).toHaveLength(15);
    });

    it('reads the setting as the string the settings table actually stores', async () => {
        // `AppConfigSourcePostgres` snapshots the row verbatim, so this arrives as `"true"` rather
        // than `true`. Read as a boolean it would be truthy either way — which means the OFF state
        // is the one that breaks, and it strands the station in silence.
        const floor = new Fake('catalog', picks('catalog', 20));
        floor.ignoresBrief = true;

        const on = await chain([floor], { [BRIEF_ONLY_KEY]: 'true' }).generate(inputs(15, { brief: 'flamenco guitar' }));
        expect(on).toHaveLength(0);

        const off = await chain([floor], { [BRIEF_ONLY_KEY]: 'false' }).generate(inputs(15, { brief: 'flamenco guitar' }));
        expect(off).toHaveLength(15);
    });

    it('treats a blank brief as no brief', async () => {
        const floor = new Fake('catalog', picks('catalog', 20));
        floor.ignoresBrief = true;

        const chosen = await chain([floor], { [BRIEF_ONLY_KEY]: true }).generate(inputs(15, { brief: '   ' }));

        expect(chosen).toHaveLength(15);
    });

    it('reports the bindings in the order they will be asked', () => {
        const built = chain([new Fake('model', []), new Fake('catalog', [])]);

        expect(built.bindings()).toEqual(['model', 'catalog']);
    });
});

// The invariant, driven through the two bindings the station actually registers rather than
// through fakes. Everything above proves the chain's arithmetic; this proves the thing the
// arithmetic exists for, which is that no way of the model being unavailable can leave the station
// without a running order.
describe('SetGeneratorChain with the real bindings', () => {
    /** A catalog of `count` records by distinct artists, none of them recently aired. */
    function catalogOf(count: number) {
        const candidates = {
            sample: vi.fn(async () =>
                Array.from({ length: count }, (_, index) => ({
                    trackId: `track-${index}`,
                    title: `Title ${index}`,
                    artist: `Artist ${index}`,
                    credit: `Artist ${index}`,
                    rating: 0,
                })),
            ),
        } as unknown as ConstructorParameters<typeof CatalogSetGenerator>[0];

        const history = {
            songKeysSince: vi.fn(async () => new Set<string>()),
            artistKeysSince: vi.fn(async () => new Set<string>()),
            lastAiredSince: vi.fn(async () => new Map()),
        } as unknown as ConstructorParameters<typeof CatalogSetGenerator>[1];

        // No advisory setting stored, so the policy resolves to its default and narrows nothing:
        // this helper exists to be the chain's floor, not to exercise the policy.
        const config = { get: (_key: string, fallback?: unknown) => fallback } as unknown as ConstructorParameters<typeof CatalogSetGenerator>[3];
        const watch = { starved: vi.fn(), clear: vi.fn() } as unknown as ConstructorParameters<typeof CatalogSetGenerator>[4];
        const eraWatch = { starved: vi.fn(), clear: vi.fn() } as unknown as ConstructorParameters<typeof CatalogSetGenerator>[5];

        return new CatalogSetGenerator(candidates, history, new StationIdentity(), config, watch, eraWatch);
    }

    /** The model binding as an operator who never turned it on has it. */
    const modelOff = () =>
        new ModelSetGenerator(
            { converse: vi.fn(), canGenerate: () => true, explainGenerator: () => '' } as never,
            // Neither is read: this binding declines on the config check before it would ask
            // the station what it likes or what styles its library knows.
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            { get: (_key: string, fallback: unknown) => fallback, has: () => false } as never,
            logger,
            // Nor are these: the smart shuffle's history read comes after the same config check.
            {} as never,
            {} as never,
            {} as never,
        );

    it('fills the whole request from the floor when the model is switched off', async () => {
        const built = chain([modelOff(), catalogOf(50)]);

        expect(await built.generate(inputs(15))).toHaveLength(15);
    });

    it('fills it from the floor when the model throws', async () => {
        const broken = new Fake('model', new Error('the model host is down'));
        const built = chain([broken, catalogOf(50)]);

        expect(await built.generate(inputs(15))).toHaveLength(15);
    });
});

/**
 * What reaches the activity feed, which is much less than what reaches the log.
 *
 * The attribution exists nowhere else: `generate` answers with picks and a `TrackPick` does not
 * carry the generator that named it, so the job downstream can see how many records arrived and
 * never which binding found them.
 */
describe('SetGeneratorChain: what reaches the activity feed', () => {
    const recorded = () => activity.record as unknown as ReturnType<typeof vi.fn>;

    beforeEach(() => recorded().mockClear());

    it('says who named how much when more than one generator was asked', async () => {
        const first = new Fake('model', picks('model', 2));
        const floor = new Fake('catalog', picks('catalog', 8));

        await chain([first, floor]).generate(inputs(5));

        expect(recorded()).toHaveBeenCalledOnce();
        expect(recorded().mock.calls[0]![0]).toMatchObject({
            module: 'director',
            kind: 'set.generated',
            data: {
                asked: 5,
                chosen: 5,
                named: [
                    { generator: 'model', kept: 2 },
                    { generator: 'catalog', kept: 3 },
                ],
            },
        });
    });

    it('stays quiet when one generator filled the batch on its own', async () => {
        // A station with one binding installed would otherwise write the same line every refill,
        // which is the fastest way to make a feed unreadable.
        await chain([new Fake('catalog', picks('catalog', 9))]).generate(inputs(5));

        expect(recorded()).not.toHaveBeenCalled();
    });

    it('speaks up for a short batch even from one generator', async () => {
        // A library that has run dry is a station quietly running short hours, which is worth
        // knowing and is invisible from the running order alone.
        await chain([new Fake('catalog', picks('catalog', 2))]).generate(inputs(5));

        expect(recorded()).toHaveBeenCalledOnce();
        // Not a fault: a library smaller than the station's appetite is an ordinary state.
        expect(recorded().mock.calls[0]![0]).not.toHaveProperty('severity');
        expect(recorded().mock.calls[0]![0]).toMatchObject({ data: { asked: 5, chosen: 2 } });
    });

    it('credits a generator with what was KEPT, not what it named', async () => {
        // A generator naming records the order already holds contributes nothing, and crediting it
        // would hide the exact failure `set.prompt.ts` calls "the seed is not a pick".
        const repeat = new Fake('model', picks('model', 1));
        const floor = new Fake('catalog', picks('catalog', 5));
        // The one record the model names is already in the running order, so it keeps none of it.
        const already = new Set([songKey('model-title-0', ['model-artist-0'])]);

        await chain([repeat, floor]).generate(inputs(3, { avoidSongKeys: already }));

        expect(recorded().mock.calls[0]![0]).toMatchObject({
            data: {
                named: [
                    { generator: 'model', kept: 0 },
                    { generator: 'catalog', kept: 3 },
                ],
            },
        });
    });
});
