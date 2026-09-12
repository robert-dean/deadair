// The clipboard mechanics are `clipboard.test.ts`'s. What this file checks is what the operator SEES
// for each outcome, which is where Mantine's `CopyButton` went wrong: over plain HTTP it copied
// nothing and went on reading "Copy", so a failure and an unclicked button were indistinguishable.
//
// `setupUser()` puts user-event's own clipboard stub on `navigator`, so each case installs its
// clipboard AFTER setting up the user, or it would be testing the stub.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';

import { CopyButton } from '../../../src/components/shared/copy.button';
import { render, screen, setupUser } from '../../utils/render';

function installClipboard(writeText: (value: string) => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

/** A plain-HTTP page: the browser does not define `navigator.clipboard` at all. */
function removeClipboard(): void {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
}

function installExecCommand(answer: boolean): ReturnType<typeof vi.fn> {
    const execCommand = vi.fn(() => answer);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    return execCommand;
}

afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(document, 'execCommand');
});

describe('CopyButton', () => {
    it('copies through navigator.clipboard and says so, then goes back to Copy', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const writeText = vi.fn(() => Promise.resolve());
        installClipboard(writeText);
        render(<CopyButton value="docker compose restart icecast" />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
        await act(async () => {});

        expect(writeText).toHaveBeenCalledWith('docker compose restart icecast');
        expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();

        act(() => vi.advanceTimersByTime(1000));
        expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    });

    it('still copies on a page with no navigator.clipboard, through the old selection copy', async () => {
        const user = setupUser();
        removeClipboard();
        const execCommand = installExecCommand(true);
        render(<CopyButton value="JBSWY3DPEHPK3PXP" />);

        await user.click(screen.getByRole('button', { name: 'Copy' }));

        expect(execCommand).toHaveBeenCalledWith('copy');
        expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('says the copy failed when both paths refuse, and offers the value already selected', async () => {
        const user = setupUser();
        removeClipboard();
        installExecCommand(false);
        const value = '3f9c1e2a7b4d8c6e5f0a1b2c3d4e5f6a7b8c9d0e';
        render(<CopyButton value={value} />);

        await user.click(screen.getByRole('button', { name: 'Copy' }));

        expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
        expect(screen.getByText(/would not copy it/)).toBeInTheDocument();
        // The WHOLE value, not what was on screen beside the button: the check-up shows a revision as
        // seven characters and copies forty, so "select the text beside it" would be advice to copy
        // the wrong thing.
        const field = screen.getByRole('textbox', { name: 'Text to copy' });
        expect(field).toHaveValue(value);
        await waitFor(() => expect(field).toHaveFocus());
        expect([(field as HTMLInputElement).selectionStart, (field as HTMLInputElement).selectionEnd]).toEqual([0, value.length]);
    });

    it('keeps the failure up until it is dismissed, and returns to Copy after', async () => {
        const user = setupUser();
        removeClipboard();
        installExecCommand(false);
        render(<CopyButton value="abc1234" />);

        await user.click(screen.getByRole('button', { name: 'Copy' }));
        const field = await screen.findByRole('textbox', { name: 'Text to copy' });
        await waitFor(() => expect(field).toHaveFocus());

        await user.keyboard('{Escape}');

        expect(await screen.findByRole('button', { name: 'Copy' })).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Text to copy' })).not.toBeInTheDocument();
    });

    it('tries again from the failed state, and a copy that then works closes the offer', async () => {
        const user = setupUser();
        removeClipboard();
        const execCommand = installExecCommand(false);
        render(<CopyButton value="abc1234" />);

        await user.click(screen.getByRole('button', { name: 'Copy' }));
        await screen.findByRole('button', { name: 'Copy failed' });

        execCommand.mockReturnValue(true);
        await user.click(screen.getByRole('button', { name: 'Copy failed' }));

        expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Text to copy' })).not.toBeInTheDocument();
    });
});
