// The editor's list boxes are one entry per line on screen and an array on the wire. What is worth
// holding still is that a field the station REFUSES scripts over reaches the save as written, since a
// line lost between the box and the API is a check that silently stops checking.

import { describe, expect, it, vi } from 'vitest';
import type { Persona, PersonaInput } from '@deadair/sdk';

import { PersonaEditor } from '../../../src/components/personas/persona.editor';
import { render, screen, setupUser } from '../../utils/render';

// The editor opens the voice list, the pad library and two mutations on mount. None of them is what
// this suite is about, so each answers as a station with nothing configured.
vi.mock('../../../src/api/personas.queries', () => ({
    usePersonas: () => ({ data: { personas: roster }, isLoading: false }),
    useGeneratePersona: () => ({ mutate: vi.fn(), isPending: false }),
    useRehearsePersona: () => ({ mutate: vi.fn(), isPending: false, data: undefined, reset: vi.fn() }),
}));
vi.mock('../../../src/api/pads.queries', () => ({ usePads: () => ({ data: undefined, isLoading: false }) }));
vi.mock('../../../src/api/voices.queries', () => ({
    useVoices: () => ({ data: undefined, isLoading: false }),
    fetchVoiceSample: vi.fn(),
}));

const believer: Persona = {
    id: 'p-1',
    key: 'conspiracy',
    kind: 'host',
    label: 'Conspiracy host',
    style: 'a man who believes all of it',
    exclusiveSubjects: ['bigfoot, sasquatch', 'chemtrail, contrail'],
    defaultHost: false,
    presenting: false,
};

const tipster: Persona = {
    id: 'c-1',
    key: 'tipster',
    kind: 'caller',
    label: 'Caller with proof coming',
    style: 'a listener who suspects the host',
    defaultHost: false,
    presenting: false,
};

// Read by the mock above when the editor asks for the roster, so hoisting is not a problem: the
// factory's closure is only called at render.
const roster: Persona[] = [
    believer,
    { ...believer, id: 'p-2', key: 'classic', label: 'Classic host' },
    { ...tipster, id: 'c-2', key: 'trucker', label: 'Caller who agrees with everything' },
];

const open = (onSubmit: (draft: PersonaInput) => void) =>
    render(<PersonaEditor persona={believer} kind="host" opened onClose={() => {}} onSubmit={onSubmit} saving={false} />);

describe('PersonaEditor, the subjects kept apart', () => {
    it('shows one subject per line', async () => {
        open(() => {});

        expect(await screen.findByLabelText('Never in the same break')).toHaveValue('bigfoot, sasquatch\nchemtrail, contrail');
    });

    it('saves each line as one subject', async () => {
        const onSubmit = vi.fn();
        const user = setupUser();
        open(onSubmit);

        const box = await screen.findByLabelText('Never in the same break');
        await user.type(box, '\n  moon landing, soundstage  ');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0]![0].exclusiveSubjects).toEqual(['bigfoot, sasquatch', 'chemtrail, contrail', 'moon landing, soundstage']);
    });
});

// A caller can be tied to the hosts it rings in to. The editor's share of that is offering hosts and
// only hosts, getting the choice onto the wire, and not drawing the field for a host at all.
describe('PersonaEditor, who a caller rings', () => {
    const openCaller = (onSubmit: (draft: PersonaInput) => void, caller: Persona = tipster) =>
        render(<PersonaEditor persona={caller} kind="caller" opened onClose={() => {}} onSubmit={onSubmit} saving={false} />);

    it('offers the hosts and never another caller', async () => {
        const user = setupUser();
        openCaller(() => {});

        await user.click(await screen.findByRole('combobox', { name: 'Rings in to' }));

        expect(await screen.findByRole('option', { name: 'Conspiracy host' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Classic host' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Caller who agrees with everything' })).not.toBeInTheDocument();
    });

    it('saves the hosts chosen', async () => {
        const onSubmit = vi.fn();
        const user = setupUser();
        openCaller(onSubmit);

        await user.click(await screen.findByRole('combobox', { name: 'Rings in to' }));
        await user.click(await screen.findByRole('option', { name: 'Conspiracy host' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit.mock.calls[0]![0].hosts).toEqual(['p-1']);
    });

    it('sends no hosts once the last one is removed, which unties the caller', async () => {
        const onSubmit = vi.fn();
        const user = setupUser();
        openCaller(onSubmit, { ...tipster, hosts: ['p-1'] });

        // By label, as `plugin.config.form.test.tsx` removes a kind: Mantine takes a pill's remove
        // button out of the accessibility tree, and the label is what makes it findable at all.
        await user.click(await screen.findByLabelText('Remove Conspiracy host'));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('hosts');
    });

    it('is not drawn for a host', async () => {
        open(() => {});

        await screen.findByLabelText('Never in the same break');
        expect(screen.queryByRole('combobox', { name: 'Rings in to' })).not.toBeInTheDocument();
    });
});

// A character may do several things. The editor's share is ticking them, drawing each half of the
// sheet for whoever does that job, and sending the set rather than the one kind it opened as.
describe('PersonaEditor, what a character does', () => {
    it('ticks what the character already does', async () => {
        render(
            <PersonaEditor
                persona={{ ...believer, kinds: ['host', 'guest'] }}
                kind="host"
                opened
                onClose={() => {}}
                onSubmit={() => {}}
                saving={false}
            />,
        );

        expect(await screen.findByRole('checkbox', { name: 'Hosts' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Drops by' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Rings in' })).not.toBeChecked();
    });

    it('draws the ties for a host who also drops by, and offers every host but them', async () => {
        const user = setupUser();
        open(() => {});

        await user.click(await screen.findByRole('checkbox', { name: 'Drops by' }));
        await user.click(await screen.findByRole('combobox', { name: 'Drops by' }));

        expect(await screen.findByRole('option', { name: 'Classic host' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Conspiracy host' })).not.toBeInTheDocument();
    });

    it('saves the kinds in the order the station ranks them, with the ties', async () => {
        const onSubmit = vi.fn();
        const user = setupUser();
        open(onSubmit);

        await user.click(await screen.findByRole('checkbox', { name: 'Drops by' }));
        await user.click(await screen.findByRole('combobox', { name: 'Drops by' }));
        await user.click(await screen.findByRole('option', { name: 'Classic host' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit.mock.calls[0]![0]).toMatchObject({ kinds: ['host', 'guest'], hosts: ['p-2'] });
        expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('kind');
    });

    it('drops the phrasings once the character no longer presents', async () => {
        const user = setupUser();
        open(() => {});

        expect(await screen.findByLabelText('Phrasings', { exact: false })).toBeInTheDocument();
        await user.click(screen.getByRole('checkbox', { name: 'Hosts' }));
        await user.click(screen.getByRole('checkbox', { name: 'Rings in' }));

        expect(screen.queryByLabelText('Phrasings', { exact: false })).not.toBeInTheDocument();
    });

    it('will not save a character who does nothing', async () => {
        const onSubmit = vi.fn();
        const user = setupUser();
        open(onSubmit);

        await user.click(await screen.findByRole('checkbox', { name: 'Hosts' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).not.toHaveBeenCalled();
        expect(await screen.findByText('Tick at least one thing this character does')).toBeInTheDocument();
    });

    it('closes the newsreader box while somebody else reads the news', async () => {
        roster.push({ ...believer, id: 'n-1', key: 'newsreader', kind: 'newsreader', kinds: ['newsreader'], label: 'Walter' });
        try {
            open(() => {});

            expect(await screen.findByRole('checkbox', { name: 'Reads the news' })).toBeDisabled();
            expect(screen.getByText('Walter reads the news, and a station has one newsreader.')).toBeInTheDocument();
        } finally {
            roster.pop();
        }
    });
});

// A quirk is a row with a rung since quirks carried a cadence. What has to hold still is that the
// rung survives the round trip: a save that dropped it would turn "yell for Sharon, rarely" back
// into a rule sent on every break, with nothing on screen saying so.
describe('PersonaEditor, quirks and how often they apply', () => {
    const ghost: Persona = {
        ...believer,
        id: 'p-3',
        key: 'ozzysghost',
        label: "Ozzy's Ghost",
        quirks: [{ text: 'Call your show the Boneyard' }, { text: 'Yell for Sharon', cadence: 'rarely' }],
    };
    const openGhost = (onSubmit: (draft: PersonaInput) => void) =>
        render(<PersonaEditor persona={ghost} kind="host" opened onClose={() => {}} onSubmit={onSubmit} saving={false} />);

    it('draws one row per quirk, with an absent cadence shown as always', async () => {
        openGhost(() => {});

        expect(await screen.findByLabelText('Quirk 1')).toHaveValue('Call your show the Boneyard');
        expect(screen.getByLabelText('Quirk 2')).toHaveValue('Yell for Sharon');
        expect(screen.getByLabelText('How often quirk 1 applies', { selector: 'input' })).toHaveValue('Always');
        expect(screen.getByLabelText('How often quirk 2 applies', { selector: 'input' })).toHaveValue('Rarely');
    });

    it('saves each cadence it was given and none on an always quirk', async () => {
        const onSubmit = vi.fn();
        const user = setupUser();
        openGhost(onSubmit);

        await user.click(await screen.findByRole('button', { name: 'Save' }));

        expect(onSubmit.mock.calls[0]![0].quirks).toEqual([{ text: 'Call your show the Boneyard' }, { text: 'Yell for Sharon', cadence: 'rarely' }]);
    });

    it('adds a row, and leaves a blank one out of the save', async () => {
        const onSubmit = vi.fn();
        const user = setupUser();
        openGhost(onSubmit);

        await user.click(await screen.findByRole('button', { name: 'Add a quirk' }));
        await user.click(screen.getByRole('button', { name: 'Add a quirk' }));
        await user.type(screen.getByLabelText('Quirk 3'), 'Insist the bat was rubber');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit.mock.calls[0]![0].quirks).toEqual([
            { text: 'Call your show the Boneyard' },
            { text: 'Yell for Sharon', cadence: 'rarely' },
            { text: 'Insist the bat was rubber' },
        ]);
    });

    it('removes a quirk', async () => {
        const onSubmit = vi.fn();
        const user = setupUser();
        openGhost(onSubmit);

        await user.click(await screen.findByRole('button', { name: 'Remove quirk 1' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit.mock.calls[0]![0].quirks).toEqual([{ text: 'Yell for Sharon', cadence: 'rarely' }]);
    });
});
