// The model binding for a story break. What it adds over the floor is the TELLING, so the assertions
// here are about the two edges of that: it must not be asked at all when there is no story to tell,
// and what it says is bounded by the station's own setting rather than by a constant.
//
// The prompt itself is asserted in `break.prompt.test.ts`, where it can be read without a model.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { LlmMessage } from '@deadair/plugin-sdk';
import type { Logger } from '@maroonedsoftware/logger';

import { BREAK_WORD_KEYS } from '../../../src/modules/director/break.words.js';
import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import { MODEL_WRITER, MODEL_WRITER_KEYS } from '../../../src/modules/director/model.talk.break.writer.js';
import { ModelStoryBreakWriter } from '../../../src/modules/director/model.story.break.writer.js';
import { STORY_KIND } from '../../../src/modules/director/story.break.writer.js';
import type { LlmService } from '../../../src/modules/llm/llm.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const config = (values: Record<string, unknown> = {}): AppConfig =>
    ({ get: vi.fn((key: string, fallback: unknown) => values[key] ?? fallback) }) as unknown as AppConfig;

const enabled = { [MODEL_WRITER_KEYS.enabled]: true };

const story = {
    title: 'The Barstow lights',
    story: 'You saw three lights over the desert outside Barstow in ninety-seven.',
    details: [] as string[],
    timesTold: 0,
};

const request = (overrides: Partial<BreakWriteRequest> = {}): BreakWriteRequest => ({ kind: STORY_KIND, station: 'Deadair', story, ...overrides });

function build(answer: string, values: Record<string, unknown> = enabled) {
    const converse = vi.fn(async (_asked: { messages: LlmMessage[] }, _options?: unknown) => ({
        text: answer,
        finishReason: 'stop',
        usage: { outputTokens: 60 },
    }));
    const llm = { canGenerate: () => true, explainGenerator: () => 'ready', converse } as unknown as LlmService;

    return { writer: new ModelStoryBreakWriter(llm, config(values), logger), converse };
}

/** The user turn as the model was shown it. */
const userTurn = (converse: ReturnType<typeof build>['converse']): string =>
    String((converse.mock.calls[0]?.[0].messages ?? []).find(message => message.role === 'user')?.content ?? '');

const systemTurn = (converse: ReturnType<typeof build>['converse']): string =>
    String((converse.mock.calls[0]?.[0].messages ?? []).find(message => message.role === 'system')?.content ?? '');

beforeEach(() => vi.clearAllMocks());

describe('ModelStoryBreakWriter', () => {
    it('is the model binding for a story break', () => {
        const { writer } = build('Anyway. Three lights, no sound.');

        expect(writer.kind).toBe(STORY_KIND);
        expect(writer.name).toBe(MODEL_WRITER);
    });

    // The branch that matters most, and it is a bulletin's argument transplanted: a model asked to
    // fill a story slot with nothing in the prompt writes the character a past nobody approved.
    it('never asks a model when there is no story to tell', async () => {
        const { writer, converse } = build('Let me tell you about the time I met Bowie.');

        expect(await writer.write(request({ story: undefined }))).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('shows the model the story it is meant to tell', async () => {
        const { writer, converse } = build('Three lights. No sound. Gone.');

        await writer.write(request());

        expect(userTurn(converse)).toContain(story.story);
    });

    it('writes what the model said, under the story’s own name', async () => {
        const { writer } = build('Three lights. No sound at all. Gone before the tape was running.');

        const written = await writer.write(request());

        expect(written?.script).toBe('Three lights. No sound at all. Gone before the tape was running.');
        expect(written?.label).toBe('The Barstow lights');
    });

    // The ceiling the operator set, in the prompt AND in the guard, from one read. A story asked for
    // at a hundred and twenty words and refused at forty would fall to the floor every time with
    // nothing saying why.
    it('asks for the station’s own story length', async () => {
        const { writer, converse } = build('Short enough.', { ...enabled, [BREAK_WORD_KEYS.story]: '60' });

        await writer.write(request());

        expect(systemTurn(converse)).toMatch(/under 60 words/i);
    });

    it('refuses an answer past that ceiling that cannot be cut at a sentence', async () => {
        const rambling = `${'word '.repeat(200)}`;
        const { writer } = build(rambling, { ...enabled, [BREAK_WORD_KEYS.story]: '40' });

        expect(await writer.write(request())).toBeUndefined();
    });

    it('says nothing when the model is switched off', async () => {
        const { writer, converse } = build('Three lights.', {});

        expect(await writer.write(request())).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });
});
