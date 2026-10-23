import { afterEach, describe, expect, it, vi } from 'vitest';

import { MessageInbox } from '../src/message.inbox.js';

afterEach(() => {
    vi.useRealTimers();
});

describe('MessageInbox', () => {
    it('hands over everything held, in order, and empties itself', async () => {
        const inbox = new MessageInbox<string>(10);
        inbox.deliver('a');
        inbox.deliver('b');

        expect(await inbox.take(0)).toEqual(['a', 'b']);
        expect(await inbox.take(0)).toEqual([]);
    });

    it('drops the oldest past the bound, and says so only the first time', () => {
        const inbox = new MessageInbox<number>(2);
        expect(inbox.deliver(1)).toBe(false);
        expect(inbox.deliver(2)).toBe(false);
        expect(inbox.deliver(3)).toBe(true);
        expect(inbox.deliver(4)).toBe(false);
    });

    it('waits for a message when it holds none, and answers the moment one arrives', async () => {
        vi.useFakeTimers();
        const inbox = new MessageInbox<string>(10);
        const taking = inbox.take(30_000);

        inbox.deliver('hello');

        expect(await taking).toEqual(['hello']);
    });

    it('gives up waiting when the wait runs out', async () => {
        vi.useFakeTimers();
        const inbox = new MessageInbox<string>(10);
        const taking = inbox.take(5_000);

        await vi.advanceTimersByTimeAsync(5_000);

        expect(await taking).toEqual([]);
    });

    it('wakes a waiting take on interrupt, and drops what it held on close', async () => {
        vi.useFakeTimers();
        const inbox = new MessageInbox<string>(10);
        const interrupted = inbox.take(30_000);
        inbox.interrupt();
        expect(await interrupted).toEqual([]);

        inbox.deliver('stale');
        inbox.close();
        expect(await inbox.take(0)).toEqual([]);
    });
});
