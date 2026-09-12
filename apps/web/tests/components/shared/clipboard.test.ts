// jsdom implements neither `navigator.clipboard` nor `document.execCommand`, which makes it a fair
// model of the worst case and no model of anything else. Each case installs exactly the pieces it is
// about, as own properties, and takes them away again after, so nothing here leaks into a file that
// meets the real jsdom next.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText } from '../../../src/components/shared/clipboard';

/** What the page looked like at the instant `execCommand('copy')` ran, which is the only moment it matters. */
interface SelectionAtCopy {
    command: string;
    focused: Element | null;
    value: string | undefined;
    selected: string | undefined;
}

function installClipboard(writeText: (value: string) => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

function installExecCommand(answer: () => boolean): { calls: SelectionAtCopy[] } {
    const calls: SelectionAtCopy[] = [];
    Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: (command: string) => {
            const focused = document.activeElement;
            const field = focused instanceof HTMLTextAreaElement ? focused : undefined;
            calls.push({
                command,
                focused,
                value: field?.value,
                selected: field?.value.slice(field.selectionStart, field.selectionEnd),
            });
            return answer();
        },
    });
    return { calls };
}

afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(document, 'execCommand');
    document.body.innerHTML = '';
});

describe('copyText', () => {
    it('writes through navigator.clipboard when the browser offers it, and never reaches for the old path', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        installClipboard(writeText);
        const exec = installExecCommand(() => true);

        await expect(copyText('docker compose restart icecast')).resolves.toBe(true);

        expect(writeText).toHaveBeenCalledWith('docker compose restart icecast');
        expect(exec.calls).toEqual([]);
    });

    it('copies through a selected textarea when there is no navigator.clipboard, as on http://<LAN address>', async () => {
        const exec = installExecCommand(() => true);

        await expect(copyText('JBSWY3DPEHPK3PXP')).resolves.toBe(true);

        expect(exec.calls).toHaveLength(1);
        const [call] = exec.calls;
        expect(call?.command).toBe('copy');
        // The whole value, selected, in the element that had focus when the browser was asked to copy:
        // `execCommand('copy')` copies the selection and nothing else, so anything short of this is a
        // copy of the wrong text or of nothing.
        expect(call?.focused).toBeInstanceOf(HTMLTextAreaElement);
        expect(call?.value).toBe('JBSWY3DPEHPK3PXP');
        expect(call?.selected).toBe('JBSWY3DPEHPK3PXP');
        // And nothing is left behind on the page afterwards.
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('takes the old path inside the click rather than on a later tick, where the browser may refuse it', () => {
        const exec = installExecCommand(() => true);

        // Deliberately not awaited: the copy has to have happened by the time the call returns.
        void copyText('abc1234');

        expect(exec.calls).toHaveLength(1);
    });

    it('falls back when navigator.clipboard exists but refuses', async () => {
        installClipboard(() => Promise.reject(new DOMException('Document is not focused.', 'NotAllowedError')));
        const exec = installExecCommand(() => true);

        await expect(copyText('http://192.168.1.10:8080/stream.mp3')).resolves.toBe(true);

        expect(exec.calls.map(call => call.value)).toEqual(['http://192.168.1.10:8080/stream.mp3']);
    });

    it('answers false when the browser declines the old path too', async () => {
        installExecCommand(() => false);

        await expect(copyText('abc1234')).resolves.toBe(false);
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('answers false rather than throwing when execCommand is missing altogether', async () => {
        // No installs at all: this is jsdom as it comes, which is a browser with neither.
        await expect(copyText('abc1234')).resolves.toBe(false);
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('hands focus back to whatever held it, so a keyboard user is not dropped on the page body', async () => {
        installExecCommand(() => true);
        const button = document.createElement('button');
        document.body.appendChild(button);
        button.focus();

        await copyText('abc1234');

        expect(document.activeElement).toBe(button);
    });
});
