import { describe, expect, it } from 'vitest';

import { AuthoredBadge } from '../../../src/components/shared/authored.badge';
import { render, screen } from '../../utils/render';

describe('AuthoredBadge', () => {
    it("draws the station's authored mark, and a person's work in the neutral grey", () => {
        render(
            <>
                <AuthoredBadge>written</AuthoredBadge>
                <AuthoredBadge authored={false}>typed</AuthoredBadge>
            </>,
        );

        expect(screen.getByText('written').closest('.mantine-Badge-root')).toHaveAttribute('data-variant', 'light');
        expect(screen.getByText('written').closest('.mantine-Badge-root')?.getAttribute('style')).toContain('grape');
        expect(screen.getByText('typed').closest('.mantine-Badge-root')?.getAttribute('style')).toContain('gray');
    });

    it('passes size and layout through', () => {
        render(
            <AuthoredBadge size="xs" style={{ flexShrink: 0 }}>
                break
            </AuthoredBadge>,
        );

        const root = screen.getByText('break').closest('.mantine-Badge-root');
        expect(root).toHaveAttribute('data-size', 'xs');
        expect(root?.getAttribute('style')).toContain('flex-shrink: 0');
    });
});
