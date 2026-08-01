import { describe, expect, it } from 'vitest';

import { AboutPage } from '../../src/components/about.page';
import { render, screen } from '../utils/render';

describe('AboutPage', () => {
    it('renders its heading', () => {
        render(<AboutPage />);

        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('About');
    });
});
