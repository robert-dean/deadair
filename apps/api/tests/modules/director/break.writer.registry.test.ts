// Everything here is about one rule: a break that cannot be written is a break the station does not
// say, never an exception that reaches the rotation clock. A segment which is not `ready` is skipped
// rather than waited for, so absorbing a failure here costs a break and never silence.

import { describe, expect, it, vi } from 'vitest';

import { BreakWriter, type BreakWriteRequest, type WrittenBreak } from '../../../src/modules/director/break.writer.js';
import { BreakWriterRegistry, isWritten } from '../../../src/modules/director/break.writer.registry.js';

class StubWriter extends BreakWriter {
    constructor(
        readonly kind: string,
        private readonly answer: () => Promise<WrittenBreak | undefined>,
    ) {
        super();
    }

    async write(_: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        return await this.answer();
    }
}

const words = (script: string) => async () => ({ script, label: 'a break' });
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

describe('BreakWriterRegistry', () => {
    it('routes a request to the writer for its kind', async () => {
        const log = logger();
        const registry = new BreakWriterRegistry(
            [new StubWriter('talkbreak', words('talking')), new StubWriter('news', words('the news'))],
            log as never,
        );

        await expect(registry.write({ kind: 'news' })).resolves.toEqual({ script: 'the news', label: 'a break' });
        expect(registry.canWrite('talkbreak')).toBe(true);
        expect(registry.kinds()).toEqual(['talkbreak', 'news']);
    });

    it('answers with a reason when nothing writes that kind', async () => {
        const registry = new BreakWriterRegistry([], logger() as never);

        const result = await registry.write({ kind: 'talkbreak' });

        expect(isWritten(result)).toBe(false);
        expect(registry.canWrite('talkbreak')).toBe(false);
    });

    it('turns a writer that throws into a reason rather than an exception', async () => {
        const log = logger();
        const registry = new BreakWriterRegistry(
            [
                new StubWriter('talkbreak', async () => {
                    throw new Error('the model went away');
                }),
            ],
            log as never,
        );

        const result = await registry.write({ kind: 'talkbreak' });

        expect(isWritten(result)).toBe(false);
        expect(result).toEqual({ reason: expect.stringContaining('the model went away') });
        expect(log.warn).toHaveBeenCalled();
    });

    it('treats an empty script as nothing to say', async () => {
        // A writer answering with whitespace has failed in the one way the render job cannot use:
        // it would reach the engine as a request to speak nothing.
        const registry = new BreakWriterRegistry([new StubWriter('talkbreak', words('   '))], logger() as never);

        expect(isWritten(await registry.write({ kind: 'talkbreak' }))).toBe(false);
    });

    it('treats a writer with nothing to say as a reason, not a fault', async () => {
        const registry = new BreakWriterRegistry([new StubWriter('talkbreak', async () => undefined)], logger() as never);

        expect(isWritten(await registry.write({ kind: 'talkbreak' }))).toBe(false);
    });

    it('keeps the first of two writers claiming one kind, and says so', async () => {
        const log = logger();
        const registry = new BreakWriterRegistry([new StubWriter('talkbreak', words('first')), new StubWriter('talkbreak', words('second'))], log as never);

        await expect(registry.write({ kind: 'talkbreak' })).resolves.toEqual({ script: 'first', label: 'a break' });
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('talkbreak'));
    });
});
