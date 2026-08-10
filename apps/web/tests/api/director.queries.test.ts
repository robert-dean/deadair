// The lineup layer has two writers this browser is not: the extend job appends to a lineup, and
// the director commits from the head of it as tracks air. What is tested here is how the console
// stays honest about that — every edit's own answer goes straight into the cache, the summaries it
// invalidates rather than guesses at, and the one action that answers before it has done anything
// keeps looking instead of pretending it is done.

import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    followExtend,
    lineupOptions,
    stationAirOptions,
    useDeleteLineup,
    useExtendLineup,
    useMoveLineupItem,
    usePutStationOnAir,
    useRemoveLineupItem,
    useShuffleLineup,
} from '../../src/api/director.queries';
import { queryKeys } from '../../src/api/query.keys';
import { lineup, lineupSummary, stationAir } from '../utils/lineup.fixture';
import { createTestQueryClient } from '../utils/render';

const shuffleALineup = vi.fn();
const removeALineupItem = vi.fn();
const moveALineupItem = vi.fn();
const putTheStationOnAir = vi.fn();
const extendALineup = vi.fn();
const deleteALineup = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: {
        director: {
            shuffleALineup: (...args: unknown[]) => shuffleALineup(...args),
            removeALineupItem: (...args: unknown[]) => removeALineupItem(...args),
            moveALineupItem: (...args: unknown[]) => moveALineupItem(...args),
            putTheStationOnAir: (...args: unknown[]) => putTheStationOnAir(...args),
            extendALineup: (...args: unknown[]) => extendALineup(...args),
            deleteALineup: (...args: unknown[]) => deleteALineup(...args),
        },
    },
}));

let queryClient: QueryClient;

beforeEach(() => {
    queryClient = createTestQueryClient();
});

afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
});

/** Wraps a hook under test with the provider, for a query client the test controls. */
function wrapWithQueryClient(client: QueryClient) {
    return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

describe('stationAirOptions', () => {
    it('polls, and keeps polling with the tab in the background', () => {
        // Slower than the transport on purpose: the cursor moves once a track, not once a
        // reconcile tick. Background polling is there for the same reason the transport's is —
        // an operator who alt-tabs back wants the truth, not a frozen reading.
        expect(stationAirOptions.queryKey).toEqual(queryKeys.director.air());
        expect(stationAirOptions.refetchInterval).toBe(5_000);
        expect(stationAirOptions.refetchIntervalInBackground).toBe(true);
    });
});

describe('an edit that answers with the lineup', () => {
    it('writes the answer in and marks the summaries stale rather than patching them', async () => {
        const shuffled = lineup({ revision: 5 });
        shuffleALineup.mockResolvedValue(shuffled);
        queryClient.setQueryData(queryKeys.director.lineups(), { lineups: [lineupSummary()] });
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

        const { result } = renderHook(() => useShuffleLineup(), { wrapper: wrapWithQueryClient(queryClient) });
        await act(async () => {
            await result.current.mutateAsync({ lineupId: 'lineup-1', revision: 4 });
        });

        expect(shuffleALineup).toHaveBeenCalledWith('lineup-1', { revision: 4 });
        expect(queryClient.getQueryData(queryKeys.director.lineup('lineup-1'))).toEqual(shuffled);
        // A summary carries an itemCount and a revision this answer has just moved. Re-reading it
        // is the only way the two cannot drift.
        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.director.lineups() });
    });

    it('sends the revision the operator was looking at, and omits it when there is none', async () => {
        removeALineupItem.mockResolvedValue(lineup());

        const { result } = renderHook(() => useRemoveLineupItem(), { wrapper: wrapWithQueryClient(queryClient) });
        await act(async () => {
            await result.current.mutateAsync({ lineupId: 'lineup-1', itemId: 'line-2', revision: 4 });
        });
        await act(async () => {
            await result.current.mutateAsync({ lineupId: 'lineup-1', itemId: 'line-3' });
        });

        expect(removeALineupItem).toHaveBeenNthCalledWith(1, 'lineup-1', 'line-2', { revision: 4 });
        // Absent skips the check server-side, which is a different request from `revision: undefined`.
        expect(removeALineupItem).toHaveBeenNthCalledWith(2, 'lineup-1', 'line-3', undefined);
    });

    it('files a move the same way, though nothing calls it yet', async () => {
        const moved = lineup({ revision: 6 });
        moveALineupItem.mockResolvedValue(moved);

        const { result } = renderHook(() => useMoveLineupItem(), { wrapper: wrapWithQueryClient(queryClient) });
        await act(async () => {
            await result.current.mutateAsync({ lineupId: 'lineup-1', itemId: 'line-3', toIndex: 1, revision: 5 });
        });

        expect(moveALineupItem).toHaveBeenCalledWith('lineup-1', 'line-3', { toIndex: 1, revision: 5 });
        expect(queryClient.getQueryData(queryKeys.director.lineup('lineup-1'))).toEqual(moved);
    });

    it('leaves a stale revision as the failure the server made it', async () => {
        shuffleALineup.mockRejectedValue(new Error('conflict'));
        queryClient.setQueryData(queryKeys.director.lineup('lineup-1'), lineup());

        const { result } = renderHook(() => useShuffleLineup(), { wrapper: wrapWithQueryClient(queryClient) });
        await act(async () => {
            await result.current.mutateAsync({ lineupId: 'lineup-1', revision: 1 }).catch(() => undefined);
        });

        await waitFor(() => expect(result.current.isError).toBe(true));
        // Nothing is written on a refusal: the cached order is still the one the API holds.
        expect(queryClient.getQueryData(queryKeys.director.lineup('lineup-1'))).toEqual(lineup());
    });
});

describe('usePutStationOnAir', () => {
    it('writes the air reading and re-reads the running order it just built', async () => {
        const air = stationAir();
        putTheStationOnAir.mockResolvedValue(air);
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

        const { result } = renderHook(() => usePutStationOnAir(), { wrapper: wrapWithQueryClient(queryClient) });
        await act(async () => {
            await result.current.mutateAsync({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });
        });

        expect(queryClient.getQueryData(queryKeys.director.air())).toEqual(air);
        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.director.order() });
        // The transport polls on its own clock; this is the one moment it moved because of us.
        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.playout.status() });
    });
});

describe('useDeleteLineup', () => {
    it('drops the deleted lineup from the cache rather than leaving a read of a 404', async () => {
        deleteALineup.mockResolvedValue(undefined);
        queryClient.setQueryData(queryKeys.director.lineup('lineup-1'), lineup());

        const { result } = renderHook(() => useDeleteLineup(), { wrapper: wrapWithQueryClient(queryClient) });
        await act(async () => {
            await result.current.mutateAsync('lineup-1');
        });

        expect(queryClient.getQueryData(queryKeys.director.lineup('lineup-1'))).toBeUndefined();
    });
});

describe('followExtend', () => {
    let refetch: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.useFakeTimers();
        refetch = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * How many times one lineup was re-read.
     *
     * Counted by key rather than by call: `invalidateQueries` refetches through
     * `refetchQueries`, so the list invalidation lands on the same spy as the lineup read.
     */
    function readsOf(lineupId: string): number {
        const wanted = JSON.stringify(queryKeys.director.lineup(lineupId));
        return refetch.mock.calls.filter((call: unknown[]) => JSON.stringify((call[0] as { queryKey?: unknown }).queryKey) === wanted).length;
    }

    it('looks again three times, then leaves the lineup alone', () => {
        followExtend(queryClient, 'lineup-1');

        // Extend answers 202 before the job has walked anything, so there is nothing to write
        // and nothing to see yet.
        expect(refetch).not.toHaveBeenCalled();

        vi.advanceTimersByTime(9_000);
        expect(readsOf('lineup-1')).toBe(3);

        // A refill that has not landed by now is worth telling the operator about, not polling for.
        vi.advanceTimersByTime(60_000);
        expect(readsOf('lineup-1')).toBe(3);
    });

    it('replaces the previous schedule for the same lineup rather than stacking on it', () => {
        followExtend(queryClient, 'lineup-1');
        vi.advanceTimersByTime(1_000);
        followExtend(queryClient, 'lineup-1');

        vi.advanceTimersByTime(9_000);

        expect(readsOf('lineup-1')).toBe(3);
    });

    it('keeps two lineups’ schedules apart', () => {
        followExtend(queryClient, 'lineup-1');
        followExtend(queryClient, 'lineup-2');
        vi.advanceTimersByTime(9_000);

        expect(readsOf('lineup-1')).toBe(3);
        expect(readsOf('lineup-2')).toBe(3);
    });
});

describe('useExtendLineup', () => {
    it('asks for a count only when the operator chose one', async () => {
        extendALineup.mockResolvedValue(undefined);

        const { result } = renderHook(() => useExtendLineup(), { wrapper: wrapWithQueryClient(queryClient) });
        await act(async () => {
            await result.current.mutateAsync({ lineupId: 'lineup-1', count: 20 });
        });
        await act(async () => {
            await result.current.mutateAsync({ lineupId: 'lineup-1' });
        });

        expect(extendALineup).toHaveBeenNthCalledWith(1, 'lineup-1', { count: 20 });
        expect(extendALineup).toHaveBeenNthCalledWith(2, 'lineup-1', {});
    });
});

describe('lineupOptions', () => {
    it('keys on the lineup, so one lineup’s answer cannot land in another’s read', () => {
        expect(lineupOptions('lineup-1').queryKey).toEqual(queryKeys.director.lineup('lineup-1'));
        expect(lineupOptions('lineup-2').queryKey).not.toEqual(lineupOptions('lineup-1').queryKey);
    });
});
