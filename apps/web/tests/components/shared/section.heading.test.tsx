import { describe, expect, it } from 'vitest';

import { SectionHeading } from '../../../src/components/shared/section.heading';
import { render, screen } from '../../utils/render';

describe('SectionHeading', () => {
    it('is a level two heading, whatever size it is drawn at', () => {
        render(<SectionHeading title="Storage" />);

        expect(screen.getByRole('heading', { level: 2, name: 'Storage' })).toBeInTheDocument();
    });

    it('sets the sentence under the title', () => {
        render(<SectionHeading title="Storage" description="What the station holds." />);

        expect(screen.getByText('What the station holds.')).toBeInTheDocument();
    });
});
