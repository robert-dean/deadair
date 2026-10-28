import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { SimilarityNeighbourhoodCard } from '../../../src/components/catalog/similarity.neighbourhood.card';
import { render, screen, waitFor } from '../../utils/render';

const getSimilarityGraph = vi.fn();

vi.mock('../../../src/api/client', () => ({
    BASE_URL: '/api',
    sdk: { catalog: { getSimilarityGraph: (...args: unknown[]) => getSimilarityGraph(...args) } },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
        <a href="#" className={className}>
            {children}
        </a>
    ),
}));

const SLAYER = '11111111-1111-4111-8111-111111111111';
const KREATOR = '22222222-2222-4222-8222-222222222222';

const GRAPH = {
    nodes: [
        { key: 'slayer', name: 'Slayer', artistId: SLAYER },
        { key: 'kreator', name: 'Kreator', artistId: KREATOR },
        { key: 'exodus', name: 'Exodus' },
        { key: 'sodom', name: 'Sodom' },
    ],
    edges: [
        { from: 'slayer', to: 'exodus', rank: 3, source: 'deadair.lastfm' },
        { from: 'slayer', to: 'kreator', rank: 0, source: 'deadair.lastfm' },
        { from: 'kreator', to: 'slayer', rank: 1, source: 'deadair.lastfm' },
        // Two steps out: Kreator's, not Slayer's, so not listed as one of Slayer's own.
        { from: 'kreator', to: 'sodom', rank: 0, source: 'deadair.lastfm' },
    ],
    truncated: false,
};

const noop = () => undefined;

beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
});

describe('SimilarityNeighbourhoodCard', () => {
    it('asks for one step around the artist, and lists its own neighbours best first, linked where the library holds them', async () => {
        getSimilarityGraph.mockResolvedValue(GRAPH);

        render(<SimilarityNeighbourhoodCard artistId={SLAYER} artistName="Slayer" onOpenArtist={noop} />);

        const kreator = await screen.findByRole('link', { name: 'Kreator' });
        expect(getSimilarityGraph).toHaveBeenCalledWith({ library: false, limit: 600, around: SLAYER, depth: 1 });
        expect(screen.getByText('Exodus')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Exodus' })).not.toBeInTheDocument();
        expect(screen.queryByText('Sodom')).not.toBeInTheDocument();
        expect(kreator.compareDocumentPosition(screen.getByText('Exodus')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('asks again two steps out when told to', async () => {
        getSimilarityGraph.mockResolvedValue(GRAPH);

        render(<SimilarityNeighbourhoodCard artistId={SLAYER} artistName="Slayer" onOpenArtist={noop} />);
        await screen.findByRole('link', { name: 'Kreator' });
        await userEvent.click(screen.getByText('Two steps'));

        await waitFor(() => expect(getSimilarityGraph).toHaveBeenLastCalledWith({ library: false, limit: 600, around: SLAYER, depth: 2 }));
    });

    it('says nobody has been asked about an artist yet, by name', async () => {
        getSimilarityGraph.mockResolvedValue({ nodes: [{ key: 'slayer', name: 'Slayer', artistId: SLAYER }], edges: [], truncated: false });

        render(<SimilarityNeighbourhoodCard artistId={SLAYER} artistName="Slayer" onOpenArtist={noop} />);

        expect(await screen.findByText(/Nobody has been asked who sounds like Slayer yet/)).toBeInTheDocument();
    });
});
