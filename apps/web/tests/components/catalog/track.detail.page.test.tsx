// The page exists to answer "why will this record not air", so what is pinned here is that it can
// tell the three answers apart: every copy benched, the bytes failing and backed off, and nothing
// wrong at all. The last is the one worth guarding — a record inside its repeat window is a station
// working correctly and must not be drawn as a fault.

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDetail } from '@deadair/sdk';

import { TrackDetailPage } from '../../../src/components/catalog/track.detail.page';
import { render, screen } from '../../utils/render';

const getTrack = vi.fn();
const getTrackEnrichment = vi.fn();

vi.mock('../../../src/api/client', () => ({
    BASE_URL: '/api',
    sdk: {
        catalog: {
            getTrack: (...args: unknown[]) => getTrack(...args),
            getTrackEnrichment: (...args: unknown[]) => getTrackEnrichment(...args),
        },
    },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
        <a href="#" className={className}>
            {children}
        </a>
    ),
}));

const TRACK_ID = '33333333-3333-4333-8333-333333333333';

const binding = (overrides: Record<string, unknown> = {}) => ({
    sourceId: '44444444-4444-4444-8444-444444444444',
    pluginId: 'deadair.spotify',
    externalId: 'track-42',
    playable: true,
    origin: 'sync',
    attempts: 0,
    ...overrides,
});

const detail = (overrides: Partial<TrackDetail> = {}): TrackDetail =>
    ({
        id: TRACK_ID,
        title: 'Vaka',
        artistId: '11111111-1111-4111-8111-111111111111',
        artistName: 'Sigur Rós',
        artists: 'Sigur Rós',
        rating: 'neutral',
        bindings: [],
        plays: [],
        playCount: 0,
        ...overrides,
    }) as TrackDetail;

beforeEach(() => {
    getTrackEnrichment.mockResolvedValue({ trackId: TRACK_ID, merged: {}, sources: [], claims: [] });
});

afterEach(() => {
    vi.resetAllMocks();
});

describe('TrackDetailPage', () => {
    it('heads the page with the record and what it has aired', async () => {
        getTrack.mockResolvedValue(
            detail({
                albumName: '( )',
                year: 2002,
                bindings: [binding({ byteSize: 8_400_000, fetchedAt: '2026-08-14T10:00:00.000Z', format: 'ogg', bitrate: 320_000 })],
                plays: [{ airedAt: '2026-08-15T21:00:00.000Z', source: 'director' }],
                playCount: 12,
            }),
        );

        render(<TrackDetailPage trackId={TRACK_ID} />);

        expect(await screen.findByRole('heading', { name: 'Vaka' })).toBeInTheDocument();
        expect(screen.getByText('8.0 MB')).toBeInTheDocument();
        expect(screen.getByText('12 in all')).toBeInTheDocument();
        expect(screen.getByText('On this machine')).toBeInTheDocument();
    });

    // The first of the three answers. A benched copy is the station standing a copy down on purpose,
    // which is why it is not drawn as a fault.
    it('says when every copy has been benched', async () => {
        getTrack.mockResolvedValue(detail({ bindings: [binding({ missingAt: '2026-08-15T09:00:00.000Z' })] }));

        render(<TrackDetailPage trackId={TRACK_ID} />);

        expect(await screen.findByText('Benched')).toBeInTheDocument();
    });

    // The second: the bytes will not come and the station is backing off. The attempt count is on
    // the label because four consecutive failures is what writes the copy off.
    it('says when the bytes keep failing, and how many times', async () => {
        getTrack.mockResolvedValue(
            detail({
                bindings: [binding({ attempts: 3, lastError: 'upstream answered 404', nextAttemptAt: '2026-08-16T09:00:00.000Z' })],
            }),
        );

        render(<TrackDetailPage trackId={TRACK_ID} />);

        expect(await screen.findByText('Failing (3)')).toBeInTheDocument();
    });

    // The third, and the one a page like this most easily gets wrong: nothing is wrong. A copy the
    // station has simply not needed yet is most of the library.
    it('draws a copy nothing has needed yet as waiting rather than broken', async () => {
        getTrack.mockResolvedValue(detail({ bindings: [binding()] }));

        render(<TrackDetailPage trackId={TRACK_ID} />);

        expect(await screen.findByText('Not fetched')).toBeInTheDocument();
        expect(screen.queryByText(/Failing/)).not.toBeInTheDocument();
    });

    // The eviction sweep clears the file columns and keeps the row, so a record fetched once and
    // dropped since is not on this machine however recently it arrived. Keyed off the BYTES rather
    // than off `fetchedAt`, which is what a live row with the old shape showed up.
    it('tells a record whose bytes were dropped from one that is held', async () => {
        getTrack.mockResolvedValue(
            detail({ bindings: [binding({ fetchedAt: '2026-08-12T14:49:25.667Z', lastServedAt: '2026-08-12T14:49:25.667Z' })] }),
        );

        render(<TrackDetailPage trackId={TRACK_ID} />);

        expect(await screen.findByText('Dropped')).toBeInTheDocument();
        expect(screen.queryByText('On this machine')).not.toBeInTheDocument();
    });

    // `complete` is not `analyzedAt`: a measurement of a truncated download carries a date and is
    // wrong, so a row with one must not read as measured.
    it('tells an incomplete measurement from a finished one', async () => {
        getTrack.mockResolvedValue(
            detail({ analysis: { schemaVersion: 3, complete: false, analyzedAt: '2026-08-14T11:00:00.000Z', analyzer: 'sidecar 0.4' } }),
        );

        render(<TrackDetailPage trackId={TRACK_ID} />);

        expect(await screen.findByText('Incomplete')).toBeInTheDocument();
        expect(screen.queryByText('Measured')).not.toBeInTheDocument();
    });

    it('says a record has no copies at all rather than drawing an empty table', async () => {
        getTrack.mockResolvedValue(detail());

        render(<TrackDetailPage trackId={TRACK_ID} />);

        expect(await screen.findByText(/No provider holds a copy/)).toBeInTheDocument();
        expect(screen.getByText(/Nothing has measured this record yet/)).toBeInTheDocument();
        expect(screen.getByText('This record has not been on air yet.')).toBeInTheDocument();
    });

    it('says so when the record cannot be read at all', async () => {
        getTrack.mockRejectedValue(new Error('gone'));

        render(<TrackDetailPage trackId={TRACK_ID} />);

        expect(await screen.findByText('This record could not be loaded')).toBeInTheDocument();
    });
});
