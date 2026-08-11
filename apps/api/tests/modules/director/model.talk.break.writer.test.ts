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
    MAX_WAIT_MS,
    MODEL_WRITER,
    MODEL_WRITER_KEYS,
    ModelTalkBreakWriter,
} from '../../../src/modules/director/model.talk.break.writer.js';
import { TALK_BREAK_KIND } from '../../../src/modules/director/talk.break.writer.js';

const previous = { title: 'Solid Air', artist: 'John Martyn' };
const next = { title: 'Pink Moon', artist: 'Nick Drake' };

interface Options {
    /** Settings, over a default that has the model turned ON so most cases are about the model. */
    values?: Record<string, unknown>;
    /** What the model answers, or a thrower. */
    answer?: string | (() => never);
    usage?: Record<string, number>;
    canGenerate?: boolean;
}

function build(options: Options = {}) {
    const values: Record<string, unknown> = { [MODEL_WRITER_KEYS.enabled]: true, ...options.values };

    const converse = vi.fn(async () => {
        if (typeof options.answer === 'function') options.answer();
        return {
            text: options.answer ?? 'That was Solid Air. Coming up, Pink Moon.',
            toolCalls: [],
            finishReason: 'stop' as const,
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

        it('when no plugin can produce words, which is every fresh install', async () => {
            const { writer, converse, logger } = build({ canGenerate: false });

            await expect(writer.write({ kind: TALK_BREAK_KIND, previous, next })).resolves.toBeUndefined();
            expect(converse).not.toHaveBeenCalled();
            // Debug, not warn: a station with no model would otherwise say so every fourth record.
            expect(logger.warn).not.toHaveBeenCalled();
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
            expect.objectContaining({ tools: false, budgetMs: BUDGET_MS, maxWaitMs: MAX_WAIT_MS }),
        );
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
