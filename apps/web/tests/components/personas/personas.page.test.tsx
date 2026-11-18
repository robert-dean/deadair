// A card used to draw six equal-weight buttons — Make station host, Rehearse, Notebook, Stories, Edit,
// Delete — which put Delete at the same visual weight as the one action anybody comes to this page
// for. What is worth testing here is the shape that replaced it: three actions in hand and the rest
// behind a menu, and that the card still reads on a phone once it wraps.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Persona } from '@deadair/sdk';

import { PersonasPage } from '../../../src/components/personas/personas.page';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';
import { stubPhoneMedia } from '../../utils/phone';

// This page opens four queries on mount (personas, voices, script summary). Everything but the
// persona list itself is covered by its own suite; here it only has to not throw.
const readScriptPerformance = vi.fn();
const readScriptSummary = vi.fn(() => Promise.resolve({ hours: 24, rows: [] as object[] }));
const readCurrentSlot = vi.fn(() => Promise.resolve({ now: '2026-11-18 21:30:00', upcoming: [] as object[] }));
const listSchedule = vi.fn(() => Promise.resolve({ slots: [] as object[] }));

vi.mock('../../../src/api/client', () => ({
    sdk: {
        personas: {
            listPersonas: () => listPersonas(),
            exportPersonas: () => exportPersonas(),
            restorePersonas: () => restorePersonas(),
        },
        render: {
            listVoices: () => Promise.resolve({ voices: [] }),
            readScriptPerformance: (...args: unknown[]) => readScriptPerformance(...args),
            readScriptSummary: () => readScriptSummary(),
        },
        schedule: { readCurrentSlot: () => readCurrentSlot(), listSchedule: () => listSchedule() },
        art: { listPersonaPortraits: () => Promise.resolve({ portraits: [] }) },
        settings: { getSettings: () => Promise.resolve({ descriptors: [], values: {}, configured: {} }) },
    },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
        <a href={to} {...rest}>
            {children}
        </a>
    ),
}));

const listPersonas = vi.fn();
const exportPersonas = vi.fn();
const restorePersonas = vi.fn();

// The roster export reports through notifications, which this suite renders no provider for: what
// was shown is read off the spy instead.
const shown = vi.fn((_: { message: string }) => 'n-1');
vi.mock('@mantine/notifications', () => ({
    notifications: { show: (options: { message: string }) => shown(options), hide: vi.fn() },
}));

vi.mock('../../../src/components/shared/download', async importOriginal => ({
    ...(await importOriginal<object>()),
    saveJsonDownload: vi.fn(),
}));

const persona = (overrides: Partial<Persona> = {}): Persona => ({
    id: 'p-1',
    key: 'marlowe',
    kind: 'host',
    label: 'Marlowe',
    style: 'A late-night crime writer with a weakness for a good record.',
    defaultHost: false,
    presenting: false,
    ...overrides,
});

describe('PersonasPage', () => {
    it("shows this character's writing beside what the operator thought of it, and nobody else's", async () => {
        const user = setupUser();
        listPersonas.mockResolvedValue({ personas: [persona({ key: 'wayne' })] });
        readScriptPerformance.mockResolvedValue({
            days: 30,
            rows: [
                {
                    personaKey: 'wayne',
                    kind: 'talkbreak',
                    written: 41,
                    declined: 7,
                    failed: 2,
                    liked: 5,
                    neutral: 1,
                    disliked: 3,
                    declineReasons: [
                        { reason: 'not in its own voice', count: 6 },
                        { reason: 'forbidden wording', count: 1 },
                    ],
                },
                { personaKey: 'garth', kind: 'banter', written: 99, declined: 0, failed: 0, liked: 0, neutral: 0, disliked: 0, declineReasons: [] },
            ],
        });
        render(<PersonasPage />);

        await user.click(await screen.findByRole('button', { name: 'More about Marlowe' }));
        await user.click(await screen.findByRole('menuitem', { name: 'How it is doing' }));

        const row = (await screen.findByRole('cell', { name: 'talkbreak' })).closest('tr')!;
        expect(
            within(row)
                .getAllByRole('cell')
                .map(cell => cell.textContent),
        ).toEqual(['talkbreak', '41', '7', '2', '5', '1', '3']);
        expect(screen.getByText('6 times: not in its own voice')).toBeInTheDocument();
        expect(screen.getByText('1 time: forbidden wording')).toBeInTheDocument();
        expect(screen.queryByRole('cell', { name: 'banter' })).not.toBeInTheDocument();
        expect(readScriptPerformance).toHaveBeenCalledWith({ days: 30 });
    });

    it('says when a character has written nothing in the window', async () => {
        const user = setupUser();
        listPersonas.mockResolvedValue({ personas: [persona({ key: 'wayne' })] });
        readScriptPerformance.mockResolvedValue({ days: 30, rows: [] });
        render(<PersonasPage />);

        await user.click(await screen.findByRole('button', { name: 'More about Marlowe' }));
        await user.click(await screen.findByRole('menuitem', { name: 'How it is doing' }));

        expect(await screen.findByText('This character has written nothing in the last 30 days.')).toBeInTheDocument();
    });

    it('keeps three actions in hand on a host card, and Delete is not one of them', async () => {
        listPersonas.mockResolvedValue({ personas: [persona()] });
        render(<PersonasPage />);

        expect(await screen.findByRole('button', { name: 'Make station host' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rehearse' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
        // Delete carried the same weight as the host button; it now lives behind the menu and is not on
        // the card until that menu is opened.
        expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('reveals Notebook, Stories, Export and Delete once the menu is opened', async () => {
        listPersonas.mockResolvedValue({ personas: [persona()] });
        const user = setupUser();
        render(<PersonasPage />);

        await user.click(await screen.findByRole('button', { name: 'More about Marlowe' }));

        expect(screen.getByRole('menuitem', { name: 'Notebook' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Stories' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Export' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    });

    it('never offers the host button for a caller, who can never present', async () => {
        listPersonas.mockResolvedValue({ personas: [persona({ id: 'p-2', key: 'ringer', kind: 'caller', label: 'Ringer' })] });
        render(<PersonasPage />);

        await screen.findByText('Ringer');
        expect(screen.queryByRole('button', { name: 'Make station host' })).not.toBeInTheDocument();
    });

    it('never offers the host button for the newsreader, who reads the news and never presents', async () => {
        listPersonas.mockResolvedValue({
            personas: [persona({ id: 'p-3', key: 'newsdesk', kind: 'newsreader', label: 'Newsdesk', defaultHost: false })],
        });
        render(<PersonasPage />);

        expect(await screen.findByText('Newsreader')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Make station host' })).not.toBeInTheDocument();
    });

    it('offers a newsreader only while the station has none', async () => {
        listPersonas.mockResolvedValue({ personas: [persona()] });
        const user = setupUser();
        const { unmount } = render(<PersonasPage />);
        await user.click(await screen.findByRole('button', { name: 'New caller or guest…' }));
        expect(await screen.findByRole('menuitem', { name: 'New newsreader' })).toBeInTheDocument();
        unmount();

        listPersonas.mockResolvedValue({
            personas: [persona(), persona({ id: 'p-3', key: 'newsdesk', kind: 'newsreader', label: 'Newsdesk', defaultHost: false })],
        });
        render(<PersonasPage />);
        await screen.findByText('Newsdesk');
        await user.click(screen.getByRole('button', { name: 'New caller or guest…' }));
        expect(await screen.findByRole('menuitem', { name: 'New guest' })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: 'New newsreader' })).not.toBeInTheDocument();
    });

    // One character in several jobs is one card, under the first kind it has, badged with the rest.
    it('lists a host who also drops by once, among the hosts, badged with what else they do', async () => {
        listPersonas.mockResolvedValue({ personas: [persona({ kinds: ['host', 'guest'] })] });
        render(<PersonasPage />);

        expect(await screen.findByText('Also drops by')).toBeInTheDocument();
        expect(screen.getAllByText('Marlowe')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Make station host' })).toBeInTheDocument();
    });

    it('offers the host button to a newsreader who also hosts', async () => {
        listPersonas.mockResolvedValue({ personas: [persona({ kind: 'host', kinds: ['host', 'newsreader'] })] });
        render(<PersonasPage />);

        expect(await screen.findByText('Reads the news')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Make station host' })).toBeInTheDocument();
    });

    it('never offers the host button for the station\u2019s own host, since it already is', async () => {
        listPersonas.mockResolvedValue({ personas: [persona({ defaultHost: true })] });
        render(<PersonasPage />);

        await screen.findByText('Marlowe');
        expect(screen.queryByRole('button', { name: 'Make station host' })).not.toBeInTheDocument();
    });

    // The badge was read off `active` and said "On air" over it, which is a different question:
    // during a show that named its own host, the station's own host is not the one speaking, and
    // this page was the place an operator went to find out who was.
    it('puts "On air now" on the character actually presenting, not on the station\u2019s own host', async () => {
        listPersonas.mockResolvedValue({
            personas: [persona({ defaultHost: true }), persona({ id: 'p-2', key: 'wisecrack', label: 'Fran', presenting: true })],
        });
        render(<PersonasPage />);

        // The badges sit beside the name in one Group, so the name's own parent is the card's
        // heading row and scopes each assertion to the right character. By paragraph, since the
        // Presenting now strip names whoever is speaking too.
        const speaking = (await screen.findByText('Fran', { selector: 'p' })).parentElement;
        expect(within(speaking as HTMLElement).getByText('On air now')).toBeInTheDocument();

        const stationsOwn = screen.getByText('Marlowe', { selector: 'p' }).parentElement;
        expect(within(stationsOwn as HTMLElement).getByText('Station\u2019s own')).toBeInTheDocument();
        expect(within(stationsOwn as HTMLElement).queryByText('On air now')).not.toBeInTheDocument();
    });

    // A show with a co-host has two characters on air, and the page used to badge only the one
    // writing the breaks.
    it('badges a co-host on air beside the host presenting', async () => {
        listPersonas.mockResolvedValue({
            personas: [
                persona({ id: 'p-2', key: 'wisecrack', label: 'Fran', presenting: true }),
                persona({ id: 'p-3', key: 'sidekick', label: 'Garth', coHosting: true }),
            ],
        });
        render(<PersonasPage />);

        const cohost = (await screen.findByText('Garth', { selector: 'p' })).parentElement;
        expect(within(cohost as HTMLElement).getByText('On air now, co-host')).toBeInTheDocument();
        expect(within(screen.getByText('Fran', { selector: 'p' }).parentElement as HTMLElement).getByText('On air now')).toBeInTheDocument();
    });

    it('says "On air now" once when the station\u2019s own host is the one presenting', async () => {
        // The ordinary station, where the two questions have one answer: one badge, not two.
        listPersonas.mockResolvedValue({ personas: [persona({ defaultHost: true, presenting: true })] });
        render(<PersonasPage />);

        await screen.findByText('Marlowe', { selector: 'p' });
        expect(screen.getByText('On air now')).toBeInTheDocument();
        expect(screen.queryByText('Station\u2019s own')).not.toBeInTheDocument();
    });

    it('names the hosts a caller rings in to, and says nothing on a caller tied to nobody', async () => {
        listPersonas.mockResolvedValue({
            personas: [
                persona({ id: 'h-1', key: 'conspiracy', label: 'Conspiracy host' }),
                persona({ id: 'c-1', key: 'trucker', kind: 'caller', label: 'Trucker', hosts: ['h-1', 'gone'] }),
                persona({ id: 'c-2', key: 'pedant', kind: 'caller', label: 'Pedant' }),
            ],
        });
        render(<PersonasPage />);

        // The id the roster no longer holds is skipped rather than printed as an id.
        expect(await screen.findByText('Rings in to Conspiracy host')).toBeInTheDocument();
        expect(screen.getAllByText(/^Rings in to/)).toHaveLength(1);
    });

    it('still renders a name, a description and the three actions on a phone', async () => {
        // Below 500px the action row used to hold its intrinsic width while the left column
        // collapsed toward zero, printing the buttons over the persona's name.
        const restore = stubPhoneMedia();
        try {
            listPersonas.mockResolvedValue({ personas: [persona()] });
            render(<PersonasPage />);

            expect(await screen.findByText('Marlowe')).toBeInTheDocument();
            expect(screen.getByText('A late-night crime writer with a weakness for a good record.')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Make station host' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Rehearse' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
        } finally {
            restore();
        }
    });

    // Export all, Import and Restore built-ins were three buttons at the weight of New host. They are
    // about the roster as a file, so they sit behind one menu, and the export says what it is doing
    // in a notification because the item that asked has closed by then.
    it('keeps the roster file actions behind one menu, and the export reports itself', async () => {
        shown.mockClear();
        listPersonas.mockResolvedValue({ personas: [persona()] });
        exportPersonas.mockResolvedValue({ data: { format: 'deadair.personas', version: 1, personas: [] }, headers: {} });
        const user = setupUser();
        render(<PersonasPage />);

        await screen.findByText('Marlowe');
        expect(screen.queryByRole('button', { name: 'Export all' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Restore built-ins' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'More for the whole roster' }));
        expect(screen.getByRole('menuitem', { name: 'Import' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Restore built-ins' })).toBeInTheDocument();
        await user.click(screen.getByRole('menuitem', { name: 'Export all' }));

        await waitFor(() => expect(shown).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'The roster was exported.' })));
        expect(shown).toHaveBeenCalledWith(expect.objectContaining({ message: 'Exporting the roster…', loading: true }));
        expect(exportPersonas).toHaveBeenCalledTimes(1);
    });

    it('leaves a failed roster export on the page rather than in a notification', async () => {
        shown.mockClear();
        listPersonas.mockResolvedValue({ personas: [persona()] });
        exportPersonas.mockRejectedValue(new Error('disk full'));
        const user = setupUser();
        render(<PersonasPage />);

        await screen.findByText('Marlowe');
        await user.click(screen.getByRole('button', { name: 'More for the whole roster' }));
        await user.click(screen.getByRole('menuitem', { name: 'Export all' }));

        expect(await screen.findByText('The personas could not be exported')).toBeInTheDocument();
        expect(shown).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'The roster was exported.' }));
    });

    // The strip used to draw only during a show with its own host, with the presenter name and the
    // story wait as two full cards beneath it. Now it says who is speaking in every state, and the
    // two settings open from it.
    it('says who is presenting, and opens the presenter settings from the strip', async () => {
        listPersonas.mockResolvedValue({
            personas: [persona({ defaultHost: true, presenting: true }), persona({ id: 'p-2', key: 'sidekick', label: 'Garth', coHosting: true })],
        });
        const user = setupUser();
        render(<PersonasPage />);

        expect(await screen.findByText(/is presenting, as the station's own host/)).toBeInTheDocument();
        expect(screen.getByText('With Garth beside them as co-host.')).toBeInTheDocument();
        // The two settings are no longer cards on the page.
        expect(screen.queryByText('Presenter name')).not.toBeInTheDocument();
        expect(screen.queryByText('Returning to a story')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Settings for presenters' }));
        expect(await screen.findByRole('textbox', { name: 'Presenter name' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: /Wait before returning to a story/ })).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(2);
    });

    it('says so when nobody is presenting', async () => {
        listPersonas.mockResolvedValue({ personas: [persona()] });
        render(<PersonasPage />);

        expect(await screen.findByText(/Nobody is presenting/)).toBeInTheDocument();
    });

    it('narrows the roster by kind, and to the ones that spoke in the last day', async () => {
        listPersonas.mockResolvedValue({
            personas: [
                persona(),
                persona({ id: 'p-2', key: 'trucker', kind: 'caller', label: 'Trucker' }),
                persona({ id: 'p-3', key: 'expert', kind: 'guest', label: 'Expert' }),
            ],
        });
        readScriptSummary.mockResolvedValueOnce({ hours: 24, rows: [{ personaKey: 'trucker', written: 3, declined: 0, failed: 0 }] });
        const user = setupUser();
        render(<PersonasPage />);
        await screen.findByText('Marlowe', { selector: 'p' });

        await user.click(screen.getByRole('radio', { name: 'Callers and guests' }));
        expect(screen.queryByText('Marlowe', { selector: 'p' })).not.toBeInTheDocument();
        expect(screen.getByText('Trucker', { selector: 'p' })).toBeInTheDocument();
        expect(screen.getByText('Expert', { selector: 'p' })).toBeInTheDocument();

        await user.click(screen.getByRole('radio', { name: 'Hosts' }));
        expect(screen.getByText('Marlowe', { selector: 'p' })).toBeInTheDocument();
        expect(screen.queryByText('Trucker', { selector: 'p' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('radio', { name: 'Spoke in 24 h' }));
        expect(screen.getByText('Trucker', { selector: 'p' })).toBeInTheDocument();
        expect(screen.queryByText('Marlowe', { selector: 'p' })).not.toBeInTheDocument();
        expect(screen.queryByText('Expert', { selector: 'p' })).not.toBeInTheDocument();
    });

    // The first block in `upcoming` is the one on now when there is one, so Next goes to the first
    // block that has not started, and only when its slot names a host of its own.
    it('badges the host of the next block on the schedule as Next', async () => {
        listPersonas.mockResolvedValue({
            personas: [persona({ defaultHost: true, presenting: true }), persona({ id: 'p-2', key: 'owl', label: 'Night owl' })],
        });
        readCurrentSlot.mockResolvedValueOnce({
            now: '2026-11-18 21:30:00',
            upcoming: [
                { slotId: 's-on', label: 'Evening', start: '2026-11-18 18:00:00', end: '2026-11-18 22:00:00' },
                { slotId: 's-late', label: 'Late', start: '2026-11-18 22:00:00', end: '2026-11-18 23:59:59' },
            ],
        });
        listSchedule.mockResolvedValueOnce({
            slots: [
                { id: 's-on', label: 'Evening', startsAtMinutes: 1080, endsAtMinutes: 1320, personaId: 'p-1' },
                { id: 's-late', label: 'Late', startsAtMinutes: 1320, endsAtMinutes: 0, personaId: 'p-2' },
            ],
        });
        render(<PersonasPage />);

        const owl = (await screen.findByText('Night owl', { selector: 'p' })).parentElement as HTMLElement;
        expect(await within(owl).findByText('Next')).toBeInTheDocument();
        expect(screen.getAllByText('Next')).toHaveLength(1);
    });

    it('gives no one Next when the next block is the station’s own host', async () => {
        listPersonas.mockResolvedValue({ personas: [persona()] });
        readCurrentSlot.mockResolvedValueOnce({
            now: '2026-11-18 21:30:00',
            upcoming: [{ slotId: 's-late', label: 'Late', start: '2026-11-18 22:00:00', end: '2026-11-18 23:59:59' }],
        });
        listSchedule.mockResolvedValueOnce({ slots: [{ id: 's-late', label: 'Late', startsAtMinutes: 1320, endsAtMinutes: 0 }] });
        render(<PersonasPage />);

        await screen.findByText('Marlowe', { selector: 'p' });
        await waitFor(() => expect(listSchedule).toHaveBeenCalled());
        expect(screen.queryByText('Next')).not.toBeInTheDocument();
    });

    it('widens a card to the whole row while one of its panels is open', async () => {
        listPersonas.mockResolvedValue({ personas: [persona()] });
        readScriptPerformance.mockResolvedValue({ days: 30, rows: [] });
        const user = setupUser();
        const { container } = render(<PersonasPage />);
        await screen.findByText('Marlowe', { selector: 'p' });
        expect(container.querySelector('[data-wide]')).toBeNull();

        await user.click(screen.getByRole('button', { name: 'More about Marlowe' }));
        await user.click(await screen.findByRole('menuitem', { name: 'How it is doing' }));

        expect(container.querySelector('[data-wide]')).not.toBeNull();
    });
});
