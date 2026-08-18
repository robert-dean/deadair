// The model binding, tested against a stub model. Everything that matters here is a way of NOT
// producing words: turned off, no plugin, a ramble, an empty answer, a thrown error. Each one has
// to end as this writer declining, because the registry then falls through to the station's own
// phrasings — and a slow model must cost a better sentence, never a silent station.

import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { LlmService } from '../../../src/modules/llm/llm.service.js';
import {
    BUDGET_MS,
    MAX_OUTPUT_TOKENS,
    MODEL_WRITER,
    MODEL_WRITER_KEYS,
    ModelTalkBreakWriter,
} from '../../../src/modules/director/model.talk.break.writer.js';
import { TALK_BREAK_KIND } from '../../../src/modules/director/talk.break.writer.js';
import { DEFAULT_MAX_WORDS } from '../../../src/modules/director/break.prompt.js';
import { patienceFor, WAIT } from '../../../src/modules/director/break.writer.js';

const previous = { title: 'Solid Air', artist: 'John Martyn' };
const next = { title: 'Pink Moon', artist: 'Nick Drake' };

interface Options {
    /** Settings, over a default that has the model turned ON so most cases are about the model. */
    values?: Record<string, unknown>;
    /** What the model answers, or a thrower. */
    answer?: string | (() => never);
    usage?: Record<string, number>;
    finishReason?: 'stop' | 'length';
    canGenerate?: boolean;
}

function build(options: Options = {}) {
    const values: Record<string, unknown> = { [MODEL_WRITER_KEYS.enabled]: true, ...options.values };

    const converse = vi.fn(async () => {
        if (typeof options.answer === 'function') options.answer();
        return {
            text: options.answer ?? 'That was Solid Air. Coming up, Pink Moon.',
            toolCalls: [],
            finishReason: options.finishReason ?? ('stop' as const),
            ...(options.usage === undefined ? {} : { usage: options.usage }),
        };
    });

    const llm = {
        canGenerate: () => options.canGenerate ?? true,
        explainGenerator: () => 'no active plugin can produce words',
        converse,
    } as unknown as LlmService;

    const config = { get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) } as unknown as AppConfig;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

    return { writer: new ModelTalkBreakWriter(llm, config, logger), converse, logger };
}

describe('ModelTalkBreakWriter', () => {
    it('is the model binding for a talk break', () => {
        const { writer } = build();

        expect(writer.kind).toBe(TALK_BREAK_KIND);
        expect(writer.name).toBe(MODEL_WRITER);
    });

    it('writes what the model said', async () => {
        const { writer } = build();

        const written = await writer.write({ kind: TALK_BREAK_KIND, previous, next });

        expect(written?.script).toBe('That was Solid Air. Coming up, Pink Moon.');
    });

    it('names the break itself rather than paying a model to', async () => {
        // A label is for the console and the mount. No listener hears one.
        const { writer } = build();

        const written = await writer.write({ kind: TALK_BREAK_KIND, previous, next });

        expect(written?.label).toBe('Talk break: Solid Air into Pink Moon');
    });

    describe('declines without asking the model at all', () => {
        it('when the operator has not turned it on', async () => {
            const { writer, converse } = build({ values: { [MODEL_WRITER_KEYS.enabled]: false } });

            await expect(writer.write({ kind: TALK_BREAK_KIND, previous, next })).resolves.toBeUndefined();
            expect(converse).not.toHaveBeenCalled();
        });

        it('when the setting holds the STRING a settings row stores, which is what production reads', async () => {
            // The case above passes whether or not the coercion is there, because it hands over a
            // real boolean. `deadair.settings` stores text, and `'false'` is truthy — so this is the
            // reading that was actually broken: the writer ran on every break with the switch off.
            const { writer, converse } = build({ values: { [MODEL_WRITER_KEYS.enabled]: 'false' } });

            await expect(writer.write({ kind: TALK_BREAK_KIND, previous, next })).resolves.toBeUndefined();
            expect(converse).not.toHaveBeenCalled();
        });

        it('when no plugin can produce words, which is every fresh install', async () => {
            const { writer, converse, logger } = build({ canGenerate: false });

            await expect(writer.write({ kind: TALK_BREAK_KIND, previous, next })).resolves.toBeUndefined();
            expect(converse).not.toHaveBeenCalled();
            // Debug, not warn: a station with no model would otherwise say so every fourth record.
            expect(logger.warn).not.toHaveBeenCalled();
        });
    });

    // The one number that lives in two places: what the prompt asks for and what the guard refuses
    // at. This binding builds both from one `maxWordsFor` call over one settings object, and these
    // cases are what stops them drifting apart — a character asked for seventy words and judged at
    // forty has every break declined for doing as it was told, with the floor writing the lot.
    describe('a persona given room', () => {
        const shockJock = {
            id: 'p1',
            key: 'shockjock',
            label: 'The shock jock',
            style: 'a shock jock',
            latitude: 'loose' as const,
            active: true,
        };
        // Sixty words, naming a record, in nobody's particular dialect: past the station's ceiling
        // and inside the rung's, and nothing else in the guard has an opinion about it.
        const long = ['Solid', 'Air', ...Array.from({ length: 58 }, () => 'word')].join(' ');

        it('refuses it at the station’s ceiling for a character with no room', async () => {
            const { writer } = build({ answer: long });

            await expect(writer.write({ kind: TALK_BREAK_KIND, previous, next })).resolves.toBeUndefined();
        });

        it('keeps it for a character that was given some', async () => {
            const { writer } = build({ answer: long });

            const written = await writer.write({ kind: TALK_BREAK_KIND, previous, next, persona: shockJock });

            expect(written?.script).toBe(long);
        });

        it('asked the model for that length rather than judging it against one it never heard', async () => {
            const { writer, converse } = build({ answer: long });

            await writer.write({ kind: TALK_BREAK_KIND, previous, next, persona: shockJock });

            expect(converse).toHaveBeenCalledWith(
                expect.objectContaining({
                    messages: expect.arrayContaining([
                        expect.objectContaining({
                            role: 'system',
                            content: expect.stringContaining('under 70 words'),
                        }),
                    ]),
                }),
                expect.anything(),
            );
        });
    });

    describe('declines rather than airing what came back', () => {
        it('when the model rambled past the ceiling', async () => {
            const { writer } = build({ answer: Array.from({ length: 80 }, () => 'word').join(' ') });

            await expect(writer.write({ kind: TALK_BREAK_KIND, previous, next })).resolves.toBeUndefined();
        });

        it('when the model said nothing at all', async () => {
            const { writer } = build({ answer: '   ' });

            await expect(writer.write({ kind: TALK_BREAK_KIND, previous, next })).resolves.toBeUndefined();
        });

        it('and says so plainly when a reasoning model spent the whole ceiling thinking', async () => {
            // Measured, not imagined: at 160 tokens gpt-oss at low effort returned `outputTokens:
            // 160` and an answer of "". Every break went to the floor, which from the row looks
            // exactly like a model nobody turned on. The two need different fixes — a number to
            // raise versus a prompt to tighten — so the log has to tell them apart.
            const { writer, logger } = build({ answer: '', finishReason: 'length', usage: { outputTokens: MAX_OUTPUT_TOKENS } });

            await expect(writer.write({ kind: TALK_BREAK_KIND, previous, next })).resolves.toBeUndefined();

            expect(vi.mocked(logger.info).mock.calls[0]?.[0]).toContain('thinking');
        });

        it('leaves a reasoning model room to think AND speak', async () => {
            // The bound this is really about. Forty words is about sixty tokens; the rest is
            // headroom for the thinking that happens first. A ceiling that only fits the answer is
            // a model that is on and permanently silent.
            expect(MAX_OUTPUT_TOKENS).toBeGreaterThan(DEFAULT_MAX_WORDS * 4);
        });
    });

    it('lets a thrown error out, for the registry to turn into a reason', async () => {
        // Deliberately NOT caught here. The registry flattens every way of failing into one
        // fall-through, so catching it here would be a second place that has to be right.
        const { writer } = build({
            answer: () => {
                throw new Error('the model went away');
            },
        });

        await expect(writer.write({ kind: TALK_BREAK_KIND, previous, next })).rejects.toThrow('the model went away');
    });

    it('asks with the bounds a break is worth and no tools', async () => {
        const { writer, converse } = build();

        await writer.write({ kind: TALK_BREAK_KIND, previous, next });

        expect(converse).toHaveBeenCalledWith(
            expect.objectContaining({ reasoningEffort: 'low', maxOutputTokens: expect.any(Number) }),
            // The wait is DERIVED from when the break is due rather than a constant — see
            // `patienceFor`. This one said nothing about when it airs, so it gets the default.
            expect.objectContaining({ tools: false, budgetMs: BUDGET_MS, maxWaitMs: WAIT.defaultMs }),
        );
    });

    // The whole point of deriving it. A break with its slot minutes away can afford to queue behind
    // a production beat; one whose lead is twenty seconds cannot, and would miss its moment rather
    // than merely be late.
    it('queues longer for a break with room and barely at all for one nearly due', async () => {
        const roomy = build();
        await roomy.writer.write({ kind: TALK_BREAK_KIND, previous, next, airsAt: Date.now() + 10 * 60_000 });

        const urgent = build();
        await urgent.writer.write({ kind: TALK_BREAK_KIND, previous, next, airsAt: Date.now() + 20_000 });

        // Asserted through `toHaveBeenCalledWith` rather than by indexing the calls, because the
        // stub takes no declared parameters and TypeScript types its call tuple as empty.
        expect(roomy.converse).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxWaitMs: WAIT.maxMs }));

        // An interrupt's whole lead is twenty seconds. Waiting ten of them for a model busy with a
        // twenty-five second beat leaves nothing to be written and spoken in.
        const urgentWait = patienceFor(Date.now() + 20_000);
        expect(urgentWait).toBeLessThan(10_000);
        expect(urgent.converse).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxWaitMs: expect.any(Number) }));
    });

    // The default is what every break on air relies on: `LlmGate` reads an absent priority as
    // `station`, so a writer that invented one would be claiming a rank nobody gave it.
    it('claims no priority for a break that is going on air, and passes one that was given', async () => {
        const air = build();
        await air.writer.write({ kind: TALK_BREAK_KIND, previous, next });
        expect(air.converse).toHaveBeenCalledWith(expect.anything(), expect.not.objectContaining({ priority: expect.anything() }));

        const rehearsal = build();
        await rehearsal.writer.write({ kind: TALK_BREAK_KIND, previous, next, priority: 'preview' });
        expect(rehearsal.converse).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ priority: 'preview' }));
    });

    it('sends the model an operator asked for, and the plugin default otherwise', async () => {
        const named = build({ values: { [MODEL_WRITER_KEYS.model]: 'gpt-oss-radio' } });
        await named.writer.write({ kind: TALK_BREAK_KIND, previous });
        expect(named.converse).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-oss-radio' }), expect.anything());

        const unnamed = build();
        await unnamed.writer.write({ kind: TALK_BREAK_KIND, previous });
        expect(unnamed.converse).toHaveBeenCalledWith(expect.not.objectContaining({ model: expect.anything() }), expect.anything());
    });

    describe('the forward claim', () => {
        it('claims the next record when it was given one', async () => {
            // Told what plays next means allowed to name it, so assume it did: over-stamping costs a
            // break the order drifted under, and under-stamping airs a promise nobody checked.
            const { writer } = build();

            const written = await writer.write({ kind: TALK_BREAK_KIND, previous, next });

            expect(written?.claimsNext).toBe(true);
        });

        it('claims nothing when it was given nothing to claim', async () => {
            const { writer } = build();

            const written = await writer.write({ kind: TALK_BREAK_KIND, previous });

            expect(written?.claimsNext).toBe(false);
        });
    });

    describe('what it leaves for the record', () => {
        it('keeps the model and what it cost', async () => {
            const { writer } = build({ values: { [MODEL_WRITER_KEYS.model]: 'gpt-oss-radio' }, usage: { outputTokens: 31 } });

            await writer.write({ kind: TALK_BREAK_KIND, previous, next });

            expect(writer.detailOfLastWrite()).toMatchObject({ model: 'gpt-oss-radio', usage: { outputTokens: 31 } });
        });

        it('keeps them even when the answer was unusable', async () => {
            // The case the numbers are most wanted for: a model that spent forty seconds producing
            // nothing looks, from the segment row alone, exactly like one that was never asked.
            const { writer } = build({ answer: '   ', usage: { outputTokens: 400 } });

            await writer.write({ kind: TALK_BREAK_KIND, previous, next });

            expect(writer.detailOfLastWrite()).toMatchObject({ usage: { outputTokens: 400 } });
        });

        it('keeps the prompt and the raw answer only when the operator asked', async () => {
            const off = build();
            await off.writer.write({ kind: TALK_BREAK_KIND, previous });
            expect(off.writer.detailOfLastWrite()?.prompt).toBeUndefined();
            expect(off.writer.detailOfLastWrite()?.raw).toBeUndefined();

            const on = build({ values: { 'llm.captureWrites': true }, answer: '"That was Solid Air."' });
            await on.writer.write({ kind: TALK_BREAK_KIND, previous });
            expect(on.writer.detailOfLastWrite()?.prompt).toBeDefined();
            // The RAW answer, before the station unwrapped it: what tuning a prompt needs to see.
            expect(on.writer.detailOfLastWrite()?.raw).toBe('"That was Solid Air."');
        });

        it('forgets the last write before starting the next one', async () => {
            const { writer } = build({ values: { [MODEL_WRITER_KEYS.enabled]: false } });

            await writer.write({ kind: TALK_BREAK_KIND, previous });

            expect(writer.detailOfLastWrite()).toBeUndefined();
        });
    });
});

// The clock reached the model writer later than the template one, and only because running the
// station showed the feature was inert: `llm.breakWriter` is on, the model wins the registry, and a
// top-of-the-hour break was coming out with no time in it and no claim on it.
describe('ModelTalkBreakWriter and the time', () => {
    const clock = { words: 'just after nine', validFrom: 1_000, validUntil: 500_000 };

    it('claims the window when the answer carries the words it was given', async () => {
        const { writer } = build({ answer: "It's just after nine, and that was Solid Air." });

        const written = await writer.write({ kind: TALK_BREAK_KIND, previous, next, clock });

        expect(written?.claimsTime).toEqual({ from: 1_000, until: 500_000 });
    });

    it('claims nothing when the model said the time its own way', async () => {
        // The opposite posture to `claimsNext`, which assumes. An invented phrasing has a lifetime
        // this station cannot know, so there is no window it can honestly promise.
        const { writer } = build({ answer: "It's a couple of minutes past nine, and that was Solid Air." });

        const written = await writer.write({ kind: TALK_BREAK_KIND, previous, next, clock });

        expect(written?.script).toContain('past nine');
        expect(written?.claimsTime).toBeUndefined();
    });

    it('claims the window even when the model capitalised the phrase', async () => {
        // Found on air, not in a test. Every timed break the model wrote went out unguarded because
        // it began a sentence with "Coming up to three" and the check was case-sensitive.
        const { writer } = build({ answer: 'Coming up to three, and here is Pink Moon.' });

        const written = await writer.write({
            kind: TALK_BREAK_KIND,
            previous,
            next,
            clock: { words: 'coming up to three', validFrom: 1_000, validUntil: 500_000 },
        });

        expect(written?.claimsTime).toEqual({ from: 1_000, until: 500_000 });
    });

    it('claims nothing for a break that was never given a time', async () => {
        const { writer } = build({ answer: 'That was Solid Air, and here comes another.' });

        const written = await writer.write({ kind: TALK_BREAK_KIND, previous, next });

        expect(written?.claimsTime).toBeUndefined();
    });
});
