// The one judgement these components make is whether there is anywhere to go. Everything else is
// Mantine drawing an anchor, so what is tested here is the split: an id draws a link to the right
// path, and no id draws the same words as text rather than a link that would answer 404.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AlbumLink, ArtistLink, TrackLink } from '../../../src/components/shared/catalog.links';
import { render, screen } from '../../utils/render';

// The convention every test touching a routed component follows: the real Link needs a router
// context this render helper deliberately does not build. The href is composed here so the
// assertions below can read the path and its params.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, params, children, ...rest }: { to: string; params?: Record<string, string>; children?: ReactNode }) => (
        <a href={Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)} {...rest}>
            {children}
        </a>
    ),
}));

describe('catalog links', () => {
    it('takes a record to its own page', () => {
        render(<TrackLink id="trk_1">Vaka</TrackLink>);

        expect(screen.getByRole('link', { name: 'Vaka' })).toHaveAttribute('href', '/catalog/tracks/trk_1');
    });

    it('takes an artist to theirs', () => {
        render(<ArtistLink id="art_1">Sigur Rós</ArtistLink>);

        expect(screen.getByRole('link', { name: 'Sigur Rós' })).toHaveAttribute('href', '/catalog/artists/art_1');
    });

    it('takes an album to its tracks', () => {
        render(<AlbumLink id="alb_1">( )</AlbumLink>);

        expect(screen.getByRole('link', { name: '( )' })).toHaveAttribute('href', '/catalog/albums/alb_1');
    });

    // The whole reason the id is optional: a station can air a record the catalog has never seen,
    // and a track can be ingested outside any release. Both must read as words rather than as a
    // link into nothing.
    it('draws words rather than a link when there is nowhere to go', () => {
        render(
            <>
                <TrackLink>Something nobody ingested</TrackLink>
                <ArtistLink>Nobody</ArtistLink>
                <AlbumLink>No release</AlbumLink>
            </>,
        );

        expect(screen.getByText('Something nobody ingested')).toBeInTheDocument();
        expect(screen.getByText('Nobody')).toBeInTheDocument();
        expect(screen.getByText('No release')).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});
