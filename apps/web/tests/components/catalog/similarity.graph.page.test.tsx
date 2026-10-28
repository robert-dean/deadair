import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { SimilarityGraphPage } from '../../../src/components/catalog/similarity.graph.page';
import { render, screen } from '../../utils/render';

const getSimilarityGraph = vi.fn();

vi.mock('../../../src/api/client', () => ({
    BASE_URL: '/api',
    sdk: { catalog: { getSimilarityGraph: (...args: unknown[]) => getSimilarityGraph(...args) } },
}));

// The page's own behaviour is under test; the routing of its artist links is the route tests'.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
        <a href="#" className={className}>
            {children}
        </a>
    ),
}));

const SLAYER = '11111111-1111-4111-8111-111111111111';

const GRAPH = {
    nodes: [
        { key: 'slayer', name: 'Slayer', artistId: SLAYER },
        { key: 'kreator', name: 'Kreator' },
        { key: 'sodom', name: 'Sodom' },
    ],
    edges: [
        { from: 'slayer', to: 'kreator', rank: 0, source: 'deadair.lastfm' },
        { from: 'kreator', to: 'slayer', rank: 0, source: 'deadair.lastfm' },
        { from: 'slayer', to: 'sodom', rank: 1, source: 'deadair.deezer' },
    ],
    truncated: false,
};

const noop = () => undefined;

// jsdom has no 2D context and says so on every draw; the drawing itself is not what is tested here.
beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
});

describe('SimilarityGraphPage', () => {
    it('asks for the whole store, folds both directions of a pair into one connection, and names the hubs', async () => {
        getSimilarityGraph.mockResolvedValue(GRAPH);

        render(<SimilarityGraphPage library={false} onLibraryChange={noop} onOpenArtist={noop} />);

        expect(await screen.findByText('3 artists')).toBeInTheDocument();
        expect(screen.getByText('2 connections')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'A map of 3 artists and 2 connections between them' })).toBeInTheDocument();
        expect(getSimilarityGraph).toHaveBeenCalledWith({ library: false, limit: 600 });
        // Slayer is in the library, so it is a link; Kreator is only named by a source, so it is not.
        expect(screen.getByRole('link', { name: 'Slayer' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Kreator' })).not.toBeInTheDocument();
        expect(screen.getByText('Kreator')).toBeInTheDocument();
    });

    it('says when the answer was cut', async () => {
        getSimilarityGraph.mockResolvedValue({ ...GRAPH, truncated: true });

        render(<SimilarityGraphPage library={false} onLibraryChange={noop} onOpenArtist={noop} />);

        expect(await screen.findByText('Showing the strongest 600 connections. There are more.')).toBeInTheDocument();
    });

    it('explains an empty store rather than drawing nothing', async () => {
        getSimilarityGraph.mockResolvedValue({ nodes: [], edges: [], truncated: false });

        render(<SimilarityGraphPage library={false} onLibraryChange={noop} onOpenArtist={noop} />);

        expect(await screen.findByText('Nothing is stored yet')).toBeInTheDocument();
    });

    it('says the library has no connections of its own, and how to see the rest', async () => {
        getSimilarityGraph.mockResolvedValue({ nodes: [], edges: [], truncated: false });

        render(<SimilarityGraphPage library onLibraryChange={noop} onOpenArtist={noop} />);

        expect(await screen.findByText('No connections inside the library')).toBeInTheDocument();
        expect(getSimilarityGraph).toHaveBeenCalledWith({ library: true, limit: 600 });
    });

    it('hands the library switch to the route', async () => {
        getSimilarityGraph.mockResolvedValue(GRAPH);
        const onLibraryChange = vi.fn();

        render(<SimilarityGraphPage library={false} onLibraryChange={onLibraryChange} onOpenArtist={noop} />);
        await userEvent.click(screen.getByRole('switch', { name: 'Only artists in the library' }));

        expect(onLibraryChange).toHaveBeenCalledWith(true);
    });
});
