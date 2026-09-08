// The card's whole job is to be honest about two numbers that disagree, so what is pinned here is
// what it says when they do: a file no row claims, a row whose file has gone, and a store that
// cannot have either. Plus the cap bar, which is the one thing on this page an operator can act on.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { StorageReport } from '@deadair/sdk';

import { StorageCard } from '../../../src/components/settings/storage.card';
import { stubPhoneMedia } from '../../utils/phone';
import { render, screen, waitFor } from '../../utils/render';

const readStorage = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: { storage: { readStorage: (...args: unknown[]) => readStorage(...args) } },
}));

afterEach(() => {
    readStorage.mockReset();
});

const REPORT: StorageReport = {
    readAt: DateTime.fromISO('2026-08-16T13:43:48.367Z'),
    totalFiles: 1556,
    totalBytes: 3_931_781_328,
    stores: [
        {
            id: 'tracks',
            label: "The station's own copies of records",
            path: '/media/tracks',
            files: 345,
            bytes: 3_750_670_519,
            rows: 345,
            accountedBytes: 3_750_670_519,
            capBytes: 5_368_709_120,
            orphanFiles: 0,
            orphanBytes: 0,
            rowsWithNoFile: 0,
        },
        {
            id: 'art',
            label: 'Cover art',
            path: '/media/art',
            files: 920,
            bytes: 141_769_984,
            rows: 774,
            accountedBytes: 111_956_457,
            orphanFiles: 151,
            orphanBytes: 30_687_500,
            rowsWithNoFile: 2,
        },
        {
            id: 'voices',
            label: 'Voice previews',
            path: '/media/voice-samples',
            files: 1,
            bytes: 43_821,
            orphanFiles: 0,
            orphanBytes: 0,
            rowsWithNoFile: 0,
        },
    ],
};

describe('StorageCard', () => {
    it('names every store, where it is, and what it weighs', async () => {
        readStorage.mockResolvedValue(REPORT);
        render(<StorageCard />);

        expect(await screen.findByText("The station's own copies of records")).toBeInTheDocument();
        expect(screen.getByText('/media/art')).toBeInTheDocument();
        expect(screen.getByText('3.5 GB')).toBeInTheDocument();
        expect(screen.getByText('3.7 GB')).toBeInTheDocument();
    });

    // Both disagreements are reported and neither is dressed up as an error: they are ordinary
    // states of a station that has been running for a while.
    it('reports what nothing claims and what has gone missing', async () => {
        readStorage.mockResolvedValue(REPORT);
        render(<StorageCard />);

        expect(await screen.findByText('29.3 MB')).toBeInTheDocument();
        expect(screen.getByText('2 missing')).toBeInTheDocument();
    });

    // A row of zeroes on every store would be noise on the one page an operator scans for a number.
    it('says nothing about a store with nothing to report', async () => {
        readStorage.mockResolvedValue(REPORT);
        render(<StorageCard />);

        await screen.findByText('Voice previews');
        expect(screen.queryByText('0 missing')).not.toBeInTheDocument();
    });

    it('shows the share of the limit, for the one store that has one', async () => {
        readStorage.mockResolvedValue(REPORT);
        render(<StorageCard />);

        expect(await screen.findByText('70% of 5.0 GB')).toBeInTheDocument();
        expect(screen.getAllByLabelText('Share of the limit in use')).toHaveLength(1);
    });

    // The desk explains both disagreements through a tooltip, and a phone has no hover — so the
    // fold has to put the meaning into the words. What is pinned is that nothing was dropped: the
    // two columns become a fact line, the limit keeps its bar, and the foot row keeps both totals.
    it('gives a phone cards whose folded columns say what they are', async () => {
        const restore = stubPhoneMedia();
        try {
            readStorage.mockResolvedValue(REPORT);
            render(<StorageCard />);

            expect(await screen.findByText('Cover art')).toBeInTheDocument();
            expect(screen.getByText('/media/art')).toBeInTheDocument();
            expect(screen.getByText('920 files')).toBeInTheDocument();
            expect(screen.getByText('2 missing')).toBeInTheDocument();
            expect(screen.getByText('29.3 MB unclaimed')).toBeInTheDocument();
            expect(screen.getByText('70% of 5.0 GB')).toBeInTheDocument();
            expect(screen.getByText('3.7 GB · 1556 files')).toBeInTheDocument();
            expect(screen.queryByRole('table')).not.toBeInTheDocument();
        } finally {
            restore();
        }
    });

    it('says so when the figures cannot be read at all', async () => {
        readStorage.mockRejectedValue(new Error('the volume is gone'));
        render(<StorageCard />);

        await waitFor(() => expect(screen.getByText('Disk figures unavailable')).toBeInTheDocument());
    });
});
