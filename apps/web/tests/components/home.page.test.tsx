import { describe, expect, it } from 'vitest';

import { HomePage } from '../../src/components/home.page';
import { render, screen } from '../utils/render';

describe('HomePage', () => {
    it('renders the station name as the page heading', () => {
        render(<HomePage />);

        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('deadair');
    });

    it('shows the off-air badge', () => {
        render(<HomePage />);

        expect(screen.getByText('off air')).toBeInTheDocument();
    });
});
