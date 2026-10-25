// The kinds of break an operator writes (Ideas #24). What the page owes beyond a list and a form is
// that each row says whether it can actually air, from the clock's own answer, and that the editor
// sends the station exactly the shape it holds: a key it can never change, rules as a list.

import { describe, expect, it, vi } from 'vitest';
import { SdkError, type BreakKind, type BreakKindList, type ClockBandList } from '@deadair/sdk';

import { BreakKindsPage } from '../../../src/components/breaks/break.kinds.page';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';

const listBreakKinds = vi.fn();
const createBreakKind = vi.fn();
const updateBreakKind = vi.fn();
const deleteBreakKind = vi.fn();
const listClockBands = vi.fn();
const exportBreakKinds = vi.fn();
const exportBreakKind = vi.fn();
const previewBreakKindImport = vi.fn();
const importBreakKinds = vi.fn();
const saveJsonDownload = vi.fn();

vi.mock('../../../src/components/shared/download', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../src/components/shared/download')>()),
    saveJsonDownload: (document: unknown, filename: string) => saveJsonDownload(document, filename),
}));

vi.mock('../../../src/api/client', () => ({
    sdk: {
        director: {
            listBreakKinds: () => listBreakKinds(),
            createBreakKind: (body: unknown) => createBreakKind(body),
            updateBreakKind: (id: string, body: unknown) => updateBreakKind(id, body),
            deleteBreakKind: (id: string) => deleteBreakKind(id),
            listClockBands: () => listClockBands(),
            exportBreakKinds: () => exportBreakKinds(),
            exportBreakKind: (id: string) => exportBreakKind(id),
            previewBreakKindImport: (body: unknown, query: unknown) => previewBreakKindImport(body, query),
            importBreakKinds: (body: unknown, query: unknown) => importBreakKinds(body, query),
        },
    },
}));

const kind = (over: Partial<BreakKind> = {}): BreakKind => ({
    id: 'kind-1',
    key: 'poem',
    name: 'A poem about the moment',
    brief: 'Two unrhymed lines about this moment on the station.',
    rules: [],
    showsPrevious: true,
    showsPlayed: false,
    showsFacts: true,
    showsNotebook: true,
    enabled: true,
    position: 0,
    ...over,
});

const list = (...kinds: BreakKind[]): BreakKindList => ({ kinds });
const clock = (bands: string[], producibleKinds: string[]): ClockBandList => ({
    bands: bands.map((bandKind, index) => ({ id: `band-${index}`, kind: bandKind, at: 'clock', minute: 0, position: index, enabled: true })),
    producibleKinds,
});

describe('BreakKindsPage', () => {
    it('says there are none yet, and offers to write one', async () => {
        listBreakKinds.mockResolvedValue(list());
        listClockBands.mockResolvedValue(clock([], []));

        render(<BreakKindsPage />);

        expect(await screen.findByText('No kinds of break yet')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'New kind of break' })).toBeTruthy();
    });

    it('says which kinds can air, which wait on the model, and which are off', async () => {
        listBreakKinds.mockResolvedValue(
            list(
                kind(),
                kind({ id: 'kind-2', key: 'taping', name: 'Taping off the radio' }),
                kind({ id: 'kind-3', key: 'draft', name: 'Still a draft', enabled: false }),
            ),
        );
        listClockBands.mockResolvedValue(clock(['poem', 'poem'], ['poem', 'talkbreak']));

        render(<BreakKindsPage />);

        const poem = (await screen.findByText('A poem about the moment')).closest('tr')!;
        expect(within(poem).getByText('On')).toBeTruthy();
        expect(within(poem).getByText('On 2 bands')).toBeTruthy();

        const taping = screen.getByText('Taping off the radio').closest('tr')!;
        expect(within(taping).getByText('Not airing')).toBeTruthy();
        expect(within(taping).getByText('No band yet')).toBeTruthy();

        const draft = screen.getByText('Still a draft').closest('tr')!;
        expect(within(draft).getByText('Off')).toBeTruthy();
    });

    it('writes a new kind with its rules as a list, switched off, in the next place', async () => {
        listBreakKinds.mockResolvedValue(list(kind()));
        listClockBands.mockResolvedValue(clock([], ['poem']));
        createBreakKind.mockResolvedValue(list(kind(), kind({ id: 'kind-2', key: 'taping', name: 'Taping', enabled: false, position: 1 })));
        const user = setupUser();

        render(<BreakKindsPage />);
        // Opened before the list has arrived, which is the case that used to place it first: the
        // place is worked out when it is saved, against the list as it then stands.
        await user.click(await screen.findByRole('button', { name: 'New kind of break' }));
        await screen.findByText('A poem about the moment');
        await user.type(screen.getByLabelText(/^Name/), 'Taping');
        await user.type(screen.getByLabelText(/On the format clock as/), 'taping');
        await user.type(screen.getByLabelText(/What it is for/), 'A memory of taping songs off the radio.');
        await user.type(screen.getByLabelText(/Rules of its own/), 'One memory only.{enter}{enter}No record names.');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(createBreakKind).toHaveBeenCalled());
        expect(createBreakKind.mock.calls[0]?.[0]).toMatchObject({
            key: 'taping',
            name: 'Taping',
            brief: 'A memory of taping songs off the radio.',
            rules: ['One memory only.', 'No record names.'],
            enabled: false,
            position: 1,
        });
    });

    it('refuses a key the clock could not name, before asking the station', async () => {
        listBreakKinds.mockResolvedValue(list());
        listClockBands.mockResolvedValue(clock([], []));
        const user = setupUser();

        render(<BreakKindsPage />);
        await user.click(await screen.findByRole('button', { name: 'New kind of break' }));
        await user.type(screen.getByLabelText(/^Name/), 'A poem');
        await user.type(screen.getByLabelText(/On the format clock as/), 'A Poem');
        await user.type(screen.getByLabelText(/What it is for/), 'Two lines.');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText('Use lowercase letters and digits, with single hyphens between words.')).toBeTruthy();
        expect(createBreakKind).not.toHaveBeenCalled();
    });

    it('keeps the key locked when editing, and sends the one it was saved under', async () => {
        listBreakKinds.mockResolvedValue(list(kind()));
        listClockBands.mockResolvedValue(clock([], ['poem']));
        updateBreakKind.mockResolvedValue(list(kind({ name: 'A short poem' })));
        const user = setupUser();

        render(<BreakKindsPage />);
        await user.click(await screen.findByText('A poem about the moment'));

        expect(screen.getByLabelText(/On the format clock as/)).toHaveAttribute('readonly');
        const name = screen.getByLabelText(/^Name/);
        await user.clear(name);
        await user.type(name, 'A short poem');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(updateBreakKind).toHaveBeenCalled());
        expect(updateBreakKind.mock.calls[0]?.[0]).toBe('kind-1');
        expect(updateBreakKind.mock.calls[0]?.[1]).toMatchObject({ key: 'poem', name: 'A short poem' });
    });

    it('shows the station’s own reason when it refuses a delete', async () => {
        listBreakKinds.mockResolvedValue(list(kind()));
        listClockBands.mockResolvedValue(clock(['poem'], ['poem']));
        deleteBreakKind.mockRejectedValue(
            new SdkError(
                409,
                'Conflict',
                { statusCode: 409, message: 'Conflict', details: { message: 'a band on the format clock still names "poem". Remove it first' } },
                new Headers(),
            ),
        );
        const user = setupUser();

        render(<BreakKindsPage />);
        await user.click(await screen.findByRole('button', { name: 'Delete A poem about the moment' }));
        await user.click(await screen.findByRole('button', { name: 'Delete' }));

        expect(await screen.findByText(/still names "poem"/)).toBeTruthy();
    });

    it('exports one kind under the filename the station gives it', async () => {
        listBreakKinds.mockResolvedValue(list(kind()));
        listClockBands.mockResolvedValue(clock([], ['poem']));
        const body = { format: 'deadair.break-kinds/1', takenAt: '2026-10-24T12:00:00.000Z', kinds: [] };
        exportBreakKind.mockResolvedValue({ data: body, headers: { contentDisposition: 'attachment; filename="poem-2026-10-24.json"' } });
        const user = setupUser();

        render(<BreakKindsPage />);
        await user.click(await screen.findByRole('button', { name: 'Export A poem about the moment' }));

        await waitFor(() => expect(saveJsonDownload).toHaveBeenCalledWith(body, 'poem-2026-10-24.json'));
        expect(exportBreakKind).toHaveBeenCalledWith('kind-1');
    });

    it('previews a chosen file, offers to replace a kind already here, and says everything arrives switched off', async () => {
        listBreakKinds.mockResolvedValue(list(kind()));
        listClockBands.mockResolvedValue(clock([], ['poem']));
        const plan = (outcome: 'skip' | 'update') => ({
            format: 'deadair.break-kinds/1',
            notices: [],
            kinds: [
                { key: 'poem', name: 'A poem about the moment', outcome, notices: [] },
                { key: 'taping', name: 'Taping off the radio', outcome: 'create', notices: [] },
            ],
        });
        previewBreakKindImport.mockImplementation(async (_body: unknown, query?: { replace?: string[] }) =>
            plan(query?.replace?.includes('poem') ? 'update' : 'skip'),
        );
        importBreakKinds.mockResolvedValue({ plan: plan('update'), created: 1, updated: 1, skipped: 0, kinds: [kind({ enabled: false })] });
        const user = setupUser();

        render(<BreakKindsPage />);
        await user.click(await screen.findByRole('button', { name: 'Import' }));
        const chosen = new File([JSON.stringify({ format: 'deadair.break-kinds/1', takenAt: 'x', kinds: [] })], 'kinds.json', {
            type: 'application/json',
        });
        await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, chosen);

        expect(await screen.findByText('Taping off the radio')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Import 1 kind' })).toBeTruthy();

        await user.click(screen.getByText('Replace'));
        await waitFor(() => expect(previewBreakKindImport).toHaveBeenLastCalledWith(expect.anything(), { replace: ['poem'] }));
        await user.click(await screen.findByRole('button', { name: 'Import 2 kinds' }));

        await waitFor(() => expect(importBreakKinds).toHaveBeenCalledWith(expect.anything(), { replace: ['poem'] }));
        expect(await screen.findByText('Everything imported is switched off. Read each one back, then switch it on.')).toBeTruthy();
    });

    it('says a file it cannot read is unreadable, and asks the station nothing', async () => {
        listBreakKinds.mockResolvedValue(list());
        listClockBands.mockResolvedValue(clock([], []));
        previewBreakKindImport.mockClear();
        const user = setupUser();

        render(<BreakKindsPage />);
        await user.click(await screen.findByRole('button', { name: 'Import' }));
        await user.upload(
            document.querySelector('input[type="file"]') as HTMLInputElement,
            new File(['not json'], 'notes.json', { type: 'application/json' }),
        );

        expect(await screen.findByText('notes.json is not a file this console can read.')).toBeTruthy();
        expect(previewBreakKindImport).not.toHaveBeenCalled();
    });
});
