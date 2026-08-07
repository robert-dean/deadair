import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SdkError } from '@deadair/sdk';

import { CatalogArtistsPage } from '../../../src/components/catalog/catalog.artists.page';
import { render, screen, waitFor } from '../../utils/render';

const listArtists = vi.fn();

vi.mock('../../../src/api/client', () => ({
    BASE_URL: '/api',
    sdk: { catalog: { listArtists: (...args: unknown[]) => listArtists(...args) } },
}));

// Rendering a real `Link` needs a router around it. What matters here is the page's own behaviour,
// so the link becomes a plain anchor and the routing is covered by the route tests.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
        <a href="#" className={className}>
            {children}
        </a>
    ),
}));

const artist = (overrides: Partial<{ id: string; name: string; albumCount: number; trackCount: number; imageUrl: string }> = {}) => ({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Sigur Rós',
    rating: 0,
    albumCount: 3,
    trackCount: 41,
    ...overrides,
});

const page = (data: ReturnType<typeof artist>[], total = data.length) => ({
    meta: { total, page: 0, pageSize: 50, sort: 'asc' },
    data,
});

const noop = () => undefined;

afterEach(() => {
    vi.resetAllMocks();
});

describe('CatalogArtistsPage', () => {
    it('renders a row per artist with its counts', async () => {
        listArtists.mockResolvedValue(page([artist(), artist({ id: 'b', name: 'Mogwai', albumCount: 9, trackCount: 104 })]));

        render(<CatalogArtistsPage page={0} search="" onPageChange={noop} onSearchChange={noop} />);

        expect(await screen.findByText('Sigur Rós')).toBeInTheDocument();
        expect(screen.getByText('Mogwai')).toBeInTheDocument();
        expect(screen.getByText('104')).toBeInTheDocument();
    });

    it('shows an artist’s art, and stands in with an initial for one who has none', async () => {
        listArtists.mockResolvedValue(page([artist({ imageUrl: 'art/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), artist({ id: 'b', name: 'Mogwai' })]));

        render(<CatalogArtistsPage page={0} search="" onPageChange={noop} onSearchChange={noop} />);

        expect(await screen.findByRole('img', { name: 'Sigur Rós' })).toHaveAttribute('src', '/api/art/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        expect(screen.queryByRole('img', { name: 'Mogwai' })).not.toBeInTheDocument();
        expect(screen.getByText('M')).toBeInTheDocument();
    });

    it('says the catalog is empty, not that a search missed, when nothing has been ingested', async () => {
        listArtists.mockResolvedValue(page([]));

        render(<CatalogArtistsPage page={0} search="" onPageChange={noop} onSearchChange={noop} />);

        expect(await screen.findByText('The catalog is empty')).toBeInTheDocument();
    });

    it('blames the search term when one is set and nothing matched', async () => {
        listArtists.mockResolvedValue(page([]));

        render(<CatalogArtistsPage page={0} search="zzz" onPageChange={noop} onSearchChange={noop} />);

        expect(await screen.findByText('Nothing matches “zzz”')).toBeInTheDocument();
    });

    it('surfaces a failed read as an alert rather than an empty catalog', async () => {
        listArtists.mockRejectedValue(
            new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'the database is unreachable' }, new Headers()),
        );

        render(<CatalogArtistsPage page={0} search="" onPageChange={noop} onSearchChange={noop} />);

        expect(await screen.findByText('The catalog could not be loaded')).toBeInTheDocument();
        expect(screen.queryByText('The catalog is empty')).not.toBeInTheDocument();
    });

    it('reports the total rather than the size of the page it is showing', async () => {
        listArtists.mockResolvedValue(page([artist()], 812));

        render(<CatalogArtistsPage page={0} search="" onPageChange={noop} onSearchChange={noop} />);

        expect(await screen.findByText('812 results')).toBeInTheDocument();
    });

    it('commits a typed search once, after the debounce, rather than per keystroke', async () => {
        listArtists.mockResolvedValue(page([artist()]));
        const onSearchChange = vi.fn();

        render(<CatalogArtistsPage page={0} search="" onPageChange={noop} onSearchChange={onSearchChange} />);
        await screen.findByText('Sigur Rós');

        await userEvent.type(screen.getByLabelText('Search artists'), 'sig');

        await waitFor(() => {
            expect(onSearchChange).toHaveBeenCalledWith('sig');
        });
        expect(onSearchChange).toHaveBeenCalledTimes(1);
    });
});
