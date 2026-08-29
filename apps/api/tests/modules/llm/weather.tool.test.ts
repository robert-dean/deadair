// The tool is an adapter over `WeatherService` and nothing else, so what is worth testing is the
// shape of what the model sees: that a station which cannot answer is offered no tool at all rather
// than one that always says "there is no weather", that the bare call is the normal one, that the
// figures arrive in the units this station speaks, and that a reading nothing could fetch says so
// rather than going quiet.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import type { WeatherService } from '../../../src/modules/weather/weather.service.js';
import type { SpokenWeather } from '../../../src/modules/weather/weather.words.js';
import type { TopicRepository } from '../../../src/modules/topics/topic.repository.js';
import type { Topic } from '../../../src/modules/topics/topic.js';
import { WEATHER_KIND } from '../../../src/modules/weather/weather.kind.js';
import { WeatherTool } from '../../../src/modules/llm/weather.tool.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const READING: SpokenWeather = {
    place: 'Atlanta, Georgia',
    observedAt: '2026-08-29T09:00:00-04:00',
    units: 'metric',
    current: { condition: 'rain', words: 'raining', description: 'light rain', temperature: 17, wind: 20 },
};

const location = (key: string, label: string, config: Record<string, unknown>): Topic => ({
    id: `topic-${key}`,
    kind: WEATHER_KIND,
    key,
    label,
    position: 0,
    config,
});

interface ServiceOptions {
    hasWeather?: boolean;
    home?: string;
    units?: 'metric' | 'imperial';
    reading?: SpokenWeather | undefined;
    topics?: Topic[];
    topicsThrow?: boolean;
}

function build(options: ServiceOptions = {}) {
    const read = vi.fn(async (_place?: string, _days?: number): Promise<SpokenWeather | undefined> =>
        'reading' in options ? options.reading : READING,
    );

    const service = {
        hasWeather: () => options.hasWeather ?? true,
        // `in` rather than `??`, because the interesting case is a station that has named no place
        // and `WeatherService.home` answers `undefined` for that rather than an empty string.
        home: () => ('home' in options ? options.home : 'Atlanta'),
        units: () => options.units ?? 'metric',
        read,
    } as unknown as WeatherService;

    const list = vi.fn(async () => {
        if (options.topicsThrow) throw new Error('the topics table is unreachable');
        return options.topics ?? [];
    });
    const topics = { list } as unknown as TopicRepository;

    return { tool: new WeatherTool(service, topics, logger), read };
}

const only = async (tool: WeatherTool) => (await tool.tools())[0]!;
const run = async (tool: WeatherTool, args: Record<string, unknown> = {}) =>
    (await (await only(tool)).run(args)) as {
        place?: string;
        resolvedAs?: string;
        units?: unknown;
        now?: unknown;
        forecast?: unknown;
        note?: string;
    };

describe('what is offered', () => {
    it('offers nothing at all when no weather plugin is installed', async () => {
        // Not a tool that answers "there is no weather": that declaration is context spent teaching
        // the model about something that cannot help it, and no weather plugin is the default state.
        expect(await build({ hasWeather: false }).tool.tools()).toEqual([]);
    });

    it('offers nothing when the station has named neither a home nor a location', async () => {
        expect(await build({ home: undefined }).tool.tools()).toEqual([]);
    });

    it('offers the tool on locations alone, for a station that named places but not itself', async () => {
        const { tool } = build({ home: undefined, topics: [location('atlanta', 'Atlanta', { place: 'Atlanta, Georgia' })] });

        expect(await tool.tools()).toHaveLength(1);
    });

    it('requires nothing, because the bare call is the normal one', async () => {
        // The whole point of station.location: a station reports its own weather without an
        // operator naming anything, and a location parameter with one obligatory value would be a
        // round trip spent teaching a model an id it has no basis for choosing.
        const { declaration } = await only(build().tool);

        expect(declaration.name).toBe('get_weather');
        expect(declaration.parameters.required).toEqual([]);
    });

    it('leaves the location parameter off entirely when the station has named none', async () => {
        // A knob with an empty list behind it teaches a model that the filter works when it does not.
        const { declaration } = await only(build().tool);

        expect(declaration.parameters.properties).not.toHaveProperty('location');
        expect(declaration.parameters.properties).toHaveProperty('when');
    });

    it("enumerates the station's own locations when there are any", async () => {
        const { tool } = build({
            topics: [location('atlanta', 'Atlanta', { place: 'Atlanta, Georgia' }), location('boston', 'Boston', { place: 'Boston, MA' })],
        });
        const { declaration } = await only(tool);
        const parameter = declaration.parameters.properties?.location as { enum?: string[]; description?: string };

        expect(parameter.enum).toEqual(['atlanta', 'boston']);
        expect(parameter.description).toContain('Boston');
    });

    it('drops an unfinished location rather than offering an id nothing can be looked up from', async () => {
        const { tool } = build({ topics: [location('atlanta', 'Atlanta', { place: 'Atlanta' }), location('half', 'Half done', {})] });
        const { declaration } = await only(tool);

        expect((declaration.parameters.properties?.location as { enum?: string[] }).enum).toEqual(['atlanta']);
    });

    it('survives a topics table it could not read, losing the locations and nothing else', async () => {
        const { tool } = build({ topicsThrow: true });
        const { declaration } = await only(tool);

        expect(declaration.parameters.properties).not.toHaveProperty('location');
    });

    it('names the units in the description, so the model says the numbers as they come', async () => {
        const { declaration } = await only(build({ units: 'imperial' }).tool);

        expect(declaration.description).toContain('°F');
        expect(declaration.description).toContain('mph');
    });
});

describe('what comes back', () => {
    it('asks about the station itself when the model named no location', async () => {
        const { tool, read } = build();

        await run(tool);

        expect(read).toHaveBeenCalledWith(undefined, 0, undefined);
    });

    it("honours a location's own units override, which is the one place it is read for a model", async () => {
        const { tool, read } = build({ units: 'metric', topics: [location('boston', 'Boston', { place: 'Boston, MA', units: 'imperial' })] });

        await run(tool, { location: 'boston' });

        expect(read).toHaveBeenCalledWith('Boston, MA', 0, 'imperial');
    });

    it('asks about the PLACE behind a location, not the label a presenter says', async () => {
        const { tool, read } = build({ topics: [location('town', 'town', { place: 'Chipping Norton, Oxfordshire' })] });

        await run(tool, { location: 'town' });

        expect(read).toHaveBeenCalledWith('Chipping Norton, Oxfordshire', 0, undefined);
    });

    it("answers with the operator's own word for the place, and keeps what the service resolved", async () => {
        // The label is what this station calls the place and is what a presenter should say. The
        // resolved name rides along because a service that found the wrong town is a failure only
        // visible here.
        const { tool } = build({ topics: [location('town', 'town', { place: 'Chipping Norton' })] });

        const answer = await run(tool, { location: 'town' });

        expect(answer.place).toBe('town');
        expect(answer.resolvedAs).toBe('Atlanta, Georgia');
    });

    it('turns the words a model uses into the day counts a service takes', async () => {
        const { tool, read } = build();

        await run(tool, { when: 'today' });
        expect(read).toHaveBeenLastCalledWith(undefined, 1, undefined);

        await run(tool, { when: 'tomorrow' });
        expect(read).toHaveBeenLastCalledWith(undefined, 2, undefined);

        await run(tool, { when: 'week' });
        expect(read).toHaveBeenLastCalledWith(undefined, 7, undefined);
    });

    it('reads a horizon it does not know as the conditions now', async () => {
        const { tool, read } = build();

        await run(tool, { when: 'a fortnight on Tuesday' });

        expect(read).toHaveBeenLastCalledWith(undefined, 0, undefined);
    });

    it('says what the units are, beside figures already converted into them', async () => {
        const { tool } = build();

        const answer = await run(tool);

        expect(answer.units).toEqual({ temperature: '°C', wind: 'km/h' });
        expect(answer.now).toMatchObject({ words: 'raining', temperature: 17, wind: 20 });
    });

    it('leaves the forecast off when none was asked for', async () => {
        expect((await run(build().tool)).forecast).toBeUndefined();
    });

    it('SAYS there is no reading rather than going quiet, and says which sort of nothing it is', async () => {
        // The model cannot otherwise tell "the service is down" from "this station cannot do
        // weather", and only one of those is worth trying again in the same break.
        const answer = await run(build({ reading: undefined }).tool);

        expect(answer.note).toMatch(/service rather than/);
        expect(answer.now).toBeUndefined();
    });

    it('answers about the station when the model names a location that has since been deleted', async () => {
        // A stale request rather than a mistake: the model read the enum a moment before an operator
        // removed the row, which is `ClockService.subjectFor`'s rule.
        const { tool, read } = build({ topics: [location('atlanta', 'Atlanta', { place: 'Atlanta' })] });

        await run(tool, { location: 'a-place-that-went-away' });

        expect(read).toHaveBeenCalledWith(undefined, 0, undefined);
    });
});
