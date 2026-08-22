import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as testingLibraryRender, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';

import { theme } from '../../src/theme';

/**
 * A cache scoped to one test. Retries are off so a deliberate failure surfaces immediately instead
 * of sitting through the app's backoff.
 *
 * `gcTime` is deliberately left at the library default rather than zeroed: a `setQueryData` write
 * with no mounted observer — which is exactly what a mutation's `onSuccess` does here — is
 * collected the instant it lands under `gcTime: 0`, so the assertion sees `undefined`. Isolation
 * between cases comes from building a fresh client per test, not from eviction.
 */
export function createTestQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false, staleTime: 0 },
            mutations: { retry: false },
        },
    });
}

export interface RenderOptions {
    /** Supply one to seed or inspect the cache; otherwise each render gets a fresh client. */
    queryClient?: QueryClient;
}

/** Renders under the app's provider stack. `env="test"` disables transitions and portals. */
export function render(ui: ReactNode, options: RenderOptions = {}): RenderResult {
    const queryClient = options.queryClient ?? createTestQueryClient();
    return testingLibraryRender(ui, {
        wrapper: ({ children }) => (
            <QueryClientProvider client={queryClient}>
                <MantineProvider theme={theme} env="test" forceColorScheme="dark">
                    {children}
                </MantineProvider>
            </QueryClientProvider>
        ),
    });
}

/**
 * A user for driving the page, set up the way this suite needs.
 *
 * `delay: null` types the whole string in one go instead of waiting between keystrokes. The default
 * puts a real timer between characters, which is a fair model of a person and a bad one for a test:
 * a form filled with two sentences spends most of a second doing nothing, and under a full-suite
 * run that dead time is where a case crosses its timeout. Worse, the waits are where the keystrokes
 * INTERLEAVE — a contended run produced `aAc hsihnoer tn oobnoed` from two sequential `type` calls,
 * which is a scheduling artefact rather than anything a user could do.
 *
 * Nothing here is asserting that typing is paced, so there is nothing to lose by removing the pause.
 * A test that genuinely wants per-keystroke behaviour should set up its own and say why.
 */
export function setupUser(): UserEvent {
    return userEvent.setup({ delay: null });
}

export { screen, waitFor, within } from '@testing-library/react';
