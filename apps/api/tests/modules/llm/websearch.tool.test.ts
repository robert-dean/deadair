// The tool is an adapter over `SearchService` and nothing else, so what is worth testing is the
// shape of what the model sees: that a station with no search plugin is offered no tool at all
// rather than one that always answers "there is no search", that a search which found nothing says
// so rather than going quiet, and that no URL comes back — a model cannot follow a link, and the
// publisher's name is the only part of a result a station can broadcast.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { SearchResult } from '@deadair/plugin-sdk';

import type { SearchService } from '../../../src/modules/search/search.service.js';
import { WebSearchTool } from '../../../src/modules/llm/websearch.tool.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const hit = (overrides: Partial<SearchResult> = {}): SearchResult => ({
    title: 'Portishead',
    snippet: 'A band from Bristol.',
    url: 'https://www.example.com/portishead',
    site: 'The Example',
    ...overrides,
});

interface ServiceOptions {
    hasSearch?: boolean;
    results?: SearchResult[];
}

function build(options: ServiceOptions = {}) {
    // The parameters are named even though the body ignores them: the assertions below read the
    // call arguments off the mock, which is a zero-length tuple for a `vi.fn` that declared none.
    const search = vi.fn(async (_query: string, _limit: number, _options?: unknown): Promise<SearchResult[]> => options.results ?? [hit()]);
    const service = { hasSearch: () => options.hasSearch ?? true, search } as unknown as SearchService;

    return { tool: new WebSearchTool(service, logger), search };
}

const only = async (tool: WebSearchTool) => (await tool.tools())[0]!;
const run = async (tool: WebSearchTool, args: Record<string, unknown>) =>
    (await (await only(tool)).run(args)) as { results: { title: string; site?: string; extract?: string }[]; note?: string };

describe('what is offered', () => {
    it('offers nothing at all when no search plugin is installed', async () => {
        // Not a tool that answers "there is no search": that declaration is context spent teaching
        // the model about something that cannot help it, and no search plugin is the default state.
        const { tool } = build({ hasSearch: false });

        expect(await tool.tools()).toEqual([]);
    });

    it('needs a query and offers a window and a count beside it', async () => {
        const { declaration } = await only(build().tool);

        expect(declaration.name).toBe('search_web');
        expect(declaration.parameters.required).toEqual(['query']);
        expect(Object.keys(declaration.parameters.properties ?? {})).toEqual(['query', 'recency', 'limit']);
    });

    it('tells the model this is not how it finds something to play', async () => {
        // Every other tool here answers with music, and a model that reached for this one to
        // programme an hour would get page titles it can never schedule.
        const { declaration } = await only(build().tool);

        expect(declaration.description).toMatch(/does not find music to play/i);
    });
});

describe('what comes back', () => {
    it('carries no address, since a model cannot follow one and nobody wants one read out', async () => {
        const answer = await run(build().tool, { query: 'portishead' });

        expect(JSON.stringify(answer)).not.toContain('example.com/portishead');
    });

    it('carries the publisher, which is the part a presenter can actually say', async () => {
        const answer = await run(build().tool, { query: 'portishead' });

        expect(answer.results[0]?.site).toBe('The Example');
    });

    it("leaves the extract off a result that had none rather than sending an empty string", async () => {
        const { tool } = build({ results: [hit({ snippet: '' })] });

        expect(await run(tool, { query: 'portishead' })).toMatchObject({ results: [{ title: 'Portishead' }] });
        expect((await run(tool, { query: 'portishead' })).results[0]).not.toHaveProperty('extract');
    });

    it('says so when it found nothing, so the model does not read silence as a broken station', async () => {
        const { tool } = build({ results: [] });

        const answer = await run(tool, { query: 'a subject nobody has written about' });

        expect(answer.results).toEqual([]);
        expect(answer.note).toMatch(/nothing came back/i);
    });

    it('asks for nothing at all when the model called it with no words', async () => {
        const { tool, search } = build();

        const answer = await run(tool, { query: '   ' });

        expect(search).not.toHaveBeenCalled();
        expect(answer.note).toMatch(/needs something to search for/i);
    });
});

describe('what is passed through', () => {
    it('passes a window the capability offers', async () => {
        const { tool, search } = build();

        await run(tool, { query: 'portishead', recency: 'week' });

        expect(search).toHaveBeenCalledWith('portishead', expect.any(Number), { recency: 'week' });
    });

    it('ignores a window the model invented rather than sending it to an engine', async () => {
        const { tool, search } = build();

        await run(tool, { query: 'portishead', recency: 'this afternoon' });

        expect(search).toHaveBeenCalledWith('portishead', expect.any(Number), {});
    });

    it('holds the count inside what a break can use', async () => {
        const { tool, search } = build();

        await run(tool, { query: 'portishead', limit: 500 });

        expect(search).toHaveBeenCalledWith('portishead', 10, {});
    });

    it('takes the ceiling for a count that is not a number', async () => {
        const { tool, search } = build();

        await run(tool, { query: 'portishead', limit: 'lots' });

        expect(search).toHaveBeenCalledWith('portishead', 10, {});
    });
});
