// An arc is the one kind of story whose panel has to say something a shelf never had to: where the
// telling has got to. What is pinned here is that the parts are shown in order with the next one
// marked, that only an arc shows them at all, and that a new part is numbered with room left to put
// something between it and the one before — because renumbering an arc by hand is the thing the
// gaps in `ordinal` exist to avoid.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersonaStory, PersonaStoryList } from '@deadair/sdk';

import { PersonaStoriesPanel } from '../../../src/components/personas/persona.stories';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listPersonaStories = vi.fn();
const addPersonaStoryBeat = vi.fn();
const setPersonaStoryBeatState = vi.fn();
const deletePersonaStoryBeat = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        personas: {
            listPersonaStories: (...args: unknown[]) => listPersonaStories(...args),
            addPersonaStoryBeat: (...args: unknown[]) => addPersonaStoryBeat(...args),
            setPersonaStoryBeatState: (...args: unknown[]) => setPersonaStoryBeatState(...args),
            deletePersonaStoryBeat: (...args: unknown[]) => deletePersonaStoryBeat(...args),
        },
    },
}));

afterEach(() => {
    listPersonaStories.mockReset();
    addPersonaStoryBeat.mockReset();
    setPersonaStoryBeatState.mockReset();
    deletePersonaStoryBeat.mockReset();
});

const beat = (id: string, ordinal: number, text: string, state: 'active' | 'suggested' = 'active') => ({
    id,
    storyId: 's1',
    ordinal,
    beat: text,
    state,
    origin: state === 'suggested' ? ('model' as const) : ('operator' as const),
    createdAt: '2026-05-01T00:00:00.000Z',
});

const story = (over: Partial<PersonaStory> = {}): PersonaStory =>
    ({
        id: 's1',
        title: 'The letter from the station manager',
        story: 'It started with a letter.',
        kind: 'arc',
        state: 'active',
        origin: 'operator',
        details: [],
        beats: [beat('b1', 10, 'You opened it in the car park.'), beat('b2', 20, 'You read it twice.')],
        timesTold: 0,
        createdAt: '2026-05-01T00:00:00.000Z',
        ...over,
    }) as PersonaStory;

const list = (stories: PersonaStory[]): PersonaStoryList => ({ personaId: 'p1', stories });

const panel = () => <PersonaStoriesPanel personaId="p1" />;

describe('an arc on the shelf', () => {
    it('shows its parts in telling order', async () => {
        listPersonaStories.mockResolvedValue(list([story()]));

        render(panel());

        expect(await screen.findByText('You opened it in the car park.')).toBeInTheDocument();
        expect(screen.getByText('You read it twice.')).toBeInTheDocument();
    });

    it('marks the one that goes out next', async () => {
        listPersonaStories.mockResolvedValue(list([story()]));

        render(panel());

        expect(await screen.findByText('next')).toBeInTheDocument();
    });

    it('does not mark a proposal as next, because a proposal is not told', async () => {
        listPersonaStories.mockResolvedValue(list([story({ beats: [beat('b1', 10, 'Something nobody approved.', 'suggested')] })]));

        render(panel());

        await screen.findByText(/Something nobody approved/);
        expect(screen.queryByText('next')).not.toBeInTheDocument();
    });

    it('offers to keep or reject a proposed part rather than delete it', async () => {
        // A deleted proposal comes back on the next pass over the same material, forever. The same
        // rule the notebook and the shelf already follow.
        listPersonaStories.mockResolvedValue(list([story({ beats: [beat('b1', 10, 'A part the station thought of.', 'suggested')] })]));

        render(panel());

        expect(await screen.findByRole('button', { name: 'Keep' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    });

    it('numbers a new part past the last one, with room to insert before it', async () => {
        listPersonaStories.mockResolvedValue(list([story()]));
        addPersonaStoryBeat.mockResolvedValue(list([story()]));
        const user = setupUser();

        render(panel());
        const field = await screen.findByLabelText('The next part of this story');
        await user.type(field, 'You never did reply.{Enter}');

        // Ten past the last, not last + 1: an operator putting something between two parts must not
        // have to renumber either of them, which is what the gaps in `ordinal` are for.
        await waitFor(() => expect(addPersonaStoryBeat).toHaveBeenCalledWith('p1', 's1', { ordinal: 30, beat: 'You never did reply.' }));
    });
});

describe('the other two kinds', () => {
    it('shows no parts for an anecdote, and no way to add one', async () => {
        listPersonaStories.mockResolvedValue(list([story({ kind: 'anecdote', beats: [] })]));

        render(panel());

        await screen.findByText('It started with a letter.');
        expect(screen.queryByLabelText('The next part of this story')).not.toBeInTheDocument();
    });

    it('shows none for a bit either, whose history is what it has instead', async () => {
        listPersonaStories.mockResolvedValue(list([story({ kind: 'bit', beats: [] })]));

        render(panel());

        await screen.findByText('It started with a letter.');
        expect(screen.queryByLabelText('The next part of this story')).not.toBeInTheDocument();
    });
});
