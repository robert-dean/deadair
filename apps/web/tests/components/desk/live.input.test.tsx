// The card a presenter goes live from. What is tested is that each state offers only what it should,
// that Go live sends the show's name (and nothing for an empty box), and that Hand back, which cuts
// a presenter off for everybody listening, asks twice and forgets on its own as Stop does.

import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError, type PlayoutLive } from '@deadair/sdk';

import { LiveInput } from '../../../src/components/desk/live.input';
import { playoutStatus } from '../../utils/playout.fixture';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const armTheLiveInput = vi.fn((_body: unknown) => Promise.resolve(playoutStatus()));
const disarmTheLiveInput = vi.fn(() => Promise.resolve(playoutStatus()));
const getTheLiveInputConnection = vi.fn(() => Promise.resolve({ port: 8006, mount: '/live', user: 'source', password: 's3cret-pw' }));
let automation: string | undefined = 'standDown';

vi.mock('../../../src/api/client', () => ({
    sdk: {
        playout: {
            armTheLiveInput: (body: unknown) => armTheLiveInput(body),
            disarmTheLiveInput: () => disarmTheLiveInput(),
            getTheLiveInputConnection: () => getTheLiveInputConnection(),
            getPlayoutStatus: () => Promise.resolve(playoutStatus()),
        },
        settings: {
            getSettings: () =>
                Promise.resolve({
                    descriptors: [],
                    values: automation === undefined ? {} : { 'playout.liveAutomation': automation },
                    configured: {},
                    derived: {},
                }),
        },
    },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
        <a href={to} {...rest}>
            {children}
        </a>
    ),
}));

afterEach(() => {
    vi.clearAllMocks();
    automation = 'standDown';
});

const live = (state: PlayoutLive['state'], more: Partial<PlayoutLive> = {}): PlayoutLive => ({ state, ...more });

describe('LiveInput', () => {
    it('offers Go live with a show name, and says the station stands down meanwhile', async () => {
        render(<LiveInput live={live('off')} />);

        expect(screen.getByRole('button', { name: 'Go live' })).toBeInTheDocument();
        expect(screen.getByLabelText('Show name')).toBeInTheDocument();
        expect(await screen.findByText(/the station’s own programme stops and picks up at the next record afterwards/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/settings/playout');
    });

    it('says the programme carries on when the operator chose that', async () => {
        automation = 'continue';
        render(<LiveInput live={live('off')} />);

        expect(await screen.findByText(/carries on underneath, unheard/)).toBeInTheDocument();
    });

    it('arms with the show name, trimmed', async () => {
        const user = setupUser();
        render(<LiveInput live={live('off')} />);

        await user.type(screen.getByLabelText('Show name'), '  The Late Show ');
        await user.click(screen.getByRole('button', { name: 'Go live' }));

        await waitFor(() => expect(armTheLiveInput).toHaveBeenCalledWith({ title: 'The Late Show' }));
    });

    it('arms with no title at all when the box is empty, so the station keeps its name', async () => {
        const user = setupUser();
        render(<LiveInput live={live('off')} />);

        await user.click(screen.getByRole('button', { name: 'Go live' }));

        await waitFor(() => expect(armTheLiveInput).toHaveBeenCalledWith({}));
    });

    it('waits for the encoder once armed, and Cancel disarms', async () => {
        const user = setupUser();
        render(<LiveInput live={live('armed')} />);

        expect(screen.getByText('Waiting for your encoder. Start sending, and the countdown begins.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(disarmTheLiveInput).toHaveBeenCalledTimes(1));
    });

    it('hands back only on the second press', async () => {
        const user = setupUser();
        render(<LiveInput live={live('onair', { forMs: 12_000 })} />);

        expect(screen.getByText('You’re live')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Hand back' }));
        expect(disarmTheLiveInput).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Confirm hand back' }));
        await waitFor(() => expect(disarmTheLiveInput).toHaveBeenCalledTimes(1));
    });

    it('forgets an armed Hand back on its own', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            const user = setupUser();
            render(<LiveInput live={live('onair')} />);

            await user.click(screen.getByRole('button', { name: 'Hand back' }));
            expect(screen.getByRole('button', { name: 'Confirm hand back' })).toBeInTheDocument();

            await vi.advanceTimersByTimeAsync(5_000);

            await waitFor(() => expect(screen.getByRole('button', { name: 'Hand back' })).toBeInTheDocument());
            expect(disarmTheLiveInput).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('says so in its own words when the arm is refused', async () => {
        armTheLiveInput.mockRejectedValueOnce(new Error('nope'));
        const user = setupUser();
        render(<LiveInput live={live('off')} />);

        await user.click(screen.getByRole('button', { name: 'Go live' }));

        expect(await screen.findByText('The live input could not be armed.')).toBeInTheDocument();
    });

    it('counts in from the reading, in whole seconds rounded up, and moves between readings', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            render(<LiveInput live={live('preroll', { inMs: 2_600 })} />);

            expect(screen.getByText('3')).toBeInTheDocument();
            expect(screen.getByText('Going live in 3 seconds. Start talking on the cut.')).toBeInTheDocument();

            await vi.advanceTimersByTimeAsync(700);
            expect(await screen.findByText('2')).toBeInTheDocument();

            await vi.advanceTimersByTimeAsync(1_000);
            expect(await screen.findByText('Going live in 1 second. Start talking on the cut.')).toBeInTheDocument();

            // Never 0 before the cut, however late the next reading is.
            await vi.advanceTimersByTimeAsync(5_000);
            expect(screen.getByText('1')).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('re-anchors on a fresh reading rather than running on from the old one', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            const { rerender } = render(<LiveInput live={live('preroll', { inMs: 1_200 })} />);
            await vi.advanceTimersByTimeAsync(300);

            rerender(<LiveInput live={live('preroll', { inMs: 2_900 })} />);

            expect(await screen.findByText('3')).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('counts the time on air on from the reading', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            render(<LiveInput live={live('onair', { forMs: 61_000 })} />);

            expect(screen.getByText('On the air for 1:01')).toBeInTheDocument();
            await vi.advanceTimersByTimeAsync(2_000);
            expect(await screen.findByText('On the air for 1:03')).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('asks for the connection details only when they are opened, and keeps the password hidden until asked', async () => {
        const user = setupUser();
        render(<LiveInput live={live('off')} />);

        expect(getTheLiveInputConnection).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Encoder settings' }));

        expect(await screen.findByText('8006')).toBeInTheDocument();
        expect(screen.getByText('/live')).toBeInTheDocument();
        expect(screen.getByText('source')).toBeInTheDocument();
        expect(screen.queryByText('s3cret-pw')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Show' }));
        expect(screen.getByText('s3cret-pw')).toBeInTheDocument();
        expect(getTheLiveInputConnection).toHaveBeenCalledTimes(1);
    });

    it('does not offer the connection details while somebody is on the air', () => {
        render(<LiveInput live={live('onair')} />);

        expect(screen.queryByRole('button', { name: 'Encoder settings' })).not.toBeInTheDocument();
    });

    it('says only an administrator can see the password when the station refuses', async () => {
        getTheLiveInputConnection.mockRejectedValueOnce(new SdkError(403, 'Forbidden', {}, new Headers()));
        const user = setupUser();
        render(<LiveInput live={live('off')} />);

        await user.click(screen.getByRole('button', { name: 'Encoder settings' }));

        expect(await screen.findByText('Only an administrator can see the live input’s password.')).toBeInTheDocument();
    });
});
