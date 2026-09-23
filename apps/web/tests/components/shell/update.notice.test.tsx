// The header's update notice. Pinned: it is drawn only when a newer release is out, it names the
// newest one and goes to What's new, and a signed-out shell asks the station nothing.

import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UpdateNotice } from '../../../src/components/shell/update.notice';
import { render, screen, waitFor } from '../../utils/render';

const readStationReleases = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: { station: { readStationReleases: () => readStationReleases() } },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, ...rest }: { to?: string; children?: ReactNode }) => (
        <a href={to} {...rest}>
            {children}
        </a>
    ),
}));

const newer = (version: string) => ({ version, notes: '', url: `https://github.com/robert-dean/deadair/releases/tag/v${version}` });

afterEach(() => {
    readStationReleases.mockReset();
});

describe('UpdateNotice', () => {
    it('names the newest release out and goes to What’s new', async () => {
        readStationReleases.mockResolvedValue({ checks: true, notes: [], available: [newer('0.28.0'), newer('0.27.0')] });

        render(<UpdateNotice enabled />);

        const link = await screen.findByRole('link', { name: /0\.28\.0\s+is out/ });
        expect(link).toHaveAttribute('href', '/releases');
        expect(screen.queryByText('0.27.0')).not.toBeInTheDocument();
    });

    it('draws nothing when there is nothing newer', async () => {
        readStationReleases.mockResolvedValue({ checks: true, notes: [], available: [] });

        const { container } = render(<UpdateNotice enabled />);

        await waitFor(() => expect(readStationReleases).toHaveBeenCalled());
        expect(container.querySelector('a')).toBeNull();
    });

    it('asks nothing while nobody is signed in', () => {
        render(<UpdateNotice enabled={false} />);

        expect(readStationReleases).not.toHaveBeenCalled();
    });
});
