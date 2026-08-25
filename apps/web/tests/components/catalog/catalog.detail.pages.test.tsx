import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SdkError } from '@deadair/sdk';

import { AlbumDetailPage } from '../../../src/components/catalog/album.detail.page';
import { ArtistDetailPage } from '../../../src/components/catalog/artist.detail.page';
import { render, screen } from '../../utils/render';
import { DEFAULT_PAGE_SIZE } from '../../../src/components/catalog/catalog.page.params';

/**
 * How a list opens, for a render that is not about the ordering.
 *
 * Every case here predates sorting and is about rows, art, counts or the pager; the order prop
 * is required because the page reads it to build its query, so it is supplied once rather than
 * spelled at twenty render sites.
 */
const ORDER = (sortBy: string) => ({ sortBy, sort: 'asc' as const, pageSize: DEFAULT_PAGE_SIZE });

const getArtist = vi.fn();
const listArtistAlbums = vi.fn();
const getAlbum = vi.fn();
const listAlbumTracks = vi.fn();
const getArtistEnrichment = vi.fn();
const getAlbumEnrichment = vi.fn();
const getTrackEnrichment = vi.fn();
const rateArtist = vi.fn();
const rateAlbum = vi.fn();

vi.mock('../../../src/api/client', () => ({
    BASE_URL: '/api',
    sdk: {
        catalog: {
            getArtist: (...args: unknown[]) => getArtist(...args),
            listArtistAlbums: (...args: unknown[]) => listArtistAlbums(...args),
            getAlbum: (...args: unknown[]) => getAlbum(...args),
            listAlbumTracks: (...args: unknown[]) => listAlbumTracks(...args),
            getArtistEnrichment: (...args: unknown[]) => getArtistEnrichment(...args),
            getAlbumEnrichment: (...args: unknown[]) => getAlbumEnrichment(...args),
            getTrackEnrichment: (...args: unknown[]) => getTrackEnrichment(...args),
            rateArtist: (...args: unknown[]) => rateArtist(...args),
            rateAlbum: (...args: unknown[]) => rateAlbum(...args),
        },
    },
}));

/** Nothing stored, which is what both detail pages open on for most of this catalog. */
const noEnrichment = <T extends string>(key: T, id: string) => ({ [key]: id, merged: {}, sources: [] });

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
        <a href="#" className={className}>
            {children}
        </a>
    ),
}));

const ARTIST_ID = '11111111-1111-4111-8111-111111111111';
const ALBUM_ID = '22222222-2222-4222-8222-222222222222';

const page = <T,>(data: T[], total = data.length) => ({ meta: { total, page: 0, pageSize: 50, sort: 'asc' }, data });

const noop = () => undefined;

beforeEach(() => {
    getArtistEnrichment.mockResolvedValue(noEnrichment('artistId', ARTIST_ID));
    getAlbumEnrichment.mockResolvedValue(noEnrichment('albumId', ALBUM_ID));
});

afterEach(() => {
    vi.resetAllMocks();
});

describe('ArtistDetailPage', () => {
    it('heads the page with the artist and lists their albums', async () => {
        getArtist.mockResolvedValue({ id: ARTIST_ID, name: 'Sigur Rós', rating: 'neutral', albumCount: 1, trackCount: 11 });
        listArtistAlbums.mockResolvedValue(
            page([{ id: ALBUM_ID, name: '( )', artistId: ARTIST_ID, artistName: 'Sigur Rós', year: 2002, rating: 'neutral', trackCount: 8 }]),
        );

        render(<ArtistDetailPage order={ORDER('name')} artistId={ARTIST_ID} page={0} onPageChange={noop} />);

        expect(await screen.findByRole('heading', { name: 'Sigur Rós' })).toBeInTheDocument();
        expect(screen.getByText('1 album • 11 tracks')).toBeInTheDocument();
        expect(await screen.findByText('( )')).toBeInTheDocument();
        expect(screen.getByText('2002')).toBeInTheDocument();
    });

    it('heads the page with the artist’s art and puts a cover against each album', async () => {
        getArtist.mockResolvedValue({ id: ARTIST_ID, name: 'Sigur Rós', rating: 'neutral', albumCount: 1, trackCount: 11, imageUrl: 'art/aaaa' });
        listArtistAlbums.mockResolvedValue(
            page([
                {
                    id: ALBUM_ID,
                    name: '( )',
                    artistId: ARTIST_ID,
                    artistName: 'Sigur Rós',
                    year: 2002,
                    rating: 'neutral',
                    trackCount: 8,
                    imageUrl: 'art/bbbb',
                },
            ]),
        );

        render(<ArtistDetailPage order={ORDER('name')} artistId={ARTIST_ID} page={0} onPageChange={noop} />);

        expect(await screen.findByRole('img', { name: 'Sigur Rós' })).toHaveAttribute('src', '/api/art/aaaa');
        expect(await screen.findByRole('img', { name: '( )' })).toHaveAttribute('src', '/api/art/bbbb');
    });

    // The widest opinion the station holds: a dislike here takes every record they are credited on
    // out of rotation, which is why it belongs on the artist rather than only on their tracks.
    it('rates the artist from the header', async () => {
        getArtist.mockResolvedValue({ id: ARTIST_ID, name: 'Sigur Rós', rating: 'neutral', albumCount: 0, trackCount: 2 });
        listArtistAlbums.mockResolvedValue(page([]));
        rateArtist.mockResolvedValue({ id: ARTIST_ID, name: 'Sigur Rós', rating: 'disliked', albumCount: 0, trackCount: 2 });

        render(<ArtistDetailPage order={ORDER('name')} artistId={ARTIST_ID} page={0} onPageChange={noop} />);
        await screen.findByRole('heading', { name: 'Sigur Rós' });

        await userEvent.click(screen.getByRole('radio', { name: 'Dislike Sigur Rós' }));

        await vi.waitFor(() => {
            expect(rateArtist).toHaveBeenCalledWith(ARTIST_ID, { rating: 'disliked' });
        });
    });

    it('rates one of the artist’s albums from its row, naming that record rather than the artist', async () => {
        getArtist.mockResolvedValue({ id: ARTIST_ID, name: 'Sigur Rós', rating: 'neutral', albumCount: 1, trackCount: 11 });
        listArtistAlbums.mockResolvedValue(
            page([{ id: ALBUM_ID, name: '( )', artistId: ARTIST_ID, artistName: 'Sigur Rós', year: 2002, rating: 'neutral', trackCount: 8 }]),
        );
        rateAlbum.mockResolvedValue({ id: ALBUM_ID, name: '( )', artistId: ARTIST_ID, artistName: 'Sigur Rós', rating: 'liked', trackCount: 8 });

        render(<ArtistDetailPage order={ORDER('name')} artistId={ARTIST_ID} page={0} onPageChange={noop} />);
        await screen.findByText('( )');

        await userEvent.click(screen.getByRole('radio', { name: 'Like ( )' }));

        await vi.waitFor(() => {
            expect(rateAlbum).toHaveBeenCalledWith(ALBUM_ID, { rating: 'liked' });
        });
    });

    it('says an artist with no albums may still have tracks, rather than implying they have nothing', async () => {
        getArtist.mockResolvedValue({ id: ARTIST_ID, name: 'Sigur Rós', rating: 'neutral', albumCount: 0, trackCount: 2 });
        listArtistAlbums.mockResolvedValue(page([]));

        render(<ArtistDetailPage order={ORDER('name')} artistId={ARTIST_ID} page={0} onPageChange={noop} />);

        expect(await screen.findByText(/Their tracks may still be in the catalog/)).toBeInTheDocument();
    });

    it('shows what the providers said about the artist, and who said it', async () => {
        getArtist.mockResolvedValue({ id: ARTIST_ID, name: 'Sigur Rós', rating: 'neutral', albumCount: 0, trackCount: 2 });
        listArtistAlbums.mockResolvedValue(page([]));
        getArtistEnrichment.mockResolvedValue({
            artistId: ARTIST_ID,
            merged: { facts: ['Sigur Rós formed in Reykjavík in 1994.'], genres: ['post-rock'] },
            sources: [{ provider: 'deadair.musicbrainz', fetchedAt: '2026-08-02T09:00:00.000Z', stale: false, found: true, data: {} }],
        });

        render(<ArtistDetailPage order={ORDER('name')} artistId={ARTIST_ID} page={0} onPageChange={noop} />);

        expect(await screen.findByText('Sigur Rós formed in Reykjavík in 1994.')).toBeInTheDocument();
        expect(screen.getByText('post-rock')).toBeInTheDocument();
        expect(screen.getByText(/deadair\.musicbrainz/)).toBeInTheDocument();
    });

    it('says the walk has not reached an artist yet, rather than showing an empty panel', async () => {
        getArtist.mockResolvedValue({ id: ARTIST_ID, name: 'Sigur Rós', rating: 'neutral', albumCount: 0, trackCount: 2 });
        listArtistAlbums.mockResolvedValue(page([]));

        render(<ArtistDetailPage order={ORDER('name')} artistId={ARTIST_ID} page={0} onPageChange={noop} />);

        expect(await screen.findByText(/No provider has been asked about this artist yet/)).toBeInTheDocument();
    });

    it('turns a 404 on the artist into an alert, without also blaming the album list', async () => {
        getArtist.mockRejectedValue(new SdkError(404, 'Not Found', { statusCode: 404, message: 'artist is not in the catalog' }, new Headers()));
        listArtistAlbums.mockResolvedValue(page([]));

        render(<ArtistDetailPage order={ORDER('name')} artistId={ARTIST_ID} page={0} onPageChange={noop} />);

        expect(await screen.findByText('This artist could not be loaded')).toBeInTheDocument();
        expect(screen.queryByText('The albums could not be loaded')).not.toBeInTheDocument();
    });
});

describe('AlbumDetailPage', () => {
    it('heads the page with the album and lists its tracks with durations', async () => {
        getAlbum.mockResolvedValue({ id: ALBUM_ID, name: '( )', artistId: ARTIST_ID, artistName: 'Sigur Rós', year: 2002, rating: 'neutral', trackCount: 1 });
        listAlbumTracks.mockResolvedValue(
            page([
                {
                    id: '33333333-3333-4333-8333-333333333333',
                    title: 'Vaka',
                    artistId: ARTIST_ID,
                    artistName: 'Sigur Rós',
                    albumId: ALBUM_ID,
                    albumName: '( )',
                    artists: 'Sigur Rós',
                    durationMs: 394_000,
                    rating: 'neutral',
                },
            ]),
        );

        render(<AlbumDetailPage order={ORDER('title')} albumId={ALBUM_ID} page={0} onPageChange={noop} />);

        expect(await screen.findByRole('heading', { name: '( )' })).toBeInTheDocument();
        expect(await screen.findByText('Vaka')).toBeInTheDocument();
        expect(screen.getByText('6:34')).toBeInTheDocument();
        expect(screen.getByText('Back to Sigur Rós')).toBeInTheDocument();
    });

    it('heads the page with the cover, and with an initial for a record that has none', async () => {
        getAlbum.mockResolvedValue({ id: ALBUM_ID, name: '( )', artistId: ARTIST_ID, artistName: 'Sigur Rós', rating: 'neutral', trackCount: 0 });
        listAlbumTracks.mockResolvedValue(page([]));

        render(<AlbumDetailPage order={ORDER('title')} albumId={ALBUM_ID} page={0} onPageChange={noop} />);

        expect(await screen.findByText('(')).toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    // The label and the pressing belong to the release rather than to any track on it, which is
    // why the album has an enrichment of its own at all.
    it('shows the record’s own enrichment under the header', async () => {
        getAlbum.mockResolvedValue({ id: ALBUM_ID, name: '( )', artistId: ARTIST_ID, artistName: 'Sigur Rós', rating: 'neutral', trackCount: 0 });
        listAlbumTracks.mockResolvedValue(page([]));
        getAlbumEnrichment.mockResolvedValue({
            albumId: ALBUM_ID,
            merged: { label: 'Fat Cat', releaseDate: '2002-10-28' },
            sources: [{ provider: 'deadair.musicbrainz', fetchedAt: '2026-08-02T09:00:00.000Z', stale: true, found: true, data: {} }],
        });

        render(<AlbumDetailPage order={ORDER('title')} albumId={ALBUM_ID} page={0} onPageChange={noop} />);

        expect(await screen.findByText('Fat Cat')).toBeInTheDocument();
        expect(screen.getByText('2002-10-28')).toBeInTheDocument();
        expect(screen.getByText(/due again/)).toBeInTheDocument();
    });

    it('renders a track with no duration as a blank cell rather than 0:00', async () => {
        getAlbum.mockResolvedValue({ id: ALBUM_ID, name: '( )', artistId: ARTIST_ID, artistName: 'Sigur Rós', rating: 'neutral', trackCount: 1 });
        listAlbumTracks.mockResolvedValue(
            page([
                {
                    id: '33333333-3333-4333-8333-333333333333',
                    title: 'Untitled',
                    artistId: ARTIST_ID,
                    artistName: 'Sigur Rós',
                    albumId: ALBUM_ID,
                    albumName: '( )',
                    artists: 'Sigur Rós',
                    rating: 'neutral',
                },
            ]),
        );

        render(<AlbumDetailPage order={ORDER('title')} albumId={ALBUM_ID} page={0} onPageChange={noop} />);

        expect(await screen.findByText('Untitled')).toBeInTheDocument();
        expect(screen.queryByText('0:00')).not.toBeInTheDocument();
    });

    it('falls back to the catalog link while the album is still unknown', async () => {
        getAlbum.mockRejectedValue(new SdkError(404, 'Not Found', { statusCode: 404, message: 'album is not in the catalog' }, new Headers()));
        listAlbumTracks.mockResolvedValue(page([]));

        render(<AlbumDetailPage order={ORDER('title')} albumId={ALBUM_ID} page={0} onPageChange={noop} />);

        expect(await screen.findByText('This album could not be loaded')).toBeInTheDocument();
        expect(screen.getByText('Back to catalog')).toBeInTheDocument();
    });
});
