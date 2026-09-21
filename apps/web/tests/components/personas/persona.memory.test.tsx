// The rollback is the most destructive button in the console, and most of what is pinned here is
// about what has to happen BEFORE it does anything: an operator sees what it would take, is told the
// two ways it can cost them something they did not expect, and re-learning is off unless they ask.
//
// The one non-obvious assertion is that the moment sent back is the row's own string, character for
// character. Postgres keeps a timestamp to the microsecond and JavaScript's Date cannot, so a value
// re-rendered anywhere on this path would compare as earlier than its own row and delete the telling
// the operator pointed at.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersonaMemoryChange, PersonaMemoryTimeline, PersonaTelling } from '@deadair/sdk';

import { PersonaMemoryPanel } from '../../../src/components/personas/persona.memory';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const readPersonaMemory = vi.fn();
const previewPersonaMemoryRollback = vi.fn();
const rollBackPersonaMemory = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        personas: {
            readPersonaMemory: (...args: unknown[]) => readPersonaMemory(...args),
            previewPersonaMemoryRollback: (...args: unknown[]) => previewPersonaMemoryRollback(...args),
            rollBackPersonaMemory: (...args: unknown[]) => rollBackPersonaMemory(...args),
        },
    },
}));

afterEach(() => {
    readPersonaMemory.mockReset();
    previewPersonaMemoryRollback.mockReset();
    rollBackPersonaMemory.mockReset();
});

/** The microsecond tail is the whole point of this fixture. */
const MOMENT = '2026-05-12 14:30:00.123456+00';

const telling = (over: Partial<PersonaTelling> = {}): PersonaTelling => ({
    id: 't1',
    storyId: 's1',
    title: 'The Barstow lights',
    source: 'break',
    mode: 'offered',
    told: true,
    said: 'Three lights over the desert, and the radio went to static.',
    airedAt: '2026-05-12 14:31:00+00',
    at: MOMENT,
    ...over,
});

const timeline = (tellings: PersonaTelling[]): PersonaMemoryTimeline => ({ personaId: 'p1', tellings });

const change = (over: Partial<PersonaMemoryChange> = {}): PersonaMemoryChange => ({
    tellings: 3,
    notes: 2,
    stories: 1,
    details: 4,
    rejected: 0,
    touched: 0,
    ...over,
});

const panel = () => <PersonaMemoryPanel personaId="p1" label="Night owl" />;

describe('the timeline', () => {
    it('draws what the character has told, with the words it said', async () => {
        readPersonaMemory.mockResolvedValue(timeline([telling()]));

        render(panel());

        expect(await screen.findByText('The Barstow lights')).toBeInTheDocument();
        expect(screen.getByText(/Three lights over the desert/)).toBeInTheDocument();
    });

    it('says so when a story was offered and the writer passed over it', async () => {
        // An ordinary outcome rather than a fault: the row records that the character was handed it
        // and said nothing, which is what keeps the rotation moving.
        readPersonaMemory.mockResolvedValue(timeline([telling({ told: false })]));

        render(panel());

        expect(await screen.findByText('passed over')).toBeInTheDocument();
    });

    it('marks a telling no listener has heard yet', async () => {
        const unaired = telling();
        delete unaired.airedAt;
        readPersonaMemory.mockResolvedValue(timeline([unaired]));

        render(panel());

        expect(await screen.findByText('not aired')).toBeInTheDocument();
    });

    it('offers no way back for a character that has told nothing', async () => {
        readPersonaMemory.mockResolvedValue(timeline([]));

        render(panel());

        expect(await screen.findByText(/has not told anything yet/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Clear all of it/ })).not.toBeInTheDocument();
    });
});

describe('asking for a rollback', () => {
    it('previews before it offers to do anything, using the row’s own moment', async () => {
        readPersonaMemory.mockResolvedValue(timeline([telling()]));
        previewPersonaMemoryRollback.mockResolvedValue(change());
        const user = setupUser();

        render(panel());
        await user.click(await screen.findByRole('button', { name: /Roll back to here/ }));

        // Character for character. See the file note.
        await waitFor(() => expect(previewPersonaMemoryRollback).toHaveBeenCalledWith('p1', { to: MOMENT }));
        expect(rollBackPersonaMemory).not.toHaveBeenCalled();
    });

    it('shows what would go, and says whose work is safe', async () => {
        readPersonaMemory.mockResolvedValue(timeline([telling()]));
        previewPersonaMemoryRollback.mockResolvedValue(change());
        const user = setupUser();

        render(panel());
        await user.click(await screen.findByRole('button', { name: /Roll back to here/ }));

        expect(await screen.findByText(/tellings forgotten/)).toBeInTheDocument();
        expect(screen.getByText(/Anything you typed stays exactly where it is/)).toBeInTheDocument();
    });

    it('warns that a proposal they turned down can come back', async () => {
        readPersonaMemory.mockResolvedValue(timeline([telling()]));
        previewPersonaMemoryRollback.mockResolvedValue(change({ rejected: 2 }));
        const user = setupUser();

        render(panel());
        await user.click(await screen.findByRole('button', { name: /Roll back to here/ }));

        expect(await screen.findByText(/proposals you turned down/)).toBeInTheDocument();
    });

    it('warns that something they had accepted still goes', async () => {
        readPersonaMemory.mockResolvedValue(timeline([telling()]));
        previewPersonaMemoryRollback.mockResolvedValue(change({ touched: 1 }));
        const user = setupUser();

        render(panel());
        await user.click(await screen.findByRole('button', { name: /Roll back to here/ }));

        expect(await screen.findByText(/you had accepted or edited/)).toBeInTheDocument();
    });

    it('says plainly when there is nothing after that moment', async () => {
        readPersonaMemory.mockResolvedValue(timeline([telling()]));
        previewPersonaMemoryRollback.mockResolvedValue(change({ tellings: 0, notes: 0, stories: 0, details: 0 }));
        const user = setupUser();

        render(panel());
        await user.click(await screen.findByRole('button', { name: /Roll back to here/ }));

        expect(await screen.findByText(/nothing after that moment to undo/)).toBeInTheDocument();
    });
});

describe('doing it', () => {
    it('sends the row’s own moment, and does not ask to re-read anything', async () => {
        readPersonaMemory.mockResolvedValue(timeline([telling()]));
        previewPersonaMemoryRollback.mockResolvedValue(change());
        rollBackPersonaMemory.mockResolvedValue({ personaId: 'p1', undone: change(), tellings: [] });
        const user = setupUser();

        render(panel());
        await user.click(await screen.findByRole('button', { name: /Roll back to here/ }));
        await screen.findByText(/tellings forgotten/);
        await user.click(screen.getByRole('button', { name: 'Roll back' }));

        // `relearn` absent rather than false: re-reading the window is right for testing and wrong
        // for undoing a character that drifted, so it is never sent unless it was asked for.
        await waitFor(() => expect(rollBackPersonaMemory).toHaveBeenCalledWith('p1', { to: MOMENT }));
    });

    it('asks for the re-read only when the operator ticks it', async () => {
        readPersonaMemory.mockResolvedValue(timeline([telling()]));
        previewPersonaMemoryRollback.mockResolvedValue(change());
        rollBackPersonaMemory.mockResolvedValue({ personaId: 'p1', undone: change(), tellings: [] });
        const user = setupUser();

        render(panel());
        await user.click(await screen.findByRole('button', { name: /Roll back to here/ }));
        await screen.findByText(/tellings forgotten/);
        await user.click(screen.getByRole('checkbox', { name: /Read those broadcasts again/ }));
        await user.click(screen.getByRole('button', { name: 'Roll back' }));

        await waitFor(() => expect(rollBackPersonaMemory).toHaveBeenCalledWith('p1', { to: MOMENT, relearn: true }));
    });

    it('sends no moment at all for a reset, which is what takes everything', async () => {
        readPersonaMemory.mockResolvedValue(timeline([telling()]));
        previewPersonaMemoryRollback.mockResolvedValue(change());
        rollBackPersonaMemory.mockResolvedValue({ personaId: 'p1', undone: change(), tellings: [] });
        const user = setupUser();

        render(panel());
        await user.click(await screen.findByRole('button', { name: /Clear all of it/ }));
        await screen.findByText(/tellings forgotten/);
        await user.click(screen.getByRole('button', { name: 'Clear it' }));

        await waitFor(() => expect(rollBackPersonaMemory).toHaveBeenCalledWith('p1', {}));
    });

    it('leaves the character alone when the operator backs out', async () => {
        readPersonaMemory.mockResolvedValue(timeline([telling()]));
        previewPersonaMemoryRollback.mockResolvedValue(change());
        const user = setupUser();

        render(panel());
        await user.click(await screen.findByRole('button', { name: /Roll back to here/ }));
        await screen.findByText(/tellings forgotten/);
        await user.click(screen.getByRole('button', { name: 'Leave it' }));

        expect(rollBackPersonaMemory).not.toHaveBeenCalled();
    });

    it('says the character is as it was when the rollback fails', async () => {
        readPersonaMemory.mockResolvedValue(timeline([telling()]));
        previewPersonaMemoryRollback.mockResolvedValue(change());
        rollBackPersonaMemory.mockRejectedValue(new Error('the database is away'));
        const user = setupUser();

        render(panel());
        await user.click(await screen.findByRole('button', { name: /Roll back to here/ }));
        await screen.findByText(/tellings forgotten/);
        await user.click(screen.getByRole('button', { name: 'Roll back' }));

        expect(await screen.findByText(/Nothing was rolled back/)).toBeInTheDocument();
    });
});
