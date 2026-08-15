// Every edit to the running order answers with the order it produced, so the console never has to
// re-read what it just changed — and must not, because a re-read would race the transport's own
// next move. What is tested here is that each hook writes that answer in, and that a refill, which
// answers with nothing because it is a job, is followed up rather than assumed.

import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    followStationExtend,
    useExtendOrder,
    useMoveOrderItem,
    usePutStationOnAir,
    useRemoveOrderItem,
    useReplanOrder,
    useSetAirMode,
    useShuffleOrder,
} from '../../src/api/director.queries';
import { queryKeys } from '../../src/api/query.keys';
import { stationAir } from '../utils/station.fixture';
import { createTestQueryClient } from '../utils/render';

const shuffleTheRunningOrder = vi.fn();
const removeARunningOrderItem = vi.fn();
const moveARunningOrderItem = vi.fn();
const putTheStationOnAir = vi.fn();
const extendTheRunningOrder = vi.fn();
const replanTheRunningOrder = vi.fn();
const setTheAirMode = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: {
        director: {
            shuffleTheRunningOrder: () => shuffleTheRunningOrder(),
            removeARunningOrderItem: (...args: unknown[]) => removeARunningOrderItem(...args),
            moveARunningOrderItem: (...args: unknown[]) => moveARunningOrderItem(...args),
            putTheStationOnAir: (...args: unknown[]) => putTheStationOnAir(...args),
            extendTheRunningOrder: (...args: unknown[]) => extendTheRunningOrder(...args),
            replanTheRunningOrder: (...args: unknown[]) => replanTheRunningOrder(...args),
            setTheAirMode: (...args: unknown[]) => setTheAirMode(...args),
        },
    },
}));

const order = (overrides: Record<string, unknown> = {}) => ({
    name: 'Late shift',
    mode: 'rotation' as const,
    onEnd: 'extend' as const,
    source: 'import',
    items: [],
    ...overrides,
});

// `createElement` rather than JSX: this file is a `.ts`, and the wrapper is the only markup in it.
const wrapWithQueryClient =
    (client: QueryClient) =>
    ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children);

let queryClient: QueryClient;

beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
});

afterEach(() => {
    queryClient.clear();
});

describe('an edit that answers with the running order', () => {
    it('writes the answer straight in rather than re-reading it', async () => {
        // A re-read would race the transport: the director applied the edit before it replied, and
        // by the time a second request landed the player may have moved on.
        const shuffled = order({ name: 'Shuffled' });
        shuffleTheRunningOrder.mockResolvedValue(shuffled);

        const { result } = renderHook(() => useShuffleOrder(), { wrapper: wrapWithQueryClient(queryClient) });
        await act(async () => {
            await result.current.mutateAsync();
        });

        expect(queryClient.getQueryData(queryKeys.director.order())).toEqual(shuffled);
    });

    it('names the item it is dropping and nothing else', async () => {
        // No revision and no lineup id: there is one running order and one thing allowed to change
        // it, so there is nothing to be stale against.
        removeARunningOrderItem.mockResolvedValue(order());

        const { result } = renderHook(() => useRemoveOrderItem(), { wrapper: wrapWithQueryClient(queryClient) });
        await act(async () => {
            await result.current.mutateAsync('item-2');
        });

        expect(removeARunningOrderItem).toHaveBeenCalledWith('item-2');
    });

    it('files a move the same way, though nothing calls it yet', async () => {
        moveARunningOrderItem.mockResolvedValue(order());

        const { result } = renderHook(() => useMoveOrderItem(), { wrapper: wrapWithQueryClient(queryClient) });
        await act(async () => {
            await result.current.mutateAsync({ itemId: 'item-3', toIndex: 1 });
        });

        expect(moveARunningOrderItem).toHaveBeenCalledWith('item-3', { toIndex: 1 });
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

describe('useExtendOrder', () => {
    it('follows the refill up rather than assuming it landed', async () => {
        // A refill is a job: the route answers 202 and the tracks appear once the catalog walk is
        // done. There is nothing to write into the cache, so the console looks again.
        vi.useFakeTimers();
        try {
            extendTheRunningOrder.mockResolvedValue(undefined);
            const refetch = vi.spyOn(queryClient, 'refetchQueries');

            const { result } = renderHook(() => useExtendOrder(), { wrapper: wrapWithQueryClient(queryClient) });
            await act(async () => {
                await result.current.mutateAsync({});
            });

            expect(refetch).not.toHaveBeenCalled();
            await act(async () => {
                await vi.advanceTimersByTimeAsync(2_000);
            });
            expect(refetch).toHaveBeenCalledWith({ queryKey: queryKeys.director.order() });

            // Drained before this case ends. The follow-ups are module state, so a case that left
            // timers pending would be counted by the next one.
            await act(async () => {
                await vi.advanceTimersByTimeAsync(10_000);
            });
        } finally {
            vi.useRealTimers();
        }
    });

    // Extending twice replaces the pending follow-ups rather than stacking on them; see
    // `followStationExtend`. Deliberately not pinned by a test: the schedule is module state, so a
    // case that asserts on it is asserting on what every case before it left behind, and fake-timer
    // sessions do not carry handles across.
});

describe('useReplanOrder', () => {
    it('passes the brief through and follows the swap up, since nothing comes back to write in', async () => {
        // Slower than a refill by design: the whole set is generated before anything is dropped, so
        // these follow-ups are a nudge and the running order's own poll is what shows the new hour.
        vi.useFakeTimers();
        try {
            replanTheRunningOrder.mockResolvedValue(undefined);
            const refetch = vi.spyOn(queryClient, 'refetchQueries');

            const { result } = renderHook(() => useReplanOrder(), { wrapper: wrapWithQueryClient(queryClient) });
            await act(async () => {
                await result.current.mutateAsync({ brief: 'heavy metal hits' });
            });

            expect(replanTheRunningOrder).toHaveBeenCalledWith({ brief: 'heavy metal hits' });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(2_000);
            });
            expect(refetch).toHaveBeenCalledWith({ queryKey: queryKeys.director.order() });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(10_000);
            });
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('useSetAirMode', () => {
    it('writes the mode that was just chosen, not the one the config still reports', async () => {
        const air = stationAir({ airMode: 'always' });
        setTheAirMode.mockResolvedValue(air);

        const { result } = renderHook(() => useSetAirMode(), { wrapper: wrapWithQueryClient(queryClient) });
        await act(async () => {
            await result.current.mutateAsync({ airMode: 'always' });
        });

        expect(queryClient.getQueryData(queryKeys.director.air())).toEqual(air);
    });
});
