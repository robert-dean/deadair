// The station's own shows. What is worth pinning is what reaches the station: a show made from a
// template carries the template's subject and length, and an episode asked for carries only the boxes
// that were filled in, so a show with a standing subject needs nothing but a press of the button.

import type { OwnShow, Production } from '@deadair/sdk';
import { DateTime } from 'luxon';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OwnShows, showBodyOf } from '../../../src/components/podcasts/own.shows';
import { render, screen, setupUser, within } from '../../utils/render';

const listOwnShows = vi.fn();
const createOwnShow = vi.fn();
const listOwnShowEpisodes = vi.fn();
const requestOwnShowEpisode = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        podcasts: {
            listOwnShows: (...args: unknown[]) => listOwnShows(...args),
            createOwnShow: (...args: unknown[]) => createOwnShow(...args),
            listOwnShowEpisodes: (...args: unknown[]) => listOwnShowEpisodes(...args),
            requestOwnShowEpisode: (...args: unknown[]) => requestOwnShowEpisode(...args),
            updateOwnShow: vi.fn(),
            deleteOwnShow: vi.fn(),
        },
        personas: { listPersonas: async () => ({ personas: [] }) },
        news: { listFeeds: (...args: unknown[]) => listFeeds(...args) },
    },
}));

const listFeeds = vi.fn();

const WIND_DOWN: OwnShow = {
    id: 'show-1',
    title: 'Wind-down',
    subject: 'something calm to fall asleep to',
    targetMs: 40 * 60_000,
    createdAt: DateTime.fromISO('2026-10-12T08:00:00Z'),
};

const episode = (over: Partial<Production> = {}): Production => ({
    id: 'prod-1',
    kind: 'podcast',
    title: 'Wind-down: lighthouses',
    writingMode: 'outlined',
    targetMs: 40 * 60_000,
    state: 'drafting',
    beats: 3,
    cast: [],
    createdAt: DateTime.fromISO('2026-10-12T21:00:00Z'),
    ...over,
});

beforeEach(() => {
    listFeeds.mockResolvedValue({ feeds: [] });
    listOwnShows.mockResolvedValue({ shows: [WIND_DOWN] });
    listOwnShowEpisodes.mockResolvedValue({ productions: [] });
});

afterEach(() => {
    vi.resetAllMocks();
});

describe('OwnShows', () => {
    it('lists a show with what it is about and how far along its episodes are', async () => {
        listOwnShowEpisodes.mockResolvedValue({ productions: [episode()] });

        render(<OwnShows />);

        expect(await screen.findByText('Wind-down')).toBeInTheDocument();
        expect(screen.getByText('About: something calm to fall asleep to')).toBeInTheDocument();
        expect(await screen.findByText('Wind-down: lighthouses')).toBeInTheDocument();
        expect(screen.getByText('writing it')).toBeInTheDocument();
    });

    it('makes a show from a template, with its subject and its length', async () => {
        listOwnShows.mockResolvedValue({ shows: [] });
        createOwnShow.mockResolvedValue({ ...WIND_DOWN, id: 'show-2' });
        const user = setupUser();
        render(<OwnShows />);

        await user.click(await screen.findByRole('button', { name: 'New show' }));
        await user.click(screen.getByRole('button', { name: 'Wind-down' }));
        await user.click(screen.getByRole('button', { name: 'Make the show' }));

        expect(createOwnShow).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Wind-down',
                targetMs: 40 * 60_000,
                writingMode: 'outlined',
                subject: expect.stringContaining('fall asleep'),
            }),
        );
    });

    it('asks a show with its own subject for an episode with nothing filled in', async () => {
        requestOwnShowEpisode.mockResolvedValue(episode());
        const user = setupUser();
        render(<OwnShows />);

        await user.click(await screen.findByRole('button', { name: 'Make an episode' }));
        await user.click(screen.getByRole('button', { name: 'Make it' }));

        expect(requestOwnShowEpisode).toHaveBeenCalledWith('show-1', {});
    });

    it('sends the topic, the page and the pasted text when they were given', async () => {
        requestOwnShowEpisode.mockResolvedValue(episode());
        const user = setupUser();
        render(<OwnShows />);

        await user.click(await screen.findByRole('button', { name: 'Make an episode' }));
        const form = screen.getByRole('button', { name: 'Make it' }).closest('form') as HTMLElement;
        await user.type(within(form).getByLabelText('What this one is about'), 'lighthouses');
        await user.type(within(form).getByLabelText('A page to read first'), 'https://example.com/keepers');
        await user.type(within(form).getByLabelText('Something to read first'), 'The keeper lit the lamp at dusk.');
        await user.click(within(form).getByRole('button', { name: 'Make it' }));

        expect(requestOwnShowEpisode).toHaveBeenCalledWith('show-1', {
            topic: 'lighthouses',
            url: 'https://example.com/keepers',
            text: 'The keeper lit the lamp at dusk.',
        });
    });
});

describe('a show that reads the news', () => {
    it('starts News in depth reading every feed the station has, over a day', async () => {
        listOwnShows.mockResolvedValue({ shows: [] });
        listFeeds.mockResolvedValue({
            feeds: [
                { id: 'deadair.rss:world', pluginId: 'deadair.rss', name: 'World' },
                { id: 'deadair.rss:tech', pluginId: 'deadair.rss', name: 'Tech' },
            ],
        });
        createOwnShow.mockResolvedValue({ ...WIND_DOWN, id: 'show-2' });
        const user = setupUser();
        render(<OwnShows />);

        await user.click(await screen.findByRole('button', { name: 'New show' }));
        await screen.findByText('News it reads');
        await user.click(screen.getByRole('button', { name: 'News in depth' }));
        await user.click(screen.getByRole('button', { name: 'Make the show' }));

        expect(createOwnShow).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'News in depth', newsFeedIds: ['deadair.rss:world', 'deadair.rss:tech'], newsHours: 24 }),
        );
    });

    it('says so on its card', async () => {
        listOwnShows.mockResolvedValue({ shows: [{ ...WIND_DOWN, subject: undefined, newsFeedIds: ['deadair.rss:world'], newsHours: 6 }] });

        render(<OwnShows />);

        expect(await screen.findByText('Reads the news on 1 feed from the last 6 hours.')).toBeInTheDocument();
    });

    it('leaves the window out for a show that reads no news', () => {
        expect(
            showBodyOf({
                title: 'Wind-down',
                description: '',
                subject: '',
                personaId: null,
                minutes: '',
                mode: null,
                newsFeedIds: [],
                newsHours: 6,
                research: false,
            }),
        ).toEqual({
            title: 'Wind-down',
        });
    });
});

describe('a show that researches its episodes', () => {
    it('sends the choice with the show', async () => {
        listOwnShows.mockResolvedValue({ shows: [] });
        createOwnShow.mockResolvedValue({ ...WIND_DOWN, id: 'show-2' });
        const user = setupUser();
        render(<OwnShows />);

        await user.click(await screen.findByRole('button', { name: 'New show' }));
        await user.type(screen.getByLabelText('Called', { exact: false }), 'Curiosities');
        await user.click(screen.getByLabelText('Research each episode on your trusted sites'));
        await user.click(screen.getByRole('button', { name: 'Make the show' }));

        expect(createOwnShow).toHaveBeenCalledWith({ title: 'Curiosities', research: true });
    });
});

describe('showBodyOf', () => {
    it('drops the empty boxes and turns minutes into milliseconds', () => {
        expect(
            showBodyOf({
                title: ' News in depth ',
                description: ' ',
                subject: 'the day',
                personaId: null,
                minutes: 15,
                mode: null,
                newsFeedIds: [],
                newsHours: 6,
                research: false,
            }),
        ).toEqual({
            title: 'News in depth',
            subject: 'the day',
            targetMs: 15 * 60_000,
        });
    });
});
