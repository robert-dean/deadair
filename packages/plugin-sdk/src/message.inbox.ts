/**
 * Messages held for a `receive` that has not come yet, and a way for that `receive` to wait for one.
 *
 * A chat plugin holding a socket is told about messages when they arrive, and the station asks for them
 * when it polls. This is the queue between the two, bounded so a station that is not listening (a
 * quarantined plugin, or one mid-reinit) cannot be handed a backlog that is stale by the time it is
 * read: past the bound the oldest go. Discord and Slack each wrote this into their plugin class.
 *
 * Generic rather than tied to `InboundMessage`, because nothing here reads what is held.
 */
export class MessageInbox<T> {
    private readonly held: T[] = [];
    private wake?: () => void;
    private overflowed = false;

    /** @param max - How many messages are held at once. */
    constructor(private readonly max: number) {}

    /**
     * Queue one message, dropping the oldest past the bound, and wake a `take` that is waiting.
     *
     * Answers `true` the FIRST time a message is dropped and never again, so the caller can say so
     * once in its log rather than once per message in a flood.
     */
    deliver(message: T): boolean {
        this.held.push(message);
        let firstDrop = false;
        if (this.held.length > this.max) {
            this.held.shift();
            firstDrop = !this.overflowed;
            this.overflowed = true;
        }
        this.wake?.();
        return firstDrop;
    }

    /**
     * Everything held, emptying the inbox. When nothing is held it first waits up to `waitMs` for a
     * message, an {@link interrupt} or a {@link close}, whichever comes first.
     */
    async take(waitMs: number): Promise<T[]> {
        if (this.held.length === 0 && waitMs > 0) await this.waitForMessages(waitMs);
        return this.held.splice(0);
    }

    /** Wake a waiting `take` without delivering anything, for a socket that has stopped for good. */
    interrupt(): void {
        this.wake?.();
    }

    /** Wake a waiting `take` and drop everything held, for a plugin being disposed. */
    close(): void {
        this.wake?.();
        this.held.length = 0;
    }

    private waitForMessages(waitMs: number): Promise<void> {
        return new Promise(resolve => {
            const done = (): void => {
                clearTimeout(timer);
                if (this.wake === done) this.wake = undefined;
                resolve();
            };
            const timer = setTimeout(done, waitMs);
            this.wake = done;
        });
    }
}
