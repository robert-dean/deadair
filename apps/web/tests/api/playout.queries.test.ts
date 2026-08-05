// The transport is the one query that polls, and a transport action is the one
// moment the station moves because of THIS browser. What is tested here is the gap
// between those two facts: the action's own answer is written straight in, and then
// the console keeps looking for a moment rather than waiting out a poll interval it
// already knows is about to be wrong.

import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { followTransport, playoutStatusOptions } from '../../src/api/playout.queries';
import { queryKeys } from '../../src/api/query.keys';
import { playoutStatus } from '../utils/playout.fixture';

vi.mock('../../src/api/client', () => ({
    sdk: { playout: { getPlayoutStatus: vi.fn() } },
}));

let queryClient: QueryClient;
let refetch: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient();
    refetch = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue(undefined);
});

afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
    vi.restoreAllMocks();
});

describe('playoutStatusOptions', () => {
    it('polls, and keeps polling with the tab in the background', () => {
        // A broadcast console that froze when the operator alt-tabbed would resume
        // from a stale reading rather than the truth.
        expect(playoutStatusOptions.queryKey).toEqual(queryKeys.playout.status());
        expect(playoutStatusOptions.refetchInterval).toBe(2_000);
        expect(playoutStatusOptions.refetchIntervalInBackground).toBe(true);
    });
});

describe('followTransport', () => {
    it('writes the status the action produced, before any refetch', () => {
        const status = playoutStatus();

        followTransport(queryClient, status);

        expect(queryClient.getQueryData(queryKeys.playout.status())).toEqual(status);
        expect(refetch).not.toHaveBeenCalled();
    });

    it('looks again three times, then leaves it to the poll', () => {
        followTransport(queryClient, playoutStatus());

        vi.advanceTimersByTime(3_000);
        expect(refetch).toHaveBeenCalledTimes(3);
        expect(refetch).toHaveBeenCalledWith({ queryKey: queryKeys.playout.status() });

        // Nothing keeps firing: the ordinary interval owns the station from here.
        vi.advanceTimersByTime(30_000);
        expect(refetch).toHaveBeenCalledTimes(3);
    });

    it('replaces the previous schedule rather than stacking on it', () => {
        // Two skips in quick succession is an ordinary thing for an operator to do,
        // and it should not multiply the reads.
        followTransport(queryClient, playoutStatus());
        vi.advanceTimersByTime(500);
        followTransport(queryClient, playoutStatus());

        vi.advanceTimersByTime(3_000);

        expect(refetch).toHaveBeenCalledTimes(4);
    });
});
