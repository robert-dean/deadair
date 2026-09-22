// The model marking a change of programme. The ways of NOT producing words are
// `ModelTalkBreakWriter`'s and are tested there, since the bounds are the same constants. What is here
// is what makes a changeover different: it is shown the two shows and never a record, it is told
// whether there is anybody to thank, and it claims nothing but a time of day it actually said.

import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { LlmMessage } from '@deadair/plugin-sdk';
import type { LlmService } from '../../../src/modules/llm/llm.service.js';
import { MODEL_WRITER, MODEL_WRITER_KEYS } from '../../../src/modules/director/model.talk.break.writer.js';
import { ModelChangeoverWriter } from '../../../src/modules/director/model.changeover.writer.js';
import { CHANGEOVER_KIND } from '../../../src/modules/director/changeover.writer.js';
import type { RoughTime } from '../../../src/modules/director/clock.words.js';
import type { Persona } from '../../../src/modules/personas/persona.js';

const previous = { title: 'Solid Air', artist: 'John Martyn' };
const next = { title: 'Pink Moon', artist: 'Nick Drake' };
const morning: RoughTime = { words: 'good morning', validFrom: 1_000, validUntil: 9_000 };
const dave = { id: 'p-dave', key: 'dave', kind: 'host', label: 'Dave', style: '', djName: 'Dave', defaultHost: false } as Persona;

function build(options: { values?: Record<string, unknown>; answer?: string; canGenerate?: boolean } = {}) {
    const values: Record<string, unknown> = { [MODEL_WRITER_KEYS.enabled]: 'true', ...options.values };

    const converse = vi.fn(async (_asked: { messages: LlmMessage[] }, _options?: unknown) => ({
        text: options.answer ?? 'Thanks, Dave. This is Afternoons on Deadair, and I will be with you until six.',
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

    return { writer: new ModelChangeoverWriter(llm, config, logger), converse };
}

/** The turns as the model was shown them. */
const sent = (converse: ReturnType<typeof build>['converse']): LlmMessage[] => converse.mock.calls[0]?.[0].messages ?? [];

const turn = (messages: LlmMessage[], role: 'system' | 'user'): string => String(messages.find(message => message.role === role)?.content ?? '');

describe('ModelChangeoverWriter', () => {
    it('writes what it is registered to write', () => {
        const { writer } = build();

        expect(writer.kind).toBe(CHANGEOVER_KIND);
        expect(writer.name).toBe(MODEL_WRITER);
    });

    it('tells the model both shows and who to thank', async () => {
        const { writer, converse } = build();

        await writer.write({
            kind: CHANGEOVER_KIND,
            station: 'Deadair',
            changeover: { outgoing: dave, outgoingShow: 'Breakfast', incomingShow: 'Afternoons' },
        });

        const said = turn(sent(converse), 'user');
        expect(turn(sent(converse), 'system')).toContain('one show on this station ends and the next begins');
        expect(said).toContain('"Breakfast" has just ended');
        expect(said).toContain('presented by Dave');
        expect(said).toContain('"Afternoons", and you are presenting it');
    });

    it('tells the model there is nobody to thank when the same host carries on', async () => {
        const { writer, converse } = build();

        await writer.write({ kind: CHANGEOVER_KIND, station: 'Deadair', changeover: { outgoingShow: 'Breakfast', incomingShow: 'Afternoons' } });

        expect(turn(sent(converse), 'user')).toContain('there is nobody to thank');
    });

    it('tells the model not to name a show when the station moves to its sustaining source', async () => {
        const { writer, converse } = build();

        await writer.write({ kind: CHANGEOVER_KIND, station: 'Deadair', changeover: { outgoingShow: 'Breakfast' } });

        expect(turn(sent(converse), 'user')).toContain('Do not name a show starting');
    });

    it('never shows the model a record, before or after', async () => {
        const { writer, converse } = build();

        await writer.write({ kind: CHANGEOVER_KIND, previous, next, station: 'Deadair', changeover: { incomingShow: 'Afternoons' } });

        const said = turn(sent(converse), 'user');
        for (const word of [previous.title, previous.artist, next.title, next.artist]) expect(said).not.toContain(word);
        // And is not told to say nothing but the station's name, which would forbid naming the shows.
        expect(said).not.toContain('identifies the station and nothing more');
    });

    it('claims the time of day only when the answer carries the greeting it was given', async () => {
        const greeted = await build({ answer: 'Good morning, this is Afternoons on Deadair.' }).writer.write({
            kind: CHANGEOVER_KIND,
            station: 'Deadair',
            greeting: morning,
            changeover: { incomingShow: 'Afternoons' },
        });
        expect(greeted?.claimsTime).toBeDefined();

        const plain = await build().writer.write({
            kind: CHANGEOVER_KIND,
            station: 'Deadair',
            greeting: morning,
            changeover: { incomingShow: 'Afternoons' },
        });
        expect(plain?.claimsTime).toBeUndefined();
        expect(plain?.claimsNext).toBeUndefined();
        expect(plain?.listenerLabel).toBe('Afternoons');
    });

    it('declines, and lets the floor write it, when the model writer is switched off', async () => {
        // The off-case as the STRING a settings row holds: a real boolean passes either way.
        const { writer, converse } = build({ values: { [MODEL_WRITER_KEYS.enabled]: 'false' } });

        expect(await writer.write({ kind: CHANGEOVER_KIND, station: 'Deadair', changeover: {} })).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines when there is no model to ask', async () => {
        const { writer, converse } = build({ canGenerate: false });

        expect(await writer.write({ kind: CHANGEOVER_KIND, station: 'Deadair', changeover: {} })).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });
});
