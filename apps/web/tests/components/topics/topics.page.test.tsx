// The subjects page on a phone. The table was 500px wide, which put each subject's delete button past
// the right edge of a 375px page; a phone draws a card per subject instead, and what is worth pinning
// is that the card still opens the subject and the button still deletes it rather than opening it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Topic, TopicKindDescriptor } from '@deadair/sdk';

import { TopicsPage } from '../../../src/components/topics/topics.page';
import { stubPhoneMedia } from '../../utils/phone';
import { render, screen, setupUser } from '../../utils/render';

const listTopics = vi.fn();
const listTopicKinds = vi.fn();
const listClockBands = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        topics: {
            listTopics: (...args: unknown[]) => listTopics(...args),
            listTopicKinds: (...args: unknown[]) => listTopicKinds(...args),
        },
        director: {
            listClockBands: (...args: unknown[]) => listClockBands(...args),
        },
    },
}));

const news: TopicKindDescriptor = { kind: 'news', nounOne: 'category', nounMany: 'Categories', description: 'What the news is about.', fields: [] };

const topic: Topic = { id: '22222222-2222-4222-8222-222222222222', kind: 'news', key: 'world', label: 'World news', config: {}, position: 0 };

let restore: (() => void) | undefined;

beforeEach(() => {
    listTopics.mockResolvedValue({ topics: [topic] });
    listTopicKinds.mockResolvedValue({ kinds: [news] });
    listClockBands.mockResolvedValue({ bands: [] });
});

afterEach(() => {
    restore?.();
    restore = undefined;
    vi.resetAllMocks();
});

describe('TopicsPage on a phone', () => {
    it('draws a card per subject rather than a table', async () => {
        restore = stubPhoneMedia();
        const { container } = render(<TopicsPage />);

        expect(await screen.findByRole('button', { name: 'Edit World news' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete World news' })).toBeInTheDocument();
        expect(container.querySelector('table')).toBeNull();
    });

    it('asks before deleting, without opening the subject underneath', async () => {
        restore = stubPhoneMedia();
        const user = setupUser();
        render(<TopicsPage />);

        await user.click(await screen.findByRole('button', { name: 'Delete World news' }));

        expect(await screen.findByText('Delete World news?')).toBeInTheDocument();
        expect(screen.queryByText('Edit category')).toBeNull();
    });

    it('opens the subject from its card', async () => {
        restore = stubPhoneMedia();
        const user = setupUser();
        render(<TopicsPage />);

        await user.click(await screen.findByRole('button', { name: 'Edit World news' }));

        expect(await screen.findByText('Edit category')).toBeInTheDocument();
    });
});

describe('TopicsPage on a desk', () => {
    it('keeps the table', async () => {
        const { container } = render(<TopicsPage />);

        expect(await screen.findByRole('button', { name: 'Delete World news' })).toBeInTheDocument();
        expect(container.querySelector('table')).not.toBeNull();
    });
});
