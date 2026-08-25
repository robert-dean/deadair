// Who was on a programme, which is the question this page could not answer before there were
// callers. It is drawn from the STORED cast rather than resolved fresh: the character may have been
// edited or deleted since, and what an operator reads back should be what the turns were written as.

import { describe, expect, it, vi } from 'vitest';
import type { Production } from '@deadair/sdk';

import { ProductionsPage } from '../../../src/components/productions/productions.page';
import { render, screen } from '../../utils/render';

const production = (over: Partial<Production> = {}): Production =>
    ({
        id: 'p1',
        kind: 'callin',
        title: 'Open line',
        writingMode: 'outlined',
        targetMs: 180_000,
        state: 'ready',
        beats: 7,
        cast: [],
        createdAt: '2026-08-25T12:00:00.000Z',
        ...over,
    }) as unknown as Production;

const listed: Production[] = [];

vi.mock('../../../src/api/client', () => ({
    sdk: {
        productions: { listProductions: () => Promise.resolve({ productions: listed }) },
        personas: { listPersonas: () => Promise.resolve({ personas: [] }) },
    },
}));

const show = (...productions: Production[]) => {
    listed.splice(0, listed.length, ...productions);
    render(<ProductionsPage />);
};

describe('the cast on a production', () => {
    it('names the presenter and whoever rang in', async () => {
        show(
            production({
                cast: [
                    { role: 'host', name: 'Ray', persona: 'classic' },
                    { role: 'caller', name: 'Dale', persona: 'theorist' },
                ],
            }),
        );

        expect(await screen.findByText('presented by Ray, with Dale')).toBeInTheDocument();
    });

    it('says nothing for a programme one voice read', async () => {
        // A cast of one is every production the station made before callers, and a line saying
        // "presented by" on every card is a line nobody reads on any of them.
        show(production({ cast: [{ role: 'host', name: 'Ray', persona: 'classic' }] }));

        expect(await screen.findByText('Open line')).toBeInTheDocument();
        expect(screen.queryByText(/presented by/)).not.toBeInTheDocument();
    });
});
