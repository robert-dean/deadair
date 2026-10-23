// The as-run log decides two things the API does not: how long each item ran, worked out from its
// two ends, and what an item with no end means, which depends on where it sits. The newest item is
// on air now; any other open one is an item the station never saw end.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { AsRunEntry } from '@deadair/sdk';

import { AsRunPage } from '../../../src/components/activity/as.run.page';
import { render, screen } from '../../utils/render';

const AT = DateTime.fromISO('2026-10-23T21:00:00.000Z');

const item = (over: Partial<AsRunEntry> = {}): AsRunEntry => ({
    id: 'run-1',
    kind: 'record',
    at: AT,
    title: 'Pink Moon',
    artists: 'Nick Drake',
    ...over,
});

const log = vi.fn();

vi.mock('../../../src/api/as.run.queries', () => ({
    useAsRun: (until: unknown) => log(until),
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, params, children, ...rest }: { to: string; params?: Record<string, string>; children?: ReactNode }) => (
        <a href={Object.entries(params ?? {}).reduce((built, [key, value]) => built.replace(`$${key}`, value), to)} {...rest}>
            {children}
        </a>
    ),
}));

const answer = (entries: AsRunEntry[]) => ({
    data: { pages: [{ entries }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
});

describe('AsRunPage', () => {
    it('says what went out and how long each item ran', () => {
        log.mockReturnValue(answer([item({ endedAt: AT.plus({ minutes: 2, seconds: 5 }), trackId: 'tr-1' })]));

        render(<AsRunPage />);

        expect(screen.getByText('Pink Moon')).toBeInTheDocument();
        expect(screen.getByText('by Nick Drake')).toBeInTheDocument();
        expect(screen.getByText('2:05')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'the record' })).toHaveAttribute('href', '/catalog/tracks/tr-1');
    });

    it('tells the item on air now from an older one nobody saw end', () => {
        log.mockReturnValue(
            answer([item({ id: 'run-2', title: 'Hazey Jane', at: AT.plus({ minutes: 10 }) }), item({ id: 'run-1', title: 'Pink Moon' })]),
        );

        render(<AsRunPage />);

        expect(screen.getByText('on air')).toBeInTheDocument();
        expect(screen.getByText('no end seen')).toBeInTheDocument();
    });

    it('draws a gap and an air change as the station’s own sentence', () => {
        log.mockReturnValue(
            answer([
                item({
                    id: 'gap-1',
                    kind: 'gap',
                    title: undefined,
                    artists: undefined,
                    detail: 'The station aired the local bed instead of its running order for 30s.',
                }),
                item({ id: 'off-1', kind: 'offAir', title: undefined, artists: undefined, detail: 'The station was stood down.' }),
            ]),
        );

        render(<AsRunPage />);

        expect(screen.getByText('Local bed')).toBeInTheDocument();
        expect(screen.getByText('The station aired the local bed instead of its running order for 30s.')).toBeInTheDocument();
        expect(screen.getByText('Off air')).toBeInTheDocument();
    });

    it('says how many handed-over items never aired before one', () => {
        log.mockReturnValue(answer([item({ passedOver: 3, endedAt: AT.plus({ minutes: 3 }) })]));

        render(<AsRunPage />);

        expect(screen.getByText(/moved past 3 items that had been handed over/)).toBeInTheDocument();
    });

    it('reads the live head until a moment is chosen', () => {
        log.mockReturnValue(answer([]));

        render(<AsRunPage />);

        expect(log).toHaveBeenLastCalledWith(undefined);
        expect(screen.getByText(/Nothing has gone out yet/)).toBeInTheDocument();
    });
});
