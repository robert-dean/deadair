import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { CatalogTracksPage } from '../../../src/components/catalog/catalog.tracks.page';
import { render, screen } from '../../utils/render';

const listTracks = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: { catalog: { listTracks: (...args: unknown[]) => listTracks(...args) } },
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
    rating: 0,
    ...overrides,
});

const page = (data: unknown[], total = data.length) => ({ meta: { total, page: 0, pageSize: 50, sort: 'asc' }, data });

const noop = () => undefined;

afterEach(() => {
    vi.resetAllMocks();
});

describe('CatalogTracksPage', () => {
    it('renders the title, artist, album and duration of each track', async () => {
        listTracks.mockResolvedValue(page([track()]));

        render(<CatalogTracksPage page={0} search="" onPageChange={noop} onSearchChange={noop} />);

        expect(await screen.findByText('Vaka')).toBeInTheDocument();
        expect(screen.getByText('Sigur Rós')).toBeInTheDocument();
        expect(screen.getByText('( )')).toBeInTheDocument();
        expect(screen.getByText('6:34')).toBeInTheDocument();
    });

    it('leaves the album cell blank for a track ingested outside any release', async () => {
        listTracks.mockResolvedValue(page([track({ albumId: undefined, albumName: undefined, title: 'Untitled' })]));

        render(<CatalogTracksPage page={0} search="" onPageChange={noop} onSearchChange={noop} />);

        // The row renders at all, which is the point: an earlier contract required `albumId` and
        // this row took the whole page down with it.
        expect(await screen.findByText('Untitled')).toBeInTheDocument();
        expect(screen.getAllByRole('link')).toHaveLength(2); // back to catalog, and the artist
    });

    it('blames the search term when one is set and nothing matched', async () => {
        listTracks.mockResolvedValue(page([]));

        render(<CatalogTracksPage page={0} search="zzz" onPageChange={noop} onSearchChange={noop} />);

        expect(await screen.findByText('Nothing matches “zzz”')).toBeInTheDocument();
    });

    it('surfaces a failed read as an alert', async () => {
        listTracks.mockRejectedValue(new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'no' }, new Headers()));

        render(<CatalogTracksPage page={0} search="" onPageChange={noop} onSearchChange={noop} />);

        expect(await screen.findByText('The tracks could not be loaded')).toBeInTheDocument();
    });
});
