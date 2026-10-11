/**
 * The smallest Chrome DevTools Protocol client that can drive a page, and no dependency.
 *
 * Node has had a global `WebSocket` since 22, so a CDP client is a socket, a request id counter and
 * a map of pending promises. That is the whole reason this container is not carrying Playwright or
 * puppeteer, and the reason is not only weight: **Playwright's bundled Chromium has no Widevine
 * CDM**, so a test that passed under it would prove nothing about the one thing this container
 * exists to do. What is needed is Google's own Chrome build, launched by us, which those libraries
 * support as a channel but neither makes simpler than this.
 *
 * Only four methods are used — `Target.attachToTarget`, `Runtime.evaluate`, `Page.navigate` and
 * `Target.getTargets` — so anything more general would be speculative.
 */

/** A failed `Runtime.evaluate`, carrying whatever the page said rather than a generic message. */
export class EvaluateError extends Error {}

interface Pending {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
}

export interface CdpTarget {
    targetId: string;
    type: string;
    url: string;
}

export class CdpClient {
    private socket: WebSocket | undefined;
    private nextId = 1;
    private readonly pending = new Map<number, Pending>();

    private readonly url: string;

    // A field and an assignment rather than a parameter property: Node runs this file by stripping
    // its types, and a parameter property is the one class syntax that needs a transform instead.
    // `erasableSyntaxOnly` in the tsconfig is what catches that at typecheck rather than at boot.
    private constructor(url: string) {
        this.url = url;
    }

    /**
     * Connect to the browser target, waiting for Chrome to answer `/json/version` at all.
     *
     * The wait is the point: this runs in a container entrypoint where Chrome was started moments
     * ago and its DevTools endpoint comes up when it comes up. Polling a local HTTP endpoint is the
     * documented way to learn the browser's socket URL and also the only honest readiness signal —
     * a fixed sleep either wastes time or races.
     */
    static async connect(port: number, timeoutMs: number, signal?: AbortSignal): Promise<CdpClient> {
        const deadline = Date.now() + timeoutMs;
        let lastError = 'chrome did not answer';

        while (Date.now() < deadline) {
            signal?.throwIfAborted();
            try {
                const response = await fetch(`http://127.0.0.1:${port}/json/version`);
                if (response.ok) {
                    const body = (await response.json()) as { webSocketDebuggerUrl?: string };
                    if (body.webSocketDebuggerUrl !== undefined) {
                        const client = new CdpClient(body.webSocketDebuggerUrl);
                        await client.open();
                        return client;
                    }
                    lastError = 'chrome answered /json/version with no debugger url';
                }
            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
            }
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        throw new Error(`could not attach to chrome on ${port}: ${lastError}`);
    }

    private open(): Promise<void> {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(this.url);
            this.socket = socket;

            socket.addEventListener('open', () => resolve(), { once: true });
            socket.addEventListener('error', () => reject(new Error(`websocket to ${this.url} failed`)), { once: true });
            socket.addEventListener('message', event => this.receive(String(event.data)));
            socket.addEventListener('close', () => {
                // Everything in flight is owed an answer that is never coming. Rejecting here is what
                // turns "chrome died mid-record" into a failed fetch rather than a hung one.
                for (const [, waiter] of this.pending) waiter.reject(new Error('chrome closed the devtools connection'));
                this.pending.clear();
            });
        });
    }

    private receive(raw: string): void {
        let message: { id?: number; result?: unknown; error?: { message?: string } };
        try {
            message = JSON.parse(raw) as typeof message;
        } catch {
            return;
        }
        // Events (no `id`) are deliberately dropped: end-of-record is read by polling the page's own
        // recorder (see player.ts), which survives a missed event where a subscription does not.
        if (message.id === undefined) return;

        const waiter = this.pending.get(message.id);
        if (waiter === undefined) return;
        this.pending.delete(message.id);

        if (message.error !== undefined) waiter.reject(new Error(message.error.message ?? 'devtools command failed'));
        else waiter.resolve(message.result);
    }

    async send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
        const socket = this.socket;
        if (socket === undefined || socket.readyState !== WebSocket.OPEN) throw new Error('not connected to chrome');

        const id = this.nextId++;
        const payload: Record<string, unknown> = { id, method, params };
        if (sessionId !== undefined) payload.sessionId = sessionId;

        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
            socket.send(JSON.stringify(payload));
        });
    }

    async targets(): Promise<CdpTarget[]> {
        const result = await this.send<{ targetInfos: CdpTarget[] }>('Target.getTargets');
        return result.targetInfos;
    }

    /** Attach to a target and get a session id. Flattened, which is the only mode worth using. */
    async attach(targetId: string): Promise<string> {
        const result = await this.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
        return result.sessionId;
    }

    /**
     * Evaluate an expression in a page and return its value.
     *
     * `awaitPromise` and `returnByValue` are always on: everything this container asks a page is
     * either async or a plain object, and a `RemoteObject` handle would have to be released.
     * A thrown exception comes back as a rejection carrying the page's own text, because "what did
     * MusicKit say" is the entire diagnostic value of a failed record.
     */
    async evaluate<T>(sessionId: string, expression: string): Promise<T> {
        const result = await this.send<{
            result?: { value?: T };
            exceptionDetails?: { exception?: { description?: string }; text?: string };
        }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);

        if (result.exceptionDetails !== undefined) {
            const details = result.exceptionDetails;
            throw new EvaluateError(details.exception?.description ?? details.text ?? 'the page threw');
        }
        return result.result?.value as T;
    }

    close(): void {
        this.socket?.close();
    }
}
