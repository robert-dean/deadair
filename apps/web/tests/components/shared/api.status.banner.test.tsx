import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { SdkError } from '@deadair/sdk';

import { ApiStatusBanner } from '../../../src/components/shared/api.status.banner';
import { createTestQueryClient, render, screen, waitFor } from '../../utils/render';

/**
 * Seeds a cache with one failed query, which is how the banner learns anything: it reads the query
 * cache rather than being told, so a failure anywhere in the console raises it.
 */
async function cacheWith(error: unknown, queryClient: QueryClient = createTestQueryClient()): Promise<QueryClient> {
    await queryClient
        .fetchQuery({
            queryKey: ['anything'],
            queryFn: () => Promise.reject(error),
            retry: false,
        })
        .catch(() => undefined);
    return queryClient;
}

/**
 * Whether the banner drew. Asked by its heading rather than by an empty container: Mantine renders
 * its stylesheet into the same node, so the container is never actually empty.
 */
function banner(): HTMLElement | null {
    return screen.queryByText(/can't reach the station/i);
}

describe('ApiStatusBanner', () => {
    it('draws nothing while the station answers', () => {
        render(<ApiStatusBanner />);
        expect(banner()).not.toBeInTheDocument();
    });

    it('draws nothing for a failure the server actually answered', async () => {
        // A 401 is the API alive and refusing, so the page that asked owns that message. The banner
        // claiming the station is unreachable would send the operator looking at the network.
        const queryClient = await cacheWith(new SdkError(401, 'Unauthorized', {}, new Headers()));
        render(<ApiStatusBanner />, { queryClient });
        expect(banner()).not.toBeInTheDocument();
    });

    it('says the station is unreachable once a query fails on connectivity', async () => {
        const queryClient = await cacheWith(new TypeError('Failed to fetch'));
        render(<ApiStatusBanner />, { queryClient });

        await waitFor(() => {
            expect(banner()).toBeInTheDocument();
        });
        // The countdown, and the sentence that matters more than it: what is on screen is stale.
        expect(screen.getByRole('status')).toHaveTextContent(/out of date/i);
        expect(screen.getByRole('status')).toHaveTextContent(/trying again in \d+s/i);
        expect(screen.getByRole('button', { name: /try now/i })).toBeInTheDocument();
    });

    it('clears itself when the station comes back', async () => {
        const queryClient = await cacheWith(new TypeError('Failed to fetch'));
        render(<ApiStatusBanner />, { queryClient });
        await waitFor(() => {
            expect(banner()).toBeInTheDocument();
        });

        // The failing query stops failing. Nothing dismisses this banner by hand, which is the
        // point: the operator should not have to tell the console the server is back.
        queryClient.removeQueries({ queryKey: ['anything'] });

        await waitFor(() => {
            expect(banner()).not.toBeInTheDocument();
        });
    });
});
