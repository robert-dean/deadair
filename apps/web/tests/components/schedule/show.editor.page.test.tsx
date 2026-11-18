import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleSlot } from '@deadair/sdk';

import { ShowEditorPage } from '../../../src/components/schedule/show.editor.page';
import type { SlotEditorFormProps } from '../../../src/components/schedule/slot.editor';
import { render, screen, setupUser } from '../../utils/render';

const navigate = vi.fn();
const update = vi.fn();
const create = vi.fn();
const remove = vi.fn();
const guarded = vi.fn();
let slots: ScheduleSlot[] = [];

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, to, search: _search, ...props }: { children?: ReactNode; to: string; search?: unknown }) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
    useNavigate: () => navigate,
}));

const mutation = (mutate: ReturnType<typeof vi.fn>) => ({ mutate, isPending: false, error: undefined, reset: vi.fn() });

vi.mock('../../../src/api/schedule.queries', () => ({
    useSchedule: () => ({ data: { slots, switchedOff: [] }, error: undefined }),
    useCurrentSlot: () => ({ data: { airingSlotId: 'slot-1' } }),
    useCreateSlot: () => mutation(create),
    useUpdateSlot: () => mutation(update),
    useDeleteSlot: () => mutation(remove),
    useApplySlot: () => mutation(vi.fn()),
}));

// The guard's own behaviour is `unsaved.guard`'s to pin; here it is only whether the page hands it the form's answer.
vi.mock('../../../src/components/settings/unsaved.guard', () => ({
    UnsavedGuard: ({ dirty, body }: { dirty: boolean; body?: string }) => {
        guarded(dirty, body);
        return undefined;
    },
}));

// The form is `slot.editor.test.tsx`'s. A stand-in that says what it was opened on and can press each button.
vi.mock('../../../src/components/schedule/slot.editor', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../src/components/schedule/slot.editor')>()),
    SlotEditorForm: (props: SlotEditorFormProps) => (
        <div>
            <span>{props.target.kind === 'edit' ? `editing ${props.target.slot.id}` : `new ${props.target.special ? 'special' : 'weekly'}`}</span>
            <span>{props.airing ? 'airing' : 'not airing'}</span>
            <button type="button" onClick={() => props.onDirtyChange?.(true)}>
                type
            </button>
            <button
                type="button"
                onClick={() => props.onSubmit({ label: 'x', startsAtMinutes: 0, endsAtMinutes: 60, days: [], mode: 'rotation', onEnd: 'extend' })}
            >
                save
            </button>
            <button type="button" onClick={() => props.onDelete('slot-1')}>
                delete
            </button>
        </div>
    ),
}));

const breakfast = {
    id: 'slot-1',
    label: 'Breakfast',
    startsAtMinutes: 360,
    endsAtMinutes: 600,
    days: [],
    mode: 'rotation',
    onEnd: 'extend',
} as ScheduleSlot;

afterEach(() => {
    navigate.mockReset();
    update.mockReset();
    create.mockReset();
    remove.mockReset();
    guarded.mockReset();
    slots = [];
});

describe('ShowEditorPage', () => {
    it('opens on the show named in the address, titled with its name, and knows it is the one airing', () => {
        slots = [breakfast];
        render(<ShowEditorPage open={{ slotId: 'slot-1' }} from="week" />);

        expect(screen.getByRole('heading', { name: 'Breakfast' })).toBeInTheDocument();
        expect(screen.getByText('editing slot-1')).toBeInTheDocument();
        expect(screen.getByText('airing')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Programme' })).toHaveAttribute('href', '/schedule');
    });

    it('says so when the show is not in the schedule, rather than opening an empty form', () => {
        render(<ShowEditorPage open={{ slotId: 'gone' }} from="week" />);

        expect(screen.getByRole('heading', { name: 'No such show' })).toBeInTheDocument();
        expect(screen.queryByText(/editing/)).toBeNull();
    });

    it('opens a new special from its prefill, titled as one', () => {
        render(<ShowEditorPage open={{ fresh: { kind: 'new', special: true } }} from="specials" />);

        expect(screen.getByRole('heading', { name: 'New special' })).toBeInTheDocument();
        expect(screen.getByText('new special')).toBeInTheDocument();
    });

    it('guards an unsaved edit, and leaves past the guard once the save has landed', async () => {
        slots = [breakfast];
        const user = setupUser();
        update.mockImplementation((_body: unknown, { onSuccess }: { onSuccess: () => void }) => onSuccess());
        render(<ShowEditorPage open={{ slotId: 'slot-1' }} from="specials" />);

        expect(guarded).toHaveBeenLastCalledWith(false, expect.stringContaining('the show stays as it was'));
        await user.click(screen.getByRole('button', { name: 'type' }));
        expect(guarded).toHaveBeenLastCalledWith(true, expect.any(String));

        await user.click(screen.getByRole('button', { name: 'save' }));
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 'slot-1' }), expect.anything());
        expect(navigate).toHaveBeenCalledWith({ to: '/schedule', search: { tab: 'specials' }, ignoreBlocker: true });
    });

    it('goes back to the tab it came from once the show is deleted', async () => {
        slots = [breakfast];
        const user = setupUser();
        remove.mockImplementation((_id: string, { onSuccess }: { onSuccess: () => void }) => onSuccess());
        render(<ShowEditorPage open={{ slotId: 'slot-1' }} from="today" />);

        await user.click(screen.getByRole('button', { name: 'delete' }));
        expect(navigate).toHaveBeenCalledWith({ to: '/schedule', search: { tab: 'today' }, ignoreBlocker: true });
    });
});
