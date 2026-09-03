// The loader's whole job is deciding what the route WAITS for, and this pins the half that made
// `/news` feel broken. `/news/feeds` answers in ~27ms on the live station where `/news` took 3.2s,
// because a story is read from the publisher's own page one page at a time. Awaiting both made the
// route as slow as the slower one for no gain: the page draws a skeleton for pending stories
// anyway, so waiting on them bought a blank screen instead of a skeleton.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
    createFileRoute: () => (options: unknown) => options,
    useNavigate: () => vi.fn(),
}));

vi.mock('../../src/api/client', () => ({ sdk: { news: { listFeeds: vi.fn(), readNews: vi.fn() } } }));

const { Route } = await import('../../src/routes/news');

interface FakeClient {
    ensureQueryData: ReturnType<typeof vi.fn>;
    prefetchQuery: ReturnType<typeof vi.fn>;
}

type Loader = (args: { context: { queryClient: FakeClient } }) => Promise<unknown>;

const runLoader = (queryClient: FakeClient): Promise<unknown> => (Route as unknown as { loader: Loader }).loader({ context: { queryClient } });

/** A client whose stories never arrive, which is the case the old loader hung on. */
const clientWithPendingStories = (): FakeClient => ({
    ensureQueryData: vi.fn(async () => ({ feeds: [] })),
    prefetchQuery: vi.fn(() => new Promise<void>(() => undefined)),
});

/**
 * Whether the loader is done, rather than whether it eventually finishes.
 *
 * Raced against a timer rather than simply awaited, because the regression this guards is a loader
 * that never settles — and awaiting one of those reports a twenty-second suite timeout, which says
 * nothing about which promise was being waited on.
 */
const settlesPromptly = async (work: Promise<unknown>): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), 100);
    });

    const settled = await Promise.race([work.then(() => true), waited]);
    if (timer !== undefined) clearTimeout(timer);
    return settled;
};

describe('/news loader', () => {
    it('does not wait for the stories, so the page arrives on the feeds alone', async () => {
        const queryClient = clientWithPendingStories();

        expect(await settlesPromptly(runLoader(queryClient))).toBe(true);
        expect(queryClient.ensureQueryData).toHaveBeenCalledTimes(1);
    });

    // Started rather than merely left to the component: the request is in flight before anything
    // mounts, and `useNews` adopts that same promise rather than opening a second one.
    it('still starts the stories, so nothing is waiting on the component to mount', () => {
        const queryClient = clientWithPendingStories();

        void runLoader(queryClient);

        expect(queryClient.prefetchQuery).toHaveBeenCalledTimes(1);
    });

    // A loader that throws is replaced wholesale by the router's error boundary. What is wanted is
    // the page rendering its own alert over its own controls, which is why this is swallowed.
    it('renders the page anyway when the feeds cannot be read', async () => {
        const queryClient: FakeClient = {
            ensureQueryData: vi.fn(async () => {
                throw new Error('no plugin answered');
            }),
            prefetchQuery: vi.fn(async () => undefined),
        };

        await expect(runLoader(queryClient)).resolves.toBeUndefined();
    });
});
