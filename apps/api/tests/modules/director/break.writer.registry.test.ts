// Everything here is about one rule: a break that cannot be written is a break the station does not
// say, never an exception that reaches the rotation clock. A segment which is not `ready` is skipped
// rather than waited for, so absorbing a failure here costs a break and never silence.
//
// The second rule, once a kind has more than one writer: the LAST one is the floor, and getting to
// it is ordinary rather than exceptional. A model that declines must cost a better sentence.

import { describe, expect, it, vi } from 'vitest';

import { PluginError } from '@deadair/plugin-sdk';

import { BreakWriter, type BreakWriteRequest, type WrittenBreak } from '../../../src/modules/director/break.writer.js';
import { BreakWriterRegistry, isWritten } from '../../../src/modules/director/break.writer.registry.js';

class StubWriter extends BreakWriter {
    constructor(
        readonly kind: string,
        readonly name: string,
        private readonly answer: () => Promise<WrittenBreak | undefined>,
    ) {
        super();
    }

    async write(_: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        return await this.answer();
    }
}

const words = (script: string) => async () => ({ script, label: 'a break' });
const nothing = async () => undefined;
const throws = (message: string) => async () => {
    throw new Error(message);
};
/** A writer that hit something it can describe: the gate, an upstream, a timeout. */
const fails = (message: string, code: 'timeout' | 'unavailable' | 'upstream') => async () => {
    throw new PluginError(message).withCode(code);
};

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

describe('BreakWriterRegistry', () => {
    it('routes a request to the writer for its kind', async () => {
        const log = logger();
        const registry = new BreakWriterRegistry(
            [new StubWriter('talkbreak', 'stub', words('talking')), new StubWriter('news', 'stub', words('the news'))],
            log as never,
        );

        const result = await registry.write({ kind: 'news' });

        expect(result.written).toEqual({ script: 'the news', label: 'a break' });
        expect(result.writer).toBe('stub');
        expect(registry.canWrite('talkbreak')).toBe(true);
        expect(registry.kinds()).toEqual(['talkbreak', 'news']);
    });

    it('answers with a reason when nothing writes that kind', async () => {
        const registry = new BreakWriterRegistry([], logger() as never);

        const result = await registry.write({ kind: 'talkbreak' });

        expect(isWritten(result)).toBe(false);
        expect(result.attempts).toEqual([]);
        expect(registry.canWrite('talkbreak')).toBe(false);
    });

    it('turns a writer that throws into a reason rather than an exception', async () => {
        const log = logger();
        const registry = new BreakWriterRegistry([new StubWriter('talkbreak', 'model', throws('the model went away'))], log as never);

        const result = await registry.write({ kind: 'talkbreak' });

        expect(isWritten(result)).toBe(false);
        expect(result.reason).toContain('the model went away');
        expect(log.warn).toHaveBeenCalled();
    });

    it('treats an empty script as nothing to say', async () => {
        // A writer answering with whitespace has failed in the one way the render job cannot use:
        // it would reach the engine as a request to speak nothing.
        const registry = new BreakWriterRegistry([new StubWriter('talkbreak', 'stub', words('   '))], logger() as never);

        expect(isWritten(await registry.write({ kind: 'talkbreak' }))).toBe(false);
    });

    it('treats a writer with nothing to say as a reason, not a fault', async () => {
        const registry = new BreakWriterRegistry([new StubWriter('talkbreak', 'stub', nothing)], logger() as never);

        expect(isWritten(await registry.write({ kind: 'talkbreak' }))).toBe(false);
    });

    describe('with several writers for one kind', () => {
        const stacked = (first: () => Promise<WrittenBreak | undefined>, log = logger()) =>
            new BreakWriterRegistry(
                [new StubWriter('talkbreak', 'model', first), new StubWriter('talkbreak', 'floor', words('the floor'))],
                log as never,
            );

        it('asks them in registration order and stops at the first with something to say', async () => {
            const registry = stacked(words('the model'));

            const result = await registry.write({ kind: 'talkbreak' });

            expect(result.written?.script).toBe('the model');
            expect(result.writer).toBe('model');
            // The floor was never asked. Preference order is registration order, and a model that
            // works must not cost a second generation to prove it.
            expect(result.attempts).toHaveLength(1);
            expect(registry.writersFor('talkbreak')).toEqual(['model', 'floor']);
        });

        it('falls through to the floor when the first declines', async () => {
            const result = await stacked(nothing).write({ kind: 'talkbreak' });

            expect(result.written?.script).toBe('the floor');
            expect(result.writer).toBe('floor');
        });

        it('falls through to the floor when the first throws', async () => {
            const log = logger();

            const result = await stacked(throws('out of budget'), log).write({ kind: 'talkbreak' });

            expect(result.written?.script).toBe('the floor');
            expect(result.writer).toBe('floor');
            expect(log.warn).toHaveBeenCalled();
        });

        it('falls through to the floor when the first produces whitespace', async () => {
            const result = await stacked(words('  \n ')).write({ kind: 'talkbreak' });

            expect(result.written?.script).toBe('the floor');
        });

        it('reports what every writer did, not only the one that won', async () => {
            // A model that declined and a floor that covered for it are two facts. The second on its
            // own reads as a station that never had a model configured, which is the wrong thing for
            // an operator to conclude.
            const result = await stacked(throws('out of budget')).write({ kind: 'talkbreak' });

            expect(result.attempts.map(attempt => attempt.writer)).toEqual(['model', 'floor']);
            expect(result.attempts[0]?.reason).toContain('out of budget');
            expect(result.attempts[0]?.written).toBeUndefined();
            expect(result.attempts[1]?.written?.script).toBe('the floor');
            expect(result.attempts.every(attempt => typeof attempt.durationMs === 'number')).toBe(true);
        });

        // This class knows WHICH writer declined and nothing about why. A model that refused its own
        // answer for quoting the persona's sample lines back knows exactly why, and that reason is
        // what reaches `script_history.reason` — where it can be counted, rather than being found in
        // a rotating log.
        it('prefers a declining writer’s own reason to its generic one', async () => {
            class Explaining extends StubWriter {
                detailOfLastWrite() {
                    return { reason: 'the model quoted the persona back at itself' };
                }
            }
            const registry = new BreakWriterRegistry(
                [new Explaining('talkbreak', 'model', nothing), new StubWriter('talkbreak', 'floor', words('the floor'))],
                logger() as never,
            );

            const result = await registry.write({ kind: 'talkbreak' });

            expect(result.attempts[0]?.reason).toBe('the model quoted the persona back at itself');
            expect(result.written?.script).toBe('the floor');
        });

        // The same field on the other branch, and the only thing that can be on it there: something
        // the station DID to an answer it kept, which is a break cut back to its last whole sentence.
        // An edit that lives only in a log line is one nobody will ever count.
        it('keeps a winning writer’s own reason, for an answer it cut rather than refused', async () => {
            class Trimming extends StubWriter {
                detailOfLastWrite() {
                    return { reason: 'the model wrote 29 words past the word ceiling' };
                }
            }
            const registry = new BreakWriterRegistry([new Trimming('talkbreak', 'model', words('the cut break'))], logger() as never);

            const result = await registry.write({ kind: 'talkbreak' });

            expect(result.attempts[0]?.outcome).toBe('written');
            expect(result.attempts[0]?.reason).toBe('the model wrote 29 words past the word ceiling');
            expect(result.written?.script).toBe('the cut break');
        });

        it('still explains a decline from a writer that offered no reason of its own', async () => {
            const result = await stacked(nothing).write({ kind: 'talkbreak' });

            expect(result.attempts[0]?.reason).toContain('model');
        });

        it('names every writer in the reason when all of them decline', async () => {
            const registry = new BreakWriterRegistry(
                [new StubWriter('talkbreak', 'model', throws('out of budget')), new StubWriter('talkbreak', 'floor', nothing)],
                logger() as never,
            );

            const result = await registry.write({ kind: 'talkbreak' });

            expect(isWritten(result)).toBe(false);
            expect(result.reason).toContain('out of budget');
            expect(result.reason).toContain('floor');
        });

        it('keeps the first of two writers sharing one name, and says so', async () => {
            // Two writers for a kind is ordinary. Two with the same name is a registration mistake:
            // `segments.writer` could no longer tell them apart, so the row would say something
            // untrue about which one spoke.
            const log = logger();
            const registry = new BreakWriterRegistry(
                [new StubWriter('talkbreak', 'stub', words('first')), new StubWriter('talkbreak', 'stub', words('second'))],
                log as never,
            );

            const result = await registry.write({ kind: 'talkbreak' });

            expect(result.written?.script).toBe('first');
            expect(registry.writersFor('talkbreak')).toEqual(['stub']);
            expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('talkbreak'));
        });
    });
});

// A `failed` attempt is the station absorbing something, and the two things it absorbs are not alike:
// a writer that broke is a fault, and a writer that lost the model to a refill is a Tuesday. Both
// read identically as prose, which is why the code travels beside the sentence rather than instead
// of it — a persona audition uses it to tell a busy minute from a bad character sheet.
describe('BreakWriterRegistry: what kind of failure it was', () => {
    it('keeps the code off a described failure', async () => {
        const log = logger();
        const registry = new BreakWriterRegistry(
            [new StubWriter('talkbreak', 'model', fails('waited 30000ms for the model and it is still busy', 'timeout'))],
            log as never,
        );

        const result = await registry.write({ kind: 'talkbreak' });

        expect(result.attempts[0]?.outcome).toBe('failed');
        expect(result.attempts[0]?.code).toBe('timeout');
        // The sentence is still what a person reads, and still names the writer.
        expect(result.attempts[0]?.reason).toContain('the model writer failed');
    });

    it('tells the station taking the model back from the model breaking', async () => {
        const log = logger();
        const preempted = new BreakWriterRegistry(
            [new StubWriter('talkbreak', 'model', fails('the station needed the model, so this was stopped', 'unavailable'))],
            log as never,
        );
        const broken = new BreakWriterRegistry([new StubWriter('talkbreak', 'model', throws('undefined is not a function'))], log as never);

        expect((await preempted.write({ kind: 'talkbreak' })).attempts[0]?.code).toBe('unavailable');
        // A bare Error carries no code, so there is nothing to claim about it.
        expect((await broken.write({ kind: 'talkbreak' })).attempts[0]?.code).toBeUndefined();
    });

    it('claims nothing about a writer that declined', async () => {
        // Declining is a decision, not something the writer hit.
        const log = logger();
        const registry = new BreakWriterRegistry([new StubWriter('talkbreak', 'model', nothing)], log as never);

        const result = await registry.write({ kind: 'talkbreak' });

        expect(result.attempts[0]?.outcome).toBe('declined');
        expect(result.attempts[0]?.code).toBeUndefined();
    });

    it('still falls through to the floor, whatever the code said', async () => {
        const log = logger();
        const registry = new BreakWriterRegistry(
            [
                new StubWriter('talkbreak', 'model', fails('the station needed the model, so this was stopped', 'unavailable')),
                new StubWriter('talkbreak', 'deterministic', words('That was Green Onions.')),
            ],
            log as never,
        );

        const result = await registry.write({ kind: 'talkbreak' });

        // The floor cannot fail, and that is unchanged: on air a lost model slot still costs a
        // better sentence rather than silence. Only a caller that is MEASURING wants to know.
        expect(result.written?.script).toBe('That was Green Onions.');
        expect(result.writer).toBe('deterministic');
    });
});
