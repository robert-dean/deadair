import { describe, expect, it, vi } from 'vitest';
import { Text } from '@mantine/core';

import { PhoneCard } from '../../../src/components/shared/phone.card';
import { render, screen, setupUser } from '../../utils/render';

describe('PhoneCard', () => {
    it('renders every slot it is given', () => {
        render(
            <PhoneCard
                leading={<span>art</span>}
                title={<Text truncate>Blue in Green</Text>}
                subtitle={<Text truncate>Miles Davis</Text>}
                figure={<span className="da-num">5:37</span>}
                action={<button type="button">Drop</button>}
                below={<span>a rating row</span>}
            />,
        );

        expect(screen.getByText('art')).toBeInTheDocument();
        expect(screen.getByText('Blue in Green')).toBeInTheDocument();
        expect(screen.getByText('Miles Davis')).toBeInTheDocument();
        expect(screen.getByText('5:37')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Drop' })).toBeInTheDocument();
        expect(screen.getByText('a rating row')).toBeInTheDocument();
    });

    it('is a button when it opens something, and reachable by keyboard', async () => {
        const user = setupUser();
        const onClick = vi.fn();
        render(<PhoneCard title={<Text>pick a record</Text>} onClick={onClick} aria-label="Open the decision" />);

        const card = screen.getByRole('button', { name: 'Open the decision' });
        await user.click(card);
        card.focus();
        await user.keyboard('{Enter}');
        await user.keyboard(' ');

        expect(onClick).toHaveBeenCalledTimes(3);
    });

    it('is not interactive at all without a tap to offer', () => {
        render(<PhoneCard title={<Text>just a row</Text>} />);

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('draws the accent bar on the one card that is happening now', () => {
        const { container } = render(<PhoneCard title={<Text>on air</Text>} accent="var(--mantine-color-red-6)" />);

        const card = container.querySelector('.mantine-Card-root');
        expect(card).not.toBeNull();
        expect((card as HTMLElement).style.boxShadow).toBe('inset 3px 0 0 var(--mantine-color-red-6)');
        expect((card as HTMLElement).style.background).toBe('var(--da-raised)');
    });

    it('indents a tree row by its depth, and a flat one not at all', () => {
        const flat = render(<PhoneCard title={<Text>a decision</Text>} />);
        expect((flat.container.querySelector('.mantine-Card-root') as HTMLElement).style.marginLeft).toBe('');

        const nested = render(<PhoneCard title={<Text>a child call</Text>} depth={2} />);
        expect((nested.container.querySelector('.mantine-Card-root') as HTMLElement).style.marginLeft).not.toBe('');
    });
});
