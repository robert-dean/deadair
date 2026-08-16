// The floor under a bulletin. What is worth testing is what it refuses to do: announce a bulletin
// it has no stories for, back-announce its way into the headlines, or let an operator's phrasing
// drop the read and leave the station introducing nothing.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import type { BreakStory, BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import { NEWS_KEYS, NEWS_KIND, NEWS_TEMPLATES, NewsBreakWriter } from '../../../src/modules/director/news.break.writer.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const config = (values: Record<string, unknown> = {}): AppConfig =>
    ({ get: vi.fn((key: string, fallback: unknown) => values[key] ?? fallback) }) as unknown as AppConfig;

const story = (headline: string): BreakStory => ({ headline });

const request = (overrides: Partial<BreakWriteRequest> = {}): BreakWriteRequest => ({
    kind: NEWS_KIND,
    station: 'Deadair',
    stories: [story('Bridge reopens after four years.'), story('Council votes and adjourns.')],
    ...overrides,
});

let writer: NewsBreakWriter;

beforeEach(() => {
    vi.clearAllMocks();
    writer = new NewsBreakWriter(config(), logger);
});

describe('reading the headlines', () => {
    it('reads every story it was given, as published', async () => {
        const written = await writer.write(request());

        expect(written?.script).toContain('Bridge reopens after four years.');
        expect(written?.script).toContain('Council votes and adjourns.');
        expect(written?.label).toBe('News');
    });

    // Not a softening of the read-as-published rule but an application of it: a published first
    // sentence quoted word for word is exactly as checkable as a headline, and a bulletin of titles
    // alone tells a listener nothing.
    it("reads each story's opening sentence after its headline, as published", async () => {
        const written = await writer.write(
            request({
                stories: [
                    {
                        headline: 'Bridge reopens after four years.',
                        body: 'Traffic crossed the river at dawn for the first time since 2022. Engineers spent a further month on the approaches.',
                    },
                ],
            }),
        );

        expect(written?.script).toContain('Bridge reopens after four years. Traffic crossed the river at dawn for the first time since 2022.');
        // The FIRST sentence, not the paragraph.
        expect(written?.script).not.toContain('Engineers spent');
    });

    it('falls back to the teaser where no article could be read, and to the headline where neither could', async () => {
        const teaser = await writer.write(request({ stories: [{ headline: 'Bridge reopens.', summary: 'Traffic crossed the river at dawn.' }] }));
        expect(teaser?.script).toContain('Bridge reopens. Traffic crossed the river at dawn.');

        const bare = await writer.write(request({ stories: [story('Bridge reopens.')] }));
        expect(bare?.script).toContain('Bridge reopens.');
    });

    // The ordinary case rather than the edge: measured against the station's own feed, an entry's
    // teaser is frequently the headline written out in full.
    it('drops a sentence that only says the headline again', async () => {
        const written = await writer.write(
            request({
                stories: [{ headline: 'Bridge reopens after four years.', summary: 'The bridge reopens after four years.' }],
            }),
        );

        expect(written?.script).toContain('Bridge reopens after four years.');
        expect(written?.script).not.toMatch(/four years\.\s+The bridge/i);
    });

    it('drops a sentence too long to be heard rather than read', async () => {
        const written = await writer.write(
            request({
                stories: [
                    { headline: 'Inquiry continues.', body: `${'The inquiry heard evidence from a further witness, '.repeat(6)}and adjourned.` },
                ],
            }),
        );

        expect(written?.script).toContain('Inquiry continues.');
        expect(written?.script).not.toContain('heard evidence');
    });

    it('declines when there is nothing to report, rather than announcing a bulletin with no news in it', async () => {
        expect(await writer.write(request({ stories: [] }))).toBeUndefined();
        expect(await writer.write(request({ stories: undefined }))).toBeUndefined();
    });

    it('does not back-announce on its way into the news', async () => {
        // `usable` would otherwise insist on a phrasing that names the record just finished, and a
        // bulletin that opens with one is a presenter who has not decided what this break is.
        const written = await writer.write(request({ previous: { title: 'Solid Air', artist: 'John Martyn' } }));

        expect(written).toBeDefined();
        expect(written?.script).not.toContain('Solid Air');
    });

    it('hands back to the music where the phrasing does, and says so', async () => {
        const one = config({ [NEWS_KEYS.templates]: 'Now the news. {{news.headlines}} Next up, {{next.artist}} with {{next.title}}.' });
        const written = await new NewsBreakWriter(one, logger).write(request({ next: { title: 'Pink Moon', artist: 'Nick Drake' } }));

        expect(written?.script).toContain('Pink Moon');
        expect(written?.claimsNext).toBe(true);
    });

    it('makes no forward claim when the phrasing named nothing coming up', async () => {
        const one = config({ [NEWS_KEYS.templates]: 'Now the news. {{news.headlines}}' });
        const written = await new NewsBreakWriter(one, logger).write(request({ next: { title: 'Pink Moon', artist: 'Nick Drake' } }));

        expect(written?.claimsNext).toBe(false);
    });
});

describe('the phrasings an operator owns', () => {
    it('uses the operator list over the station default', async () => {
        const one = config({ [NEWS_KEYS.templates]: 'And now, the news. {{news.headlines}}' });

        const written = await new NewsBreakWriter(one, logger).write(request());

        expect(written?.script.startsWith('And now, the news.')).toBe(true);
    });

    it('restores the station default when the box is cleared', async () => {
        const written = await new NewsBreakWriter(config({ [NEWS_KEYS.templates]: '   ' }), logger).write(request());

        expect(written).toBeDefined();
        expect(NEWS_TEMPLATES.length).toBeGreaterThan(0);
    });

    it('declines a phrasing that names something nothing can fill, and says so once', async () => {
        const one = config({ [NEWS_KEYS.templates]: 'The news, brought to you by {{sponsor.name}}. {{news.headlines}}' });

        expect(await new NewsBreakWriter(one, logger).write(request())).toBeUndefined();
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('drops a phrasing whose station name it cannot fill, and uses one it can', async () => {
        const one = config({
            [NEWS_KEYS.templates]: ["Here's the news on {{station.name}}. {{news.headlines}}", 'Now the news. {{news.headlines}}'].join('\n'),
        });

        const written = await new NewsBreakWriter(one, logger).write(request({ station: undefined }));

        expect(written?.script.startsWith('Now the news.')).toBe(true);
    });

    it('says what time it is only when the phrasing does, and stamps the window it stays true in', async () => {
        const clock = { words: 'just after nine', validFrom: 1_000, validUntil: 2_000 };
        const timed = config({ [NEWS_KEYS.templates]: "It's {{clock.rough}}, and this is the news. {{news.headlines}}" });
        const untimed = config({ [NEWS_KEYS.templates]: 'Now the news. {{news.headlines}}' });

        expect(await new NewsBreakWriter(timed, logger).write(request({ clock }))).toMatchObject({
            claimsTime: { from: 1_000, until: 2_000 },
        });
        expect((await new NewsBreakWriter(untimed, logger).write(request({ clock })))?.claimsTime).toBeUndefined();
    });

    it('avoids the phrasing it used last time', async () => {
        const one = config({
            [NEWS_KEYS.templates]: ['Now the news. {{news.headlines}}', 'Time for the headlines. {{news.headlines}}'].join('\n'),
        });

        const written = await new NewsBreakWriter(one, logger).write(request({ recent: ['Now the news. Something happened.'] }));

        expect(written?.script.startsWith('Time for the headlines.')).toBe(true);
    });
});
