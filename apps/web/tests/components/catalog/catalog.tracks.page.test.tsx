import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SdkError } from '@deadair/sdk';

import { CatalogTracksPage } from '../../../src/components/catalog/catalog.tracks.page';
import { render, screen, waitFor } from '../../utils/render';

const listTracks = vi.fn();
const getTrackEnrichment = vi.fn();
const rateTrack = vi.fn();

vi.mock('../../../src/api/client', () => ({
    BASE_URL: '/api',
    sdk: {
        catalog: {
            listTracks: (...args: unknown[]) => listTracks(...args),
            getTrackEnrichment: (...args: unknown[]) => getTrackEnrichment(...args),
            rateTrack: (...args: unknown[]) => rateTrack(...args),
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

const ARTIST_ID = '11111111-1111-4111-8111-111111111111';
const ALBUM_ID = '22222222-2222-4222-8222-222222222222';

const track = (overrides: Record<string, unknown> = {}) => ({
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Vaka',
    artistId: ARTIST_ID,
    artistName: 'Sigur Rós',
    albumId: ALBUM_ID,
    albumName: '( )',
    artists: 'Sigur Rós',
    durationMs: 394_000,
    rating: 'neutral',
    // The three facts a LIST row carries about what the station has of the record.
    hasAudio: false,
    measured: false,
    enriched: false,
    ...overrides,
});

const counts = (overrides: Record<string, number> = {}) => ({ total: 1, cached: 0, measured: 0, enriched: 0, benched: 0, failing: 0, ...overrides });

const page = (data: unknown[], total = data.length, states = counts({ total })) => ({
    meta: { total, page: 0, pageSize: 50, sort: 'asc' },
    data,
    states,
});

const noop = () => undefined;

afterEach(() => {
    vi.resetAllMocks();
});

describe('CatalogTracksPage', () => {
    // A recording has no art of its own, so the thumbnail is the record's, and a single filed
    // outside any release has none to borrow.
    it('shows the record’s cover against a track, and nothing against one that has no record', async () => {
        listTracks.mockResolvedValue(
            page([
                track({ albumImageUrl: 'https://i.scdn.co/image/abc' }),
                track({ id: 'b', title: 'Untitled', albumId: undefined, albumName: undefined, albumImageUrl: undefined }),
            ]),
        );

        render(<CatalogTracksPage page={0} search="" state="" onPageChange={noop} onSearchChange={noop} onStateChange={noop} />);

        expect(await screen.findByRole('img', { name: '( )' })).toHaveAttribute('src', 'https://i.scdn.co/image/abc');
        expect(screen.queryByRole('img', { name: 'Untitled' })).not.toBeInTheDocument();
    });

    it('renders the title, artist, album and duration of each track', async () => {
        listTracks.mockResolvedValue(page([track()]));

        render(<CatalogTracksPage page={0} search="" state="" onPageChange={noop} onSearchChange={noop} onStateChange={noop} />);

        expect(await screen.findByText('Vaka')).toBeInTheDocument();
        expect(screen.getByText('Sigur Rós')).toBeInTheDocument();
        expect(screen.getByText('( )')).toBeInTheDocument();
        expect(screen.getByText('6:34')).toBeInTheDocument();
    });

    it('leaves the album cell blank for a track ingested outside any release', async () => {
        listTracks.mockResolvedValue(page([track({ albumId: undefined, albumName: undefined, title: 'Untitled' })]));

        render(<CatalogTracksPage page={0} search="" state="" onPageChange={noop} onSearchChange={noop} onStateChange={noop} />);

        // The row renders at all, which is the point: an earlier contract required `albumId` and
        // this row took the whole page down with it.
        expect(await screen.findByText('Untitled')).toBeInTheDocument();
        // Back to catalog, the artist, and the title itself — which links to what that record has
        // accumulated. The album cell stays empty rather than becoming a fourth.
        expect(screen.getAllByRole('link')).toHaveLength(3);
    });

    it('blames the search term when one is set and nothing matched', async () => {
        listTracks.mockResolvedValue(page([]));

        render(<CatalogTracksPage page={0} search="zzz" state="" onPageChange={noop} onSearchChange={noop} onStateChange={noop} />);

        expect(await screen.findByText('Nothing matches “zzz”')).toBeInTheDocument();
    });

    // A page of fifty tracks would be fifty enrichment requests if the rows fetched on render, so
    // the panel is not mounted until the operator opens one.
    it('asks for a track’s enrichment only once its row is opened', async () => {
        listTracks.mockResolvedValue(page([track()]));
        getTrackEnrichment.mockResolvedValue({
            trackId: '33333333-3333-4333-8333-333333333333',
            merged: { label: 'Fat Cat' },
            sources: [
                { provider: 'deadair.musicbrainz', fetchedAt: '2026-08-02T09:00:00.000Z', stale: false, found: true, data: { label: 'Fat Cat' } },
            ],
        });

        render(<CatalogTracksPage page={0} search="" state="" onPageChange={noop} onSearchChange={noop} onStateChange={noop} />);
        await screen.findByText('Vaka');

        expect(getTrackEnrichment).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'Show what is known about Vaka' }));

        await waitFor(() => {
            expect(getTrackEnrichment).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333');
        });
        expect(await screen.findByText('Fat Cat')).toBeInTheDocument();
    });

    // The flat list is where an operator forms most of these opinions, so it has to be ratable
    // without a navigation each way.
    it('rates a track from its row and sends what was picked', async () => {
        listTracks.mockResolvedValue(page([track()]));
        rateTrack.mockResolvedValue(track({ rating: 'liked' }));

        render(<CatalogTracksPage page={0} search="" state="" onPageChange={noop} onSearchChange={noop} onStateChange={noop} />);
        await screen.findByText('Vaka');

        await userEvent.click(screen.getByRole('radio', { name: 'Like Vaka' }));

        await waitFor(() => {
            expect(rateTrack).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333', { rating: 'liked' });
        });
    });

    // The aggregate is what an operator reads first: "13 of 919 measured" was a psql query before
    // this, and it is the sentence two of the todo files were written to answer.
    it('says how much of the library is in each state', async () => {
        listTracks.mockResolvedValue(page([track()], 919, counts({ total: 919, cached: 345, measured: 216, failing: 4 })));

        render(<CatalogTracksPage page={0} search="" state="" onPageChange={noop} onSearchChange={noop} onStateChange={noop} />);

        expect(await screen.findByText('919 records')).toBeInTheDocument();
        expect(screen.getByText('345')).toBeInTheDocument();
        // The unmeasured chip counts the COMPLEMENT of what the API reports, because the filter an
        // operator wants is the records the walk has not reached.
        expect(screen.getByText('703')).toBeInTheDocument();
    });

    it('asks for one state when a filter is chosen, and says which is chosen', async () => {
        const onStateChange = vi.fn();
        listTracks.mockResolvedValue(page([track()], 4, counts({ total: 4, failing: 4 })));

        render(<CatalogTracksPage page={0} search="" state="failing" onPageChange={noop} onSearchChange={noop} onStateChange={onStateChange} />);
        await screen.findByText('Vaka');

        expect(listTracks).toHaveBeenCalledWith(expect.objectContaining({ state: 'failing' }));
        expect(screen.getByRole('checkbox', { name: /Failing/ })).toBeChecked();
    });

    // Zero benched records is a fact worth seeing, so the chip is drawn and disabled rather than
    // hidden: a filter list that changed shape as the numbers moved would be unreadable.
    it('keeps a filter with nothing behind it on the strip', async () => {
        listTracks.mockResolvedValue(page([track()], 10, counts({ total: 10, benched: 0 })));

        render(<CatalogTracksPage page={0} search="" state="" onPageChange={noop} onSearchChange={noop} onStateChange={noop} />);

        expect(await screen.findByRole('checkbox', { name: /Benched/ })).toBeDisabled();
    });

    it('marks each row with what the station has of it', async () => {
        listTracks.mockResolvedValue(page([track({ hasAudio: true, measured: false, enriched: true })]));

        render(<CatalogTracksPage page={0} search="" state="" onPageChange={noop} onSearchChange={noop} onStateChange={noop} />);

        expect(await screen.findByLabelText('audio on this machine')).toBeInTheDocument();
        expect(screen.getByLabelText('measured')).toBeInTheDocument();
        expect(screen.getByLabelText('described by a provider')).toBeInTheDocument();
    });

    it('surfaces a failed read as an alert', async () => {
        listTracks.mockRejectedValue(new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'no' }, new Headers()));

        render(<CatalogTracksPage page={0} search="" state="" onPageChange={noop} onSearchChange={noop} onStateChange={noop} />);

        expect(await screen.findByText('The tracks could not be loaded')).toBeInTheDocument();
    });
});
