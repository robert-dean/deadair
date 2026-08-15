// The model greeting a new listener. The ways of NOT producing words are `ModelTalkBreakWriter`'s
// and are tested there — the bounds are literally the same constants — so what is here is what makes
// a greeting different: what the model is shown, what it is asked to say, and what it is allowed to
// claim afterwards.

import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { LlmMessage } from '@deadair/plugin-sdk';
import type { LlmService } from '../../../src/modules/llm/llm.service.js';
import { MODEL_WRITER, MODEL_WRITER_KEYS } from '../../../src/modules/director/model.talk.break.writer.js';
import { ModelWelcomeWriter } from '../../../src/modules/director/model.welcome.writer.js';
import { WELCOME_KIND } from '../../../src/modules/director/welcome.writer.js';
import type { RoughTime } from '../../../src/modules/director/clock.words.js';

const previous = { title: 'Solid Air', artist: 'John Martyn' };
const next = { title: 'Pink Moon', artist: 'Nick Drake' };
const morning: RoughTime = { words: 'good morning', validFrom: 1_000, validUntil: 9_000 };

function build(options: { values?: Record<string, unknown>; answer?: string; canGenerate?: boolean } = {}) {
    const values: Record<string, unknown> = { [MODEL_WRITER_KEYS.enabled]: true, ...options.values };

    // The request is named rather than ignored: half the cases below read back what the model was
    // actually shown, which is the whole of what makes a greeting different from a talk break.
    const converse = vi.fn(async (_asked: { messages: LlmMessage[] }, _options?: unknown) => ({
        text: options.answer ?? "Good morning, you're listening to Deadair. Coming up, Pink Moon.",
        toolCalls: [],
        finishReason: 'stop' as const,
    }));

    const llm = {
        canGenerate: () => options.canGenerate ?? true,
        explainGenerator: () => 'no active plugin can produce words',
        converse,
    } as unknown as LlmService;

    const config = { get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) } as unknown as AppConfig;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

    return { writer: new ModelWelcomeWriter(llm, config, logger), converse };
}

/** The turns as the model was shown them. */
const sent = (converse: ReturnType<typeof build>['converse']): LlmMessage[] => converse.mock.calls[0]?.[0].messages ?? [];

const turn = (messages: LlmMessage[], role: 'system' | 'user'): string => String(messages.find(message => message.role === role)?.content ?? '');

describe('ModelWelcomeWriter', () => {
    it('writes what it is registered to write', () => {
        const { writer } = build();

        expect(writer.kind).toBe(WELCOME_KIND);
        expect(writer.name).toBe(MODEL_WRITER);
    });

    it('tells the model somebody has just tuned in', async () => {
        const { writer, converse } = build();

        await writer.write({ kind: WELCOME_KIND, next, station: 'Deadair', greeting: morning });

        expect(turn(sent(converse), 'system')).toContain('welcome somebody who has just started listening');
        expect(turn(sent(converse), 'user')).toContain('just tuned in');
    });

    it('never shows the model the record the listener missed', async () => {
        // Withheld rather than forbidden: a model shown a record will find a way to cue it, and
        // cueing the one before this to somebody who arrived thirty seconds ago is announcing
        // something they never heard.
        const { writer, converse } = build();

        await writer.write({ kind: WELCOME_KIND, previous, next, station: 'Deadair' });

        const said = turn(sent(converse), 'user');
        expect(said).not.toContain(previous.title);
        expect(said).toContain(next.title);
    });

    it('hands over the greeting words verbatim rather than the hour', async () => {
        // An invented phrasing has no expiry the station can check, which is the same reason the
        // clock is handed over as words.
        const { writer, converse } = build();

        await writer.write({ kind: WELCOME_KIND, next, station: 'Deadair', greeting: morning });

        expect(turn(sent(converse), 'user')).toContain('"good morning"');
    });

    it('claims the greeting window only when the answer really carries it', async () => {
        const kept = build();
        const withGreeting = await kept.writer.write({ kind: WELCOME_KIND, next, station: 'Deadair', greeting: morning });
        expect(withGreeting?.claimsTime).toEqual({ from: morning.validFrom, until: morning.validUntil });

        // A model that ignored the instruction, or paraphrased it into something with a different
        // lifetime, has made no claim this station can honour.
        const ignored = build({ answer: "You're listening to Deadair. Coming up, Pink Moon." });
        const without = await ignored.writer.write({ kind: WELCOME_KIND, next, station: 'Deadair', greeting: morning });
        expect(without?.claimsTime).toBeUndefined();
    });

    it('declines quietly with the model turned off, so the floor greets instead', async () => {
        const { writer, converse } = build({ values: { [MODEL_WRITER_KEYS.enabled]: false } });

        expect(await writer.write({ kind: WELCOME_KIND, next, station: 'Deadair' })).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines when there is no model to greet with', async () => {
        const { writer, converse } = build({ canGenerate: false });

        expect(await writer.write({ kind: WELCOME_KIND, next, station: 'Deadair' })).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines a ramble rather than airing it half-said', async () => {
        const { writer } = build({ answer: 'and '.repeat(200) });

        expect(await writer.write({ kind: WELCOME_KIND, next, station: 'Deadair' })).toBeUndefined();
    });
});
