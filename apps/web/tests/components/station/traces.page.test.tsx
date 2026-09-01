// What the traces page owes a phone: the same forest, as cards. The tree walk, the drawer and the
// only-failures filter all belong to the page and are exercised through the desktop table
// elsewhere in their own units; these cases pin the card branch, where the row's click becomes the
// whole card and the causal indent survives the loss of the table.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { TracesPage } from '../../../src/components/station/traces.page';
import { stubPhoneMedia } from '../../utils/phone';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const readTraces = vi.fn();
const readTrace = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        station: {
            readTraces: (...args: unknown[]) => readTraces(...args),
            readTrace: (...args: unknown[]) => readTrace(...args),
        },
    },
}));

const decision = (over: Record<string, unknown> = {}) => ({
    id: 'aaaaaaaa-1111-4111-8111-111111111111',
    kind: 'enrichment.walk',
    at: '2026-08-25T12:00:00.000Z',
    ms: 1200,
    calls: 4,
    failed: 0,
    ...over,
});

afterEach(() => {
    vi.resetAllMocks();
});

describe('TracesPage', () => {
    it('renders each decision, on a desk, as a row of figures', async () => {
        readTraces.mockResolvedValue({ decisions: [decision()], total: 1, spans: 4 });

        render(<TracesPage />);

        expect(await screen.findByText('enrichment.walk')).toBeInTheDocument();
        expect(screen.getByRole('table')).toBeInTheDocument();
    });

    describe('on a phone', () => {
        it('gives cards, keeping the spend, the calls and the failure count', async () => {
            const restore = stubPhoneMedia();
            try {
                readTraces.mockResolvedValue({
                    decisions: [
                        decision(),
                        decision({
                            id: 'bbbbbbbb-2222-4222-8222-222222222222',
                            kind: 'facts.extract',
                            parent: 'aaaaaaaa-1111-4111-8111-111111111111',
                            failed: 2,
                        }),
                    ],
                    total: 2,
                    spans: 8,
                });

                render(<TracesPage />);

                expect(await screen.findByText('enrichment.walk')).toBeInTheDocument();
                expect(screen.getByText('facts.extract')).toBeInTheDocument();
                expect(screen.getAllByText('1.2s')).toHaveLength(2);
                expect(screen.getAllByText('4 calls')).toHaveLength(2);
                expect(screen.getByText('2')).toBeInTheDocument();
                expect(screen.queryByRole('table')).not.toBeInTheDocument();
            } finally {
                restore();
            }
        });

        it('opens the drawer from a tap on the whole card', async () => {
            const restore = stubPhoneMedia();
            try {
                const user = setupUser();
                readTraces.mockResolvedValue({ decisions: [decision()], total: 1, spans: 4 });
                readTrace.mockResolvedValue({
                    decision: decision(),
                    caused: [],
                    spans: [{ at: '2026-08-25T12:00:00.000Z', op: 'plugin.call', target: 'deadair.musicbrainz', ms: 300, outcome: 'ok' }],
                });

                render(<TracesPage />);
                await screen.findByText('enrichment.walk');

                await user.click(screen.getByRole('button', { name: 'Open enrichment.walk' }));

                await waitFor(() => {
                    expect(readTrace).toHaveBeenCalledWith('aaaaaaaa-1111-4111-8111-111111111111');
                });
                expect(await screen.findByText('plugin.call')).toBeInTheDocument();
            } finally {
                restore();
            }
        });
    });
});
