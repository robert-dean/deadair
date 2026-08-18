// The model binding for a bulletin. Everything here is about what it will not do: write news it was
// not given, ask a model at all when there is nothing to report, or air an answer that ran long.
// The prompt itself is asserted in `break.prompt.test.ts`, where it can be read without a model.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import { ModelNewsBreakWriter, NEWS_MAX_WORDS } from '../../../src/modules/director/model.news.break.writer.js';
import { MODEL_WRITER_KEYS } from '../../../src/modules/director/model.talk.break.writer.js';
import { NEWS_KIND } from '../../../src/modules/director/news.break.writer.js';
import type { LlmService } from '../../../src/modules/llm/llm.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const config = (values: Record<string, unknown> = {}): AppConfig =>
    ({ get: vi.fn((key: string, fallback: unknown) => values[key] ?? fallback) }) as unknown as AppConfig;

const enabled = { [MODEL_WRITER_KEYS.enabled]: true };

const request = (overrides: Partial<BreakWriteRequest> = {}): BreakWriteRequest => ({
    kind: NEWS_KIND,
    station: 'Deadair',
    stories: [{ headline: 'Bridge reopens after four years.', summary: 'It reopened this morning.' }],
    ...overrides,
});

function build(answer: string, values: Record<string, unknown> = enabled) {
    const converse = vi.fn(async () => ({ text: answer, finishReason: 'stop', usage: { outputTokens: 40 } }));
    const llm = { canGenerate: () => true, explainGenerator: () => 'ready', converse } as unknown as LlmService;

    return { writer: new ModelNewsBreakWriter(llm, config(values), logger), converse };
}

beforeEach(() => vi.clearAllMocks());

describe('when it will not even ask', () => {
    it('declines with no stories, rather than having a model invent a bulletin', async () => {
        const { writer, converse } = build('Here is the news.');

        expect(await writer.write(request({ stories: [] }))).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines when the operator has not turned the model writer on', async () => {
        const { writer, converse } = build('Here is the news.', {});

        expect(await writer.write(request())).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines when the setting holds the STRING a settings row stores', async () => {
        // Not the same case as the one above. Absent falls to the default; SET TO OFF is what was
        // broken, because `deadair.settings` hands back `'false'` and that is truthy.
        const { writer, converse } = build('Here is the news.', { [MODEL_WRITER_KEYS.enabled]: 'false' });

        expect(await writer.write(request())).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines when nothing can generate, and does not treat that as a fault', async () => {
        const llm = { canGenerate: () => false, explainGenerator: () => 'no plugin', converse: vi.fn() } as unknown as LlmService;
        const writer = new ModelNewsBreakWriter(llm, config(enabled), logger);

        expect(await writer.write(request())).toBeUndefined();
    });
});

describe('what it will air', () => {
    it('reads back a bulletin the model wrote', async () => {
        const { writer } = build('Here is the news. A bridge has reopened after four years. Now, back to the music.');

        expect(await writer.write(request())).toMatchObject({
            label: 'News',
            script: expect.stringContaining('bridge has reopened'),
        });
    });

    it('gives itself room for a bulletin rather than a talk break', async () => {
        const { writer, converse } = build(`${'word '.repeat(NEWS_MAX_WORDS - 1)}end.`);

        expect(await writer.write(request())).toBeDefined();
        expect(converse).toHaveBeenCalledTimes(1);
    });

    it('declines an answer that ran past the ceiling rather than cutting a bulletin in half', async () => {
        const { writer } = build('word '.repeat(NEWS_MAX_WORDS + 10));

        expect(await writer.write(request())).toBeUndefined();
    });

    it('asks for no tools, because a bulletin may only contain what the station fetched', async () => {
        const { writer, converse } = build('Here is the news. A bridge reopened.');

        await writer.write(request());

        expect(converse).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tools: false }));
    });

    it('claims the record coming up when it was told what it is', async () => {
        const { writer } = build('Here is the news. A bridge reopened. Now, Nick Drake.');

        expect(await writer.write(request({ next: { title: 'Pink Moon', artist: 'Nick Drake' } }))).toMatchObject({ claimsNext: true });
    });

    it('stamps the clock only when the answer really carries the words it was given', async () => {
        const clock = { words: 'just after nine', validFrom: 1_000, validUntil: 2_000 };

        const said = build('It is just after nine. A bridge reopened.');
        expect(await said.writer.write(request({ clock }))).toMatchObject({ claimsTime: { from: 1_000, until: 2_000 } });

        const paraphrased = build('It is nearly ten past nine. A bridge reopened.');
        expect((await paraphrased.writer.write(request({ clock })))?.claimsTime).toBeUndefined();
    });
});
