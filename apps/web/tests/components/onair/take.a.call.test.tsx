// Putting somebody on the phone from the page about the show that is running. What it has to get
// right is the inheritance: the call belongs to THIS broadcast, so it takes the broadcast's host, and
// NOT its brief, which is what the broadcast plays rather than what the host's callers ring about.

import { describe, expect, it, vi } from 'vitest';

import { TakeACall } from '../../../src/components/onair/take.a.call';
import { render, screen, setupUser } from '../../utils/render';

const requested: unknown[] = [];

vi.mock('../../../src/api/client', () => ({
    sdk: {
        productions: {
            requestProduction: (body: unknown) => {
                requested.push(body);
                return Promise.resolve({ id: 'p1' });
            },
            listProductions: () => Promise.resolve({ productions: [] }),
        },
    },
}));

const open = async (props: { personaId?: string } = {}) => {
    requested.length = 0;
    render(<TakeACall {...props} />);
    const user = setupUser();
    await user.click(screen.getByRole('button', { name: 'Take a call' }));
    return user;
};

const confirm = async (user: ReturnType<typeof setupUser>) => {
    const buttons = screen.getAllByRole('button', { name: 'Take a call' });
    await user.click(buttons[buttons.length - 1]!);
};

describe('TakeACall', () => {
    it('asks for a call-in, which is the kind that has somebody on the phone', async () => {
        const user = await open({ personaId: 'persona-1' });
        await confirm(user);

        expect(requested[0]).toMatchObject({ kind: 'callin' });
    });

    it('takes the broadcast host, so the call is presented by whoever is presenting', async () => {
        const user = await open({ personaId: 'persona-1' });
        await confirm(user);

        expect(requested[0]).toMatchObject({ personaId: 'persona-1' });
    });

    // A broadcast's brief is its playlist. Seeded into the box, every call on the conspiracy show was
    // planned around the records and never around the host's own subject.
    it('sends no brief unless somebody types one, so the call is about the show the host is presenting', async () => {
        const user = await open({ personaId: 'persona-1' });

        expect(screen.getByLabelText('What they are ringing about')).toHaveValue('');
        await confirm(user);

        expect(requested[0]).not.toHaveProperty('brief');
    });

    it('takes what the operator typed', async () => {
        const user = await open();
        await user.type(screen.getByLabelText('What they are ringing about'), 'the drummer nobody rates');
        await confirm(user);

        expect(requested[0]).toMatchObject({ brief: 'the drummer nobody rates' });
    });

    it('sends no title, because the station names it after the moment', async () => {
        // A required box there would be a form standing between an operator and a button. The API
        // falls back to the same name a clock-commissioned one gets.
        const user = await open();
        await confirm(user);

        expect(requested[0]).not.toHaveProperty('title');
        expect(requested[0]).not.toHaveProperty('brief');
    });
});
