// Most of this catalog has no art until the ingest and the enrichment walk have both been past, so
// the absent case is the common one and is what most of this covers.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';

import { Artwork } from '../../../src/components/catalog/artwork';
import { render, screen } from '../../utils/render';

// `artSrc` reads the API base off the client module, which drags the whole SDK and the session
// store in behind it.
vi.mock('../../../src/api/client', () => ({ BASE_URL: '/api' }));

describe('Artwork', () => {
    it('resolves the station’s own copy against the API base', () => {
        render(<Artwork src="art/11111111-1111-4111-8111-111111111111" alt="( )" size={40} />);

        expect(screen.getByRole('img', { name: '( )' })).toHaveAttribute('src', '/api/art/11111111-1111-4111-8111-111111111111');
    });

    it('hotlinks art nothing has cached yet', () => {
        render(<Artwork src="https://i.scdn.co/image/abc" alt="Ágætis byrjun" size={40} />);

        expect(screen.getByRole('img', { name: 'Ágætis byrjun' })).toHaveAttribute('src', 'https://i.scdn.co/image/abc');
    });

    it('stands in with the initial when there is no art at all', () => {
        render(<Artwork src={undefined} alt="Sigur Rós" size={40} />);

        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.getByText('S')).toBeInTheDocument();
    });

    it('counts that initial in code points, so a name that starts outside the BMP survives', () => {
        render(<Artwork alt="𝕊igur Rós" size={40} />);

        expect(screen.getByText('𝕊')).toBeInTheDocument();
    });

    // Art is hotlinked from the provider until the cache pass has the bytes, so a dead upstream is
    // an ordinary outcome rather than something to show a broken-image glyph for.
    it('falls back to the same placeholder when the image will not load', () => {
        render(<Artwork src="https://i.scdn.co/image/gone" alt="Takk..." size={40} />);

        fireEvent.error(screen.getByRole('img', { name: 'Takk...' }));

        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.getByText('T')).toBeInTheDocument();
    });
});
