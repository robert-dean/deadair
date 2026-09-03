// Four functions and one worth testing in any depth: the other three are a `notifications.show`
// call apiece with a fixed colour and timeout, which is what their own source says at a glance. The
// undoable one builds an element with a live handler inside it, which is the part a glance cannot
// check — an `onUndo` that never fires, or a toast that outlives the click that dismissed it, would
// both look identical to a passing render.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { notifyUndoable } from '../../../src/components/shared/notify';
import { render, screen, setupUser } from '../../utils/render';

const show = vi.fn((data: { message: React.ReactNode; id?: string }) => data.id ?? 'toast-1');
const hide = vi.fn();

vi.mock('@mantine/notifications', () => ({
    notifications: {
        show: (data: unknown) => show(data as { message: React.ReactNode }),
        hide: (id: string) => hide(id),
    },
}));

afterEach(() => {
    show.mockClear();
    hide.mockClear();
});

describe('notifyUndoable', () => {
    it('shows the message with an undo button beside it', () => {
        notifyUndoable('Dropped “Flim”.', { label: 'Put it back', onUndo: vi.fn() });

        // The toast itself is Mantine's own component and is not under test — what this file can
        // check is the element handed to `show`, which is the whole of what this function builds.
        const [call] = show.mock.calls;
        render(call?.[0].message as React.ReactElement);

        expect(screen.getByText(/Dropped/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Put it back' })).toBeInTheDocument();
    });

    it('calls the undo and dismisses the toast on one click, in that order', async () => {
        const onUndo = vi.fn();
        notifyUndoable('Dropped “Flim”.', { label: 'Put it back', onUndo });

        const [call] = show.mock.calls;
        render(call?.[0].message as React.ReactElement);

        await setupUser().click(screen.getByRole('button', { name: 'Put it back' }));

        expect(onUndo).toHaveBeenCalledTimes(1);
        expect(hide).toHaveBeenCalledTimes(1);
        // Order matters: a dismiss that ran first and an undo that then failed would close the only
        // way back to the item it dropped.
        expect(onUndo.mock.invocationCallOrder[0]).toBeLessThan(hide.mock.invocationCallOrder[0] as number);
    });
});
