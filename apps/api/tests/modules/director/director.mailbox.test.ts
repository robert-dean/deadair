// The mailbox exists to remove a whole class of bug rather than a bug: if only one command runs at
// a time, there is no middle for a second caller to land in. So what is tested here is mostly the
// absence of overlap, plus the two things a naive serial queue gets wrong — a handler that posts
// (which must queue rather than recurse) and a handler that throws (which must not take the
// commands behind it down with it).

import { describe, expect, it, vi } from 'vitest';

import { DirectorMailbox, type DirectorCommand, type DirectorCommandResult } from '../../../src/modules/director/director.mailbox.js';

const WAKE: DirectorCommand = { kind: 'wake' };
const STAND_DOWN: DirectorCommand = { kind: 'standDown' };

/** A handler that records overlap rather than merely order, which is the property that matters. */
const overlapping = () => {
    let inFlight = 0;
    let overlapped = false;
    const handle = async (_command: DirectorCommand): Promise<DirectorCommandResult> => {
        inFlight += 1;
        if (inFlight > 1) overlapped = true;
        await new Promise(resolve => setImmediate(resolve));
        inFlight -= 1;
        return undefined;
    };
    return { handle, didOverlap: () => overlapped };
};

describe('DirectorMailbox', () => {
    it('runs one command at a time even when they all arrive at once', async () => {
        const { handle, didOverlap } = overlapping();
        const mailbox = new DirectorMailbox(handle);

        await Promise.all([mailbox.post(WAKE), mailbox.post(WAKE), mailbox.post(WAKE)]);

        expect(didOverlap()).toBe(false);
    });

    it('handles them in the order they were posted', async () => {
        const seen: string[] = [];
        const mailbox = new DirectorMailbox(async command => {
            await new Promise(resolve => setImmediate(resolve));
            seen.push(command.kind);
        });

        await Promise.all([mailbox.post(WAKE), mailbox.post(STAND_DOWN), mailbox.post(WAKE)]);

        expect(seen).toEqual(['wake', 'standDown', 'wake']);
    });

    it('settles a post only once that command has been handled', async () => {
        // What lets a request answer with the state its own change produced, rather than with a
        // promise that it will happen shortly.
        let handled = false;
        const mailbox = new DirectorMailbox(async () => {
            await new Promise(resolve => setImmediate(resolve));
            handled = true;
        });

        await mailbox.post(WAKE);

        expect(handled).toBe(true);
    });

    it('queues a command posted by a handler rather than re-entering', async () => {
        // "The director committed, which emitted a change, which woke the director" is the shape
        // this has to be a queue entry for. Re-entering would put a second pass inside the first.
        const { handle, didOverlap } = overlapping();
        let posted = false;
        const mailbox: DirectorMailbox = new DirectorMailbox(async command => {
            if (!posted) {
                posted = true;
                void mailbox.post(STAND_DOWN);
            }
            await handle(command);
        });

        await mailbox.post(WAKE);
        // The nested one is drained by the same loop, so it is done by the time the queue empties.
        await new Promise(resolve => setImmediate(resolve));

        expect(didOverlap()).toBe(false);
        expect(mailbox.depth()).toBe(0);
    });

    it('rejects the caller whose command threw, and nobody else', async () => {
        const mailbox = new DirectorMailbox(async command => {
            if (command.kind === 'standDown') throw new Error('the database is gone');
        });

        const failing = mailbox.post(STAND_DOWN);
        const following = mailbox.post(WAKE);

        await expect(failing).rejects.toThrow('the database is gone');
        await expect(following).resolves.toBeUndefined();
    });

    it('keeps taking commands after one throws', async () => {
        // A station that stopped taking decisions because one of them failed would be a worse
        // failure than the one that started it.
        const handle = vi.fn(async () => {
            throw new Error('nope');
        });
        const mailbox = new DirectorMailbox(handle);

        await expect(mailbox.post(WAKE)).rejects.toThrow();
        await expect(mailbox.post(WAKE)).rejects.toThrow();

        expect(handle).toHaveBeenCalledTimes(2);
    });
});
