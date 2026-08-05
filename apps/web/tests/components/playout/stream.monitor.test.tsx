// The monitor makes two claims: that it is not a listener on the mount until asked,
// and that what it plays is close to the live edge. Both are things a media element
// does not do on its own, so both are tested here against a stubbed one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { StreamMonitor } from '../../../src/components/playout/stream.monitor';
import { render, screen } from '../../utils/render';

/** How much audio the element is holding but has not played yet. Drives the trim. */
let buffered = 0;

beforeEach(() => {
    buffered = 0;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    Object.defineProperty(HTMLMediaElement.prototype, 'buffered', {
        configurable: true,
        get: () => ({ length: 1, end: () => buffered }) as unknown as TimeRanges,
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
});

const element = (): HTMLAudioElement => document.querySelector('audio')!;

describe('StreamMonitor', () => {
    it('holds no connection to the mount until asked', () => {
        render(<StreamMonitor mountPath="/live.mp3" />);

        expect(element()).not.toHaveAttribute('src');
        expect(screen.getByLabelText('Listen to the stream')).toBeInTheDocument();
    });

    it('attaches the mount on demand, cache-busted to start at the live edge', async () => {
        render(<StreamMonitor mountPath="/live.mp3" />);

        await userEvent.click(screen.getByLabelText('Listen to the stream'));

        expect(element().getAttribute('src')).toMatch(/^\/live\.mp3\?t=\d+$/);
        expect(screen.getByLabelText('Stop monitoring')).toBeInTheDocument();
    });

    it('drops the connection again when the operator stops', async () => {
        // Otherwise every console with a tab open is a listener Icecast counts.
        render(<StreamMonitor mountPath="/live.mp3" />);

        await userEvent.click(screen.getByLabelText('Listen to the stream'));
        await userEvent.click(screen.getByLabelText('Stop monitoring'));

        expect(element()).not.toHaveAttribute('src');
    });

    it('applies the remembered level, before anything is playing', () => {
        window.localStorage.setItem('deadair.monitor.volume', '40');

        render(<StreamMonitor mountPath="/live.mp3" />);

        expect(element().volume).toBeCloseTo(0.4);
    });
});

describe('StreamMonitor lag', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** Listening, without userEvent — which does not co-operate with fake timers. */
    async function listening() {
        render(<StreamMonitor mountPath="/live.mp3" />);
        await act(async () => {
            screen.getByLabelText('Listen to the stream').click();
        });
    }

    it('never touches the playback rate, however far behind it gets', async () => {
        // Playing fast to drain the buffer sounds like the fix and is not: Icecast
        // delivers at exactly real time, so consuming faster reaches zero buffer and
        // the element stalls, which is audible glitching AND a fresh delay after
        // every rebuffer. This is the regression that behaviour caused, held down.
        await listening();

        buffered = 8;
        act(() => {
            vi.advanceTimersByTime(5_000);
        });

        expect(element().playbackRate).toBe(1);
    });

    it('goes back to the live edge only when asked, by reconnecting', async () => {
        await listening();
        await act(async () => {
            screen.getByLabelText('Monitor volume').click();
        });
        buffered = 6;
        act(() => {
            vi.advanceTimersByTime(1_000);
        });
        const before = element().getAttribute('src');

        await act(async () => {
            screen.getByRole('button', { name: 'Catch up to the live edge' }).click();
        });

        // A fresh, cache-busted connection: the only thing that actually returns an
        // element to the live edge, at the cost of a momentary gap.
        expect(element().getAttribute('src')).not.toBe(before);
        expect(element().getAttribute('src')).toMatch(/^\/live\.mp3\?t=\d+$/);
    });

    it('says how far behind it is rather than leaving it a suspicion', async () => {
        await listening();
        await act(async () => {
            screen.getByLabelText('Monitor volume').click();
        });

        buffered = 2.4;
        act(() => {
            vi.advanceTimersByTime(1_000);
        });

        expect(screen.getByText(/2\.4s behind the audio it has received/)).toBeInTheDocument();
        // And says what it cannot measure, rather than presenting that as the whole delay.
        expect(screen.getByText(/encoder and Icecast add more/)).toBeInTheDocument();
    });

    it('stops measuring once it is no longer listening', async () => {
        await listening();
        await act(async () => {
            screen.getByLabelText('Monitor volume').click();
        });
        buffered = 4;
        act(() => {
            vi.advanceTimersByTime(1_000);
        });
        expect(screen.getByText(/4\.0s behind/)).toBeInTheDocument();

        await act(async () => {
            screen.getByLabelText('Stop monitoring').click();
        });
        buffered = 9;
        act(() => {
            vi.advanceTimersByTime(5_000);
        });

        expect(screen.queryByText(/behind the audio/)).not.toBeInTheDocument();
    });
});
