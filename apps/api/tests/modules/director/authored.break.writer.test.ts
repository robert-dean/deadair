// The kinds an operator writes (Ideas #24), aired by the model. What is here is what makes them
// different from the station's own: a shape built from a row, the station's rules still in force
// whatever the brief says, and a claim that goes quiet when there is no model to write one. The
// ways of NOT producing words are `ModelTalkBreakWriter`'s and are tested there, since the skeleton
// is shared.

import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { LlmMessage } from '@deadair/plugin-sdk';
import type { LlmService } from '../../../src/modules/llm/llm.service.js';
import { AuthoredBreakWriter, AuthoredKinds, authoredShape } from '../../../src/modules/director/authored.break.writer.js';
import type { BreakKindCatalog } from '../../../src/modules/director/break.kind.catalog.js';
import type { AuthoredKind } from '../../../src/modules/director/break.kind.js';
import { BreakWriter, type BreakWriteRequest, type WrittenBreak } from '../../../src/modules/director/break.writer.js';
import { BreakWriterRegistry } from '../../../src/modules/director/break.writer.registry.js';
import { MODEL_WRITER, MODEL_WRITER_KEYS } from '../../../src/modules/director/model.talk.break.writer.js';

const previous = { title: 'Solid Air', artist: 'John Martyn' };
const next = { title: 'Pink Moon', artist: 'Nick Drake' };

const poem = (overrides: Partial<AuthoredKind> = {}): AuthoredKind => ({
    id: 'kind-1',
    key: 'poem',
    name: 'A poem about the moment',
    brief: 'Two unrhymed lines about this moment on the station, and nothing else.',
    rules: [],
    showsPrevious: true,
    showsPlayed: false,
    showsFacts: true,
    showsNotebook: true,
    enabled: true,
    position: 0,
    ...overrides,
});

function build(options: { values?: Record<string, unknown>; answer?: string; canGenerate?: boolean; kinds?: AuthoredKind[] } = {}) {
    const values: Record<string, unknown> = { [MODEL_WRITER_KEYS.enabled]: 'true', ...options.values };

    const converse = vi.fn(async (_asked: { messages: LlmMessage[] }, _options?: unknown) => ({
        text: options.answer ?? 'The light goes amber on the desk. Somebody, somewhere, turns this up.',
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

    const held = new Map((options.kinds ?? [poem()]).map(kind => [kind.key, kind]));
    const catalog = { keys: () => [...held.keys()], kind: (key: string) => held.get(key) } as unknown as BreakKindCatalog;

    return { llm, config, logger, converse, held, values, claimant: new AuthoredKinds(catalog, llm, config, logger) };
}

const sent = (converse: ReturnType<typeof build>['converse']): LlmMessage[] => converse.mock.calls[0]?.[0].messages ?? [];
const turn = (messages: LlmMessage[], role: 'system' | 'user'): string => String(messages.find(message => message.role === role)?.content ?? '');

function writerFor(kind: AuthoredKind, options: Parameters<typeof build>[0] = {}) {
    const built = build({ ...options, kinds: [kind] });
    return { ...built, writer: new AuthoredBreakWriter(kind, built.llm, built.config, built.logger) };
}

describe('authoredShape', () => {
    it('frames the brief as one spoken break and carries the four switches across', () => {
        const shape = authoredShape(poem({ showsPrevious: false, showsPlayed: true, showsFacts: false, showsNotebook: false }));

        expect(shape.job).toContain('You write one short spoken break on this station');
        expect(shape.job).toContain('Two unrhymed lines about this moment');
        expect(shape).toMatchObject({ showsPrevious: false, showsPlayed: true, showsFacts: false, showsNotebook: false });
    });

    it('turns on nothing a row has no field for', () => {
        // A row that could turn these on would be a row that could turn a check off.
        const shape = authoredShape(poem({ rules: ['Two lines at most.'] }));

        expect(shape.rules).toEqual(['Two lines at most.']);
        expect(shape.mustNameRecord).toBeUndefined();
        expect(shape.allowsLatitude).toBeUndefined();
        expect(shape.allowsCues).toBeUndefined();
        expect(shape.stories).toBeUndefined();
        expect(shape.weather).toBeUndefined();
        expect(shape.almanac).toBeUndefined();
    });
});

describe('AuthoredBreakWriter', () => {
    it('writes the kind it was built for, as the model binding', () => {
        const { writer } = writerFor(poem());

        expect(writer.kind).toBe('poem');
        expect(writer.name).toBe(MODEL_WRITER);
    });

    it('writes a break labelled with the operator name for it', async () => {
        const { writer } = writerFor(poem());

        const written = await writer.write({ kind: 'poem', station: 'Deadair', previous, next });

        expect(written?.script).toContain('The light goes amber on the desk');
        expect(written?.label).toBe('A poem about the moment');
        expect(written).toMatchObject({ claimsNext: true, claimsPrevious: true });
    });

    it('keeps the station rules in the prompt, and puts the kind own rules after them', async () => {
        const { writer, converse } = writerFor(poem({ rules: ['Two lines at most, and never rhyme.'] }));

        await writer.write({ kind: 'poem', station: 'Deadair', previous, next });

        const system = turn(sent(converse), 'system');
        const shared = system.indexOf('Only ever refer to the records listed below');
        const own = system.indexOf('Two lines at most, and never rhyme.');
        expect(shared).toBeGreaterThan(-1);
        expect(own).toBeGreaterThan(shared);
    });

    it('shows no record that just finished when the row says not to, and claims none', async () => {
        const { writer, converse } = writerFor(poem({ showsPrevious: false }));

        const written = await writer.write({ kind: 'poem', station: 'Deadair', previous, next });

        expect(turn(sent(converse), 'user')).not.toContain('Solid Air');
        expect(written?.claimsPrevious).toBe(false);
    });

    it('refuses a year the station never showed, whatever the brief asked for', async () => {
        // A brief inviting a memory is the case the talk break's year rule was written for.
        const { writer } = writerFor(poem({ brief: 'Remember the first time you heard a record like this one.' }), {
            answer: 'I first heard this in 1971, in a car park, and I have never been the same.',
        });

        expect(await writer.write({ kind: 'poem', station: 'Deadair', previous, next })).toBeUndefined();
    });

    it('asks nothing of a model that is switched off, read as the string the setting holds', async () => {
        const { writer, converse } = writerFor(poem(), { values: { [MODEL_WRITER_KEYS.enabled]: 'false' } });

        expect(await writer.write({ kind: 'poem', station: 'Deadair', previous, next })).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });
});

describe('AuthoredKinds', () => {
    it('claims every switched-on kind while there is a model to write one', () => {
        const { claimant } = build({ kinds: [poem(), poem({ key: 'taping', name: 'Taping off the radio' })] });

        expect(claimant.kindsNow()).toEqual(['poem', 'taping']);
    });

    it('claims nothing while the model writer is off, read as the string the setting holds', () => {
        const { claimant } = build({ values: { [MODEL_WRITER_KEYS.enabled]: 'false' } });

        expect(claimant.kindsNow()).toEqual([]);
    });

    it('claims nothing while nothing can generate words', () => {
        const { claimant } = build({ canGenerate: false });

        expect(claimant.kindsNow()).toEqual([]);
    });

    it('hands back a writer that declines for a kind switched off underneath the question', async () => {
        const { claimant, held } = build();
        held.delete('poem');

        const writer = claimant.writerFor('poem');

        expect(writer.kind).toBe('poem');
        expect(await writer.write({ kind: 'poem' })).toBeUndefined();
    });

    it('makes the registry able to write an authored kind, and unable once the model goes', async () => {
        class Talk extends BreakWriter {
            readonly kind = 'talkbreak';
            readonly name = 'stub';
            async write(_: BreakWriteRequest): Promise<WrittenBreak | undefined> {
                return { script: 'talking', label: 'a break' };
            }
        }
        const { claimant, logger, values } = build();
        const registry = new BreakWriterRegistry([new Talk()], logger, [claimant]);

        expect(registry.canWrite('poem')).toBe(true);
        expect((await registry.write({ kind: 'poem', station: 'Deadair', previous, next })).written?.label).toBe('A poem about the moment');

        values[MODEL_WRITER_KEYS.enabled] = 'false';
        expect(registry.canWrite('poem')).toBe(false);
        expect(registry.canWrite('talkbreak')).toBe(true);
    });
});
