// The story pass, which is the one pass on the station that runs with tools on. So these are about
// what it may REACH and what it may store unread: the proposal turn is offered the station's own
// music and nothing that reads the world, and under `self-directed` growth nothing it writes is
// stored `active` past the sheet's own prohibitions, details included.
//
// The config double hands over STRINGS, per the settings gotcha in CLAUDE.md: a double coercing to
// a real boolean would pass whether or not the switch is read through `settingIsOn`.

import { describe, expect, it, vi } from 'vitest';

import { PersonaStoryPassService, PERSONA_STORIES_KEYS, STORY_PASS_TOOLS } from '../../../src/modules/personas/persona.story.pass.service.js';
import type { Persona } from '../../../src/modules/personas/persona.js';
import type { PersonaStory } from '../../../src/modules/personas/persona.story.js';

const persona = (over: Partial<Persona> = {}): Persona => ({
    id: 'p1',
    key: 'overnight',
    kind: 'host',
    kinds: ['host'],
    label: 'The overnight host',
    style: 'a quiet presenter who has done the small hours for twenty years',
    defaultHost: true,
    ...over,
});

const held = (over: Partial<PersonaStory> = {}): PersonaStory => ({
    id: 'story-1',
    personaKey: 'overnight',
    title: 'The desert lights',
    story: 'I saw three lights over the desert one night and played the same record until dawn.',
    kind: 'anecdote',
    state: 'active',
    origin: 'operator',
    details: [],
    beats: [],
    timesTold: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...over,
});

/** Values as `deadair.settings` actually holds them. See the file note. */
const config = (values: Record<string, string> = {}) => ({
    get: vi.fn((key: string, fallback: unknown) => values[key] ?? fallback),
});

function harness(options: { persona?: Persona; answer: string }) {
    const personas = { list: vi.fn(async () => [options.persona ?? persona()]) };
    const stories = {
        list: vi.fn(async () => [held()]),
        addAll: vi.fn(async (writes: unknown[]) => writes.length),
        addDetails: vi.fn(async (writes: unknown[]) => writes.length),
        addBeats: vi.fn(async (writes: unknown[]) => writes.length),
        recappable: vi.fn(async () => []),
        addRecap: vi.fn(async () => {}),
    };
    const scripts = { writtenBy: vi.fn(async () => []) };
    const llm = {
        canGenerate: vi.fn(() => true),
        explainGenerator: vi.fn(() => 'no plugin'),
        converse: vi.fn(async (_request: unknown, _options: unknown) => ({ text: options.answer, finishReason: 'stop' })),
    };
    const activity = { record: vi.fn(async () => {}) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const service = new PersonaStoryPassService(
        personas as never,
        stories as never,
        scripts as never,
        llm as never,
        activity as never,
        config({ [PERSONA_STORIES_KEYS.enabled]: 'true' }) as never,
        logger as never,
    );

    return { service, stories, llm };
}

const proposals = (entries: Record<string, string>[]) => JSON.stringify({ proposals: entries });

describe('PersonaStoryPassService', () => {
    // The registry offers every source to every caller, so the web, the news, the weather and the
    // almanac all reached this pass the day they were registered. A story built out of a web page
    // and stored active under self-directed growth is the case this exists to make impossible.
    it("offers the proposal turn the station's own music tools and nothing that reads the world", async () => {
        const { service, llm } = harness({ answer: proposals([]) });

        await service.run();

        expect(llm.converse).toHaveBeenCalledTimes(1);
        const options = llm.converse.mock.calls[0]![1] as { onlyTools?: readonly string[]; tools?: boolean };
        expect(options.tools).not.toBe(false);
        expect([...options.onlyTools!].sort()).toEqual(['browse_charts', 'search_music', 'similar_artists', 'station_taste']);
        expect(options.onlyTools).toBe(STORY_PASS_TOOLS);
        for (const world of ['search_web', 'read_news', 'get_weather', 'get_this_day']) expect(options.onlyTools).not.toContain(world);
    });

    // A detail is shown beside its story in every break that carries it, so an active one reaches a
    // listener exactly as an unread story would. It used to skip the check stories and beats get.
    it('does not store a self-directed detail that fails the sheet, and stores one that passes', async () => {
        const { service, stories } = harness({
            persona: persona({ growth: 'self-directed', avoid: ['groovy'] }),
            answer: proposals([
                { kind: 'detail', title: 'The desert lights', detail: 'The record was groovy, and I never found out who sent it.' },
                { kind: 'detail', title: 'The desert lights', detail: 'The phone rang once at four and nobody was there.' },
            ]),
        });

        await service.run();

        const written = stories.addDetails.mock.calls[0]![0] as { detail: string; state: string }[];
        expect(written).toEqual([expect.objectContaining({ detail: 'The phone rang once at four and nobody was there.', state: 'active' })]);
    });

    // Under `proposes` the operator reads every row first, so refusing one would only narrow what
    // the station is willing to offer them.
    it('stores the same detail as a suggestion when the character only proposes', async () => {
        const { service, stories } = harness({
            persona: persona({ avoid: ['groovy'] }),
            answer: proposals([{ kind: 'detail', title: 'The desert lights', detail: 'The record was groovy, and I never found out who sent it.' }]),
        });

        await service.run();

        const written = stories.addDetails.mock.calls[0]![0] as { state: string }[];
        expect(written).toEqual([expect.objectContaining({ state: 'suggested' })]);
    });
});
