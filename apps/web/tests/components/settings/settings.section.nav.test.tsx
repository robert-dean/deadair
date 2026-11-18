import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { sectionMatches, SettingsSectionNav } from '../../../src/components/settings/settings.section.nav';
import { render, setupUser } from '../../utils/render';

vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    Link: ({ to, children, ...props }: { to: string; children?: React.ReactNode }) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
}));

describe('sectionMatches', () => {
    it('matches a name or the sentence saying what a section holds, ignoring case', () => {
        const words = { label: 'Words', hint: 'The model that writes the breaks' };
        expect(sectionMatches(words, 'MODEL')).toBe(true);
        expect(sectionMatches(words, 'word')).toBe(true);
        expect(sectionMatches(words, 'mount')).toBe(false);
        expect(sectionMatches(words, '  ')).toBe(true);
    });
});

describe('SettingsSectionNav', () => {
    it('lists the sections under their group headings, the one being read lit', () => {
        render(<SettingsSectionNav active="stream" />);

        expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
        expect(screen.getByText('Sign-in and people')).toBeInTheDocument();
        const stream = screen.getByRole('link', { name: 'Stream' });
        expect(stream).toHaveAttribute('href', '/settings/stream');
        expect(stream).toHaveAttribute('data-active', 'true');
        expect(screen.getByRole('link', { name: 'Plugins' })).toHaveAttribute('href', '/plugins');
    });

    it('narrows the list to what is typed, and says so when nothing is left', async () => {
        const user = setupUser();
        render(<SettingsSectionNav />);

        await user.type(screen.getByRole('textbox', { name: 'Find a section' }), 'stream');
        expect(screen.getByRole('link', { name: 'Stream' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Languages' })).not.toBeInTheDocument();

        await user.clear(screen.getByRole('textbox', { name: 'Find a section' }));
        await user.type(screen.getByRole('textbox', { name: 'Find a section' }), 'zzzz');
        expect(screen.getByText('No section matches.')).toBeInTheDocument();
    });
});
