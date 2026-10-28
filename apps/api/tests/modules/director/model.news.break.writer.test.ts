// The model binding for a bulletin. Everything here is about what it will not do: write news it was
// not given, ask a model at all when there is nothing to report, or air an answer that ran long.
// The prompt itself is asserted in `break.prompt.test.ts`, where it can be read without a model.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { LlmMessage } from '@deadair/plugin-sdk';
import type { Logger } from '@maroonedsoftware/logger';

import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import { ModelNewsBreakWriter, NEWS_MAX_WORDS } from '../../../src/modules/director/model.news.break.writer.js';
import { MODEL_WRITER_KEYS } from '../../../src/modules/director/model.talk.break.writer.js';
import { NEWS_KIND } from '../../../src/modules/director/news.break.writer.js';
import type { LlmService } from '../../../src/modules/llm/llm.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const config = (values: Record<string, unknown> = {}): AppConfig =>
    ({ get: vi.fn((key: string, fallback: unknown) => values[key] ?? fallback) }) as unknown as AppConfig;

const enabled = { [MODEL_WRITER_KEYS.enabled]: true };

const request = (overrides: Partial<BreakWriteRequest> = {}): BreakWriteRequest => ({
    kind: NEWS_KIND,
    station: 'Deadair',
    stories: [{ headline: 'Bridge reopens after four years.', summary: 'It reopened this morning.' }],
    ...overrides,
});

function build(answer: string, values: Record<string, unknown> = enabled) {
    // Params declared rather than inferred, so a case can read back what the model was actually
    // shown. `ModelWelcomeWriter`'s test does the same, for the same reason.
    const converse = vi.fn(async (_asked: { messages: LlmMessage[] }, _options?: unknown) => ({
        text: answer,
        finishReason: 'stop',
        usage: { outputTokens: 40 },
    }));
    const llm = { canGenerate: () => true, explainGenerator: () => 'ready', converse } as unknown as LlmService;

    return { writer: new ModelNewsBreakWriter(llm, config(values), logger), converse };
}

/** The system turn as the model was shown it. */
const systemTurn = (converse: ReturnType<typeof build>['converse']): string =>
    String((converse.mock.calls[0]?.[0].messages ?? []).find(message => message.role === 'system')?.content ?? '');

beforeEach(() => vi.clearAllMocks());

describe('when it will not even ask', () => {
    it('declines with no stories, rather than having a model invent a bulletin', async () => {
        const { writer, converse } = build('Here is the news.');

        expect(await writer.write(request({ stories: [] }))).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines when the operator has not turned the model writer on', async () => {
        const { writer, converse } = build('Here is the news.', {});

        expect(await writer.write(request())).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines when the setting holds the STRING a settings row stores', async () => {
        // Not the same case as the one above. Absent falls to the default; SET TO OFF is what was
        // broken, because `deadair.settings` hands back `'false'` and that is truthy.
        const { writer, converse } = build('Here is the news.', { [MODEL_WRITER_KEYS.enabled]: 'false' });

        expect(await writer.write(request())).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines when nothing can generate, and does not treat that as a fault', async () => {
        const llm = { canGenerate: () => false, explainGenerator: () => 'no plugin', converse: vi.fn() } as unknown as LlmService;
        const writer = new ModelNewsBreakWriter(llm, config(enabled), logger);

        expect(await writer.write(request())).toBeUndefined();
    });
});

describe('what it will air', () => {
    it('reads back a bulletin the model wrote', async () => {
        const { writer } = build('Here is the news. A bridge has reopened after four years. Now, back to the music.');

        expect(await writer.write(request())).toMatchObject({
            label: 'News',
            script: expect.stringContaining('bridge has reopened'),
        });
    });

    it('tells the model what this bulletin is about, and names the break for it', async () => {
        // Said in the OPENING rather than as a rule, because it changes what the bulletin is rather
        // than constraining how it is written — and it only describes: the stories were cut to the
        // category before the model saw them, so ignoring the sentence still reads the right ones.
        const { writer, converse } = build('Here is the technology news. A chip plant reopened.');

        const written = await writer.write(request({ subject: { key: 'technology', label: 'Technology' } }));

        expect(written?.label).toBe('Technology news');
        const user = String((converse.mock.calls[0]?.[0].messages ?? []).find(message => message.role === 'user')?.content ?? '');
        expect(user).toContain('This is the Technology news');
    });

    it('tells the model a repeated bulletin is a round-up, and only then', async () => {
        // In the opening for the subject's reason: a repeat changes what the bulletin IS. Without it
        // a model reads three-hour-old headlines as though they had just come in.
        const userTurn = (converse: { mock: { calls: { 0: { messages: { role: string; content: unknown }[] } }[] } }) =>
            String((converse.mock.calls[0]?.[0].messages ?? []).find(message => message.role === 'user')?.content ?? '');

        const repeated = build('Earlier today: a chip plant reopened.');
        await repeated.writer.write(request({ recap: true }));
        expect(userTurn(repeated.converse)).toContain('present them as a round-up of the day');

        const fresh = build('A chip plant reopened.');
        await fresh.writer.write(request());
        expect(userTurn(fresh.converse)).not.toContain('round-up');
    });

    it('gives itself room for a bulletin rather than a talk break', async () => {
        const { writer, converse } = build(`${'word '.repeat(NEWS_MAX_WORDS - 1)}end.`);

        expect(await writer.write(request())).toBeDefined();
        expect(converse).toHaveBeenCalledTimes(1);
    });

    it('declines an answer that ran past the ceiling rather than cutting a bulletin in half', async () => {
        const { writer } = build('word '.repeat(NEWS_MAX_WORDS + 10));

        expect(await writer.write(request())).toBeUndefined();
    });

    it('asks for no tools, because a bulletin may only contain what the station fetched', async () => {
        const { writer, converse } = build('Here is the news. A bridge reopened.');

        await writer.write(request());

        expect(converse).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tools: false }));
    });

    it('claims the record coming up when it was told what it is', async () => {
        const { writer } = build('Here is the news. A bridge reopened. Now, Nick Drake.');

        expect(await writer.write(request({ next: { title: 'Pink Moon', artist: 'Nick Drake' } }))).toMatchObject({ claimsNext: true });
    });

    it('stamps the clock only when the answer really carries the words it was given', async () => {
        const clock = { words: 'just after nine', validFrom: 1_000, validUntil: 2_000 };

        const said = build('It is just after nine. A bridge reopened.');
        expect(await said.writer.write(request({ clock }))).toMatchObject({ claimsTime: { from: 1_000, until: 2_000 } });

        const paraphrased = build('It is nearly ten past nine. A bridge reopened.');
        expect((await paraphrased.writer.write(request({ clock })))?.claimsTime).toBeUndefined();
    });

    it('stamps a greeting it opened with although it was never offered one', async () => {
        // The bulletin that aired "Good morning" at five past twelve: written for a slot before noon,
        // re-projected past it, and claiming nothing that could go stale.
        const greeting = { words: 'Good morning', validFrom: 1_000, validUntil: 5_000 };

        const greets = build('Good morning. Here is the news. A bridge reopened.');
        expect(await greets.writer.write(request({ greeting }))).toMatchObject({ claimsTime: { from: 1_000, until: 5_000 } });

        const plain = build('Here is the news. A bridge reopened.');
        expect((await plain.writer.write(request({ greeting })))?.claimsTime).toBeUndefined();
    });
});

// Two things a bulletin owes that a talk break does not, both of them measured on air rather than
// imagined. The word ceiling is a backstop and caught neither.
describe('the two ways a bulletin runs on', () => {
    it('forbids explaining a word out of a story, which is how thin copy gets padded', async () => {
        // "Gravity is an inescapable force. It's why Earth has its atmosphere and orbits the sun"
        // went out as news, twice, off a two-line story about a soap box derby. True, not news, and
        // the model filling a hole rather than leaving it open.
        const { writer, converse } = build('Here is the news. A bridge reopened.');
        await writer.write(request());

        expect(systemTurn(converse)).toMatch(/never explain a word from a story/i);
    });

    it('says where a bulletin stops', async () => {
        // One captured bulletin reported its three stories correctly and then wrote twelve more
        // sentences of atmosphere — "the needle slides into rhythm", "feel the echo of a pattern
        // within the hiss" — at 214 words against a ceiling of 300. Nothing had said it was over.
        const { writer, converse } = build('Here is the news. A bridge reopened.');
        await writer.write(request());

        expect(systemTurn(converse)).toMatch(/stop when the stories stop/i);
        expect(systemTurn(converse)).toMatch(/nothing about the sound of the station/i);
    });

    it('lets the reader give their own sign-off, in a line, before the handover', async () => {
        // A newsreader whose sheet closes on "And that's the way it is" was told in the same prompt
        // that the handover was the last thing it said, and the rule won.
        const { writer, converse } = build('Here is the news. A bridge reopened.');
        await writer.write(request());

        expect(systemTurn(converse)).toMatch(/after the last story you may give your own sign-off, if your character has one, in one short line/i);
    });

    it('airs a sign-off the sheet describes in its quirks, every time it is said', async () => {
        // In the quirks and not the samples, because a script sharing six words with a sample is
        // refused, and a sign-off is a line the reader is meant to repeat.
        const persona = {
            key: 'newsreader',
            quirks: ["Closes with 'And that's the way it is' before handing back to the music"],
        } as unknown as NonNullable<BreakWriteRequest['persona']>;
        const said = 'Good evening. A bridge has reopened after four years. And that is the way it is. Now, back to the music.';
        const { writer } = build(said);

        expect(await writer.write(request({ persona, recent: [said] }))).toBeDefined();
    });
});

// A bulletin holds the character to three of the four checks. Only the DIALECT is excused, because
// only the dialect asks for something a deliberately plain script cannot give — the other three
// forbid things a bulletin should never do anyway. Dropping all four, which is what this used to do,
// re-permitted the exact failure `persona.sheet.ts` was built for: `I said what I said` closing a
// talk break, a welcome and a news bulletin.
describe('the character, as a lean rather than a requirement', () => {
    const persona = {
        key: 'wisecrack',
        dictionMarkers: ['apparently', 'somehow', 'allegedly'],
        catchphrases: ['I said what I said'],
        avoid: ['buckle up'],
        samples: ['Four minutes, three key changes and a saxophone nobody asked for.'],
    } as unknown as NonNullable<BreakWriteRequest['persona']>;

    it('airs a plain bulletin, which is the whole reason the dialect is excused', async () => {
        // The measurement this rests on: every news break under this persona used to fall to the
        // floor as out-of-character, because "no jokes, no opinions" and "sound like nobody else"
        // are not simultaneously satisfiable.
        const { writer } = build('Here is the news. A bridge has reopened after four years. Now, back to the music.');

        expect(await writer.write(request({ persona }))).toBeDefined();
    });

    it('still refuses a bulletin that read the persona’s own sample line back', async () => {
        const { writer } = build('Here is the news. Four minutes, three key changes and a saxophone nobody asked for.');

        expect(await writer.write(request({ persona }))).toBeUndefined();
    });

    it('still refuses wording the sheet forbids', async () => {
        const { writer } = build('Here is the news, so buckle up. A bridge has reopened after four years.');

        expect(await writer.write(request({ persona }))).toBeUndefined();
    });

    it('still refuses a signature the station has just spent', async () => {
        // The one the bulletin was observed committing, and the one that named this fault.
        const { writer } = build('A bridge has reopened after four years. I said what I said.');

        expect(await writer.write(request({ persona, recent: ['That was ambitious. I said what I said.'] }))).toBeUndefined();
    });

    it('says which of the three it was, on the row as well as in the log', async () => {
        const { writer } = build('Here is the news, so buckle up.');
        await writer.write(request({ persona }));

        expect(writer.detailOfLastWrite()?.reason).toMatch(/wording the persona forbids/i);
    });
});
