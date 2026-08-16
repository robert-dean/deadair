// Two pure functions, so the decisions worth testing are all about what the model must not do and
// what the station will not accept back. The prompt half is shaped around one failure -- a real
// record shown as context being read as a record offered -- and the parsing half around the fact
// that a local model told to answer in JSON often answers in a list instead.

import { describe, expect, it } from 'vitest';

import { NEVER_ECHO, readPicks, setPrompt } from '../../../src/modules/director/set.prompt.js';

const systemOf = (messages: ReturnType<typeof setPrompt>) => messages.find(message => message.role === 'system')?.content ?? '';
const userOf = (messages: ReturnType<typeof setPrompt>) => messages.find(message => message.role === 'user')?.content ?? '';

describe('setPrompt', () => {
    it('opens with one system turn and one user turn', () => {
        const messages = setPrompt({ count: 5, avoid: [] });

        expect(messages.map(message => message.role)).toEqual(['system', 'user']);
    });

    it('lets memory name a record and never overrule a search', () => {
        // The grounding rule after `PickResolver` grew its lookup rung. A remembered record is no
        // longer unplayable, and the absolute version cost real hours: told a style could not be
        // searched for and forbidden to name what it knew, a model answered with nothing at all.
        // What survives is the half that keeps the station honest — a search result is spelled the
        // way the lookup will look it up, so it wins wherever the two disagree.
        const system = systemOf(setPrompt({ count: 5, avoid: [] }));

        expect(system).toMatch(/Use the search_library and search_catalog tools to find records/);
        expect(system).toMatch(/You may also name a record you know of that no search returned/);
        expect(system).toMatch(/Never correct a search result from memory/);
        expect(system).not.toMatch(/Never name a record from your own knowledge/);
    });

    it('puts the library first and the provider second', () => {
        // Both air, so this is about cost rather than permission: a library record is owned,
        // measured and on hand, while a provider record costs a lookup and a download.
        const system = systemOf(setPrompt({ count: 5, avoid: [] }));

        expect(system).toMatch(/Search the library FIRST/);
        expect(system).toMatch(/when the library cannot fill/);
    });

    it('says a brief is a style to expand rather than a query to run', () => {
        // A search is text against titles and artist names, so passing the operator's words straight
        // through returns records with those words in the title: "jazz club hits" found five obscure
        // records literally titled "Jazz Club". Expanding the brief is what the model's own
        // knowledge is for here: knowing that a brief implies Bill Evans is the step no search can
        // take, and searching for HIM by name is the step it is good at.
        const system = systemOf(setPrompt({ count: 5, avoid: [] }));

        expect(system).toMatch(/A brief describes a STYLE, not a search term/);
        expect(system).toMatch(/search for THEM by name, one at a time/);
        // The axis the search actually offers. A style filter was advertised here for as long as
        // the tool carried one, and it went with it: sent to the provider it narrowed nothing.
        expect(system).toMatch(/yearFrom and yearTo/);
        expect(system).not.toMatch(/genre/);
    });

    it('bounds the searching by what it is for rather than by a number of searches', () => {
        // Two live runs pulled this in opposite directions. "Search several times" with no ceiling
        // had the model spend every round searching and never answer; "three or four times, then
        // ANSWER" then had it stop with twelve records in front of it when asked to name two dozen.
        // Stating the condition satisfies both, and it has to remain a STOPPING rule.
        const system = systemOf(setPrompt({ count: 24, avoid: [] }));

        expect(system).toMatch(/Keep searching until you have found at least as many DIFFERENT records/);
        expect(system).toMatch(/As soon as you have enough to choose from, ANSWER/);
    });

    it('says a repeated record does not fill the request', () => {
        // The failure is invisible from the answer, which looks complete: `SetGeneratorChain`
        // discards the duplicate and the deterministic floor fills the gap, so a model padding to
        // length silently costs the operator the brief they asked for.
        const system = systemOf(setPrompt({ count: 24, avoid: [] }));

        expect(system).toMatch(/Name each record ONCE/);
        expect(system).toMatch(/name fewer/);
    });

    it('asks for the answer in a shape something can read back', () => {
        expect(systemOf(setPrompt({ count: 5, avoid: [] }))).toMatch(/JSON array/);
    });

    it('names the station when it has a name and says nothing when it does not', () => {
        expect(systemOf(setPrompt({ count: 5, avoid: [] }, { station: 'Dead Air' }))).toMatch(/called Dead Air/);
        expect(systemOf(setPrompt({ count: 5, avoid: [] }))).not.toMatch(/called/);
    });

    it('carries the persona’s own description of the music', () => {
        const system = systemOf(setPrompt({ count: 5, avoid: [] }, { music: 'Krautrock and dub, nothing after 1985.' }));

        expect(system).toMatch(/Krautrock and dub/);
    });

    it('carries what the operator likes and dislikes, as steering', () => {
        const system = systemOf(
            setPrompt(
                { count: 5, avoid: [] },
                { taste: { likedArtists: ['Sleep'], dislikedArtists: ['Nickelback'], dislikedTracks: ['"Photograph" by Nickelback'] } },
            ),
        );

        expect(system).toMatch(/LIKES these artists/);
        expect(system).toMatch(/Sleep/);
        expect(system).toMatch(/DISLIKES these artists/);
        expect(system).toMatch(/Photograph/);
    });

    it('tells the model the dislikes are enforced whatever it does', () => {
        // A model told a list is advisory spends picks testing it. It is not advisory: PickResolver
        // drops a disliked record whatever named it.
        const system = systemOf(setPrompt({ count: 5, avoid: [] }, { taste: { dislikedArtists: ['Nickelback'] } }));

        expect(system).toMatch(/drops them anyway/);
    });

    it('words the liked records as something to search for rather than something to name', () => {
        // These are real, well-formed records that no tool returned, which is the NEVER_ECHO hazard
        // exactly. The grounding rule stands: only a search result may be named.
        const system = systemOf(setPrompt({ count: 5, avoid: [] }, { taste: { likedTracks: ['"Dopesmoker" by Sleep'] } }));

        expect(system).toMatch(/Search for them/);
    });

    it('says how many likes it did not show, so a long list does not read as a short one', () => {
        const many = Array.from({ length: 25 }, (_, index) => `Artist ${index}`);
        const system = systemOf(setPrompt({ count: 5, avoid: [] }, { taste: { likedArtists: many } }));

        expect(system).toMatch(/and 5 more/);
    });

    it('says nothing about taste when the operator has rated nothing', () => {
        expect(systemOf(setPrompt({ count: 5, avoid: [] }, { taste: {} }))).not.toMatch(/LIKES/);
        expect(systemOf(setPrompt({ count: 5, avoid: [] }))).not.toMatch(/DISLIKES/);
    });

    it('asks for the count it was given', () => {
        expect(userOf(setPrompt({ count: 12, avoid: [] }))).toMatch(/Choose 12 records/);
    });

    it('carries the operator’s brief in the turn about this refill', () => {
        // The user turn rather than the system one: the system turn is the standing job and this is
        // what tonight was asked for.
        const messages = setPrompt({ count: 5, avoid: [], brief: 'heavy metal hits' });

        expect(userOf(messages)).toMatch(/heavy metal hits/);
        expect(systemOf(messages)).not.toMatch(/heavy metal hits/);
    });

    it('does not send the station description at all once the operator has briefed it', () => {
        // Structural rather than an instruction, and that is the point. A local model handed
        // "ambient and nothing else" AND "heavy metal hits" splits the difference, so the cheapest
        // way to make the brief win is not to hand it both. Brief the station and the persona is
        // purely the presenter; leave it unbriefed and the persona programmes.
        const briefed = setPrompt({ count: 5, avoid: [], brief: 'heavy metal hits' }, { music: 'Ambient and nothing else.' });

        expect(systemOf(briefed)).not.toMatch(/Ambient and nothing else/);
        expect(userOf(briefed)).toMatch(/heavy metal hits/);
    });

    it('still sends it when nobody briefed the broadcast', () => {
        const bare = setPrompt({ count: 5, avoid: [] }, { music: 'Ambient and nothing else.' });

        expect(systemOf(bare)).toMatch(/Ambient and nothing else/);
    });

    it('treats a blank brief as no brief, so the persona still programmes', () => {
        const blank = setPrompt({ count: 5, avoid: [], brief: '   ' }, { music: 'Ambient and nothing else.' });

        expect(systemOf(blank)).toMatch(/Ambient and nothing else/);
    });

    it('says nothing about a brief that is absent or blank', () => {
        expect(userOf(setPrompt({ count: 5, avoid: [] }))).not.toMatch(/operator has asked/i);
        expect(userOf(setPrompt({ count: 5, avoid: [], brief: '   ' }))).not.toMatch(/operator has asked/i);
    });

    it('states the do-not-echo rule beside the records it governs', () => {
        // The one hazard in this prompt: a real, well-formed record that no tool returned. A rule
        // fifteen lines above the thing it governs is a rule about something else.
        const user = userOf(setPrompt({ count: 5, avoid: ['"Windowlicker" by Aphex Twin'] }));

        expect(user).toContain(NEVER_ECHO);
        expect(user).toMatch(/Windowlicker/);
    });

    it('is worded about provenance rather than invention', () => {
        // "Never invent an id" is satisfied by echoing something real, which is the exact failure.
        expect(NEVER_ECHO).toMatch(/not suggestions/i);
        expect(NEVER_ECHO).not.toMatch(/invent/i);
    });

    it('says nothing about avoiding anything when there is nothing to avoid', () => {
        expect(userOf(setPrompt({ count: 5, avoid: [] }))).not.toMatch(/do NOT choose/);
    });

    it('caps how much of a long running order it shows, and says it capped it', () => {
        const avoid = Array.from({ length: 60 }, (_, index) => `"Song ${index}" by Artist ${index}`);

        const user = userOf(setPrompt({ count: 5, avoid }));

        expect(user).toMatch(/and 20 more/);
        expect(user).not.toMatch(/Song 45/);
    });

    it('warns the picker off records with no clean version, but only under the hard rule', () => {
        // Advice rather than a prohibition, and phrased as what will HAPPEN: the policy is enforced
        // in `PickResolver` whatever the model does, so the only thing this buys is picks not spent
        // on records that will be dropped. `search_catalog` reaches records `search_library` has
        // already excluded, which is why saying it at all is worth a line.
        expect(systemOf(setPrompt({ count: 5, avoid: [] }, { cleanOnly: true }))).toMatch(/clean version/i);
        expect(systemOf(setPrompt({ count: 5, avoid: [] }))).not.toMatch(/clean version/i);
    });

    it('says nothing about it for a mere preference, which is settled after the pick', () => {
        // A preference chooses between two COPIES of a work the model already named, long after this
        // prompt. There is nothing here for it to act on, so sending it would be spending context on
        // a rule that cannot change the answer.
        expect(systemOf(setPrompt({ count: 5, avoid: [] }, { cleanOnly: false }))).not.toMatch(/clean version/i);
    });
});

describe('readPicks', () => {
    it('reads a plain JSON array', () => {
        const answer = '[{"title": "Windowlicker", "artist": "Aphex Twin"}, {"title": "Xtal", "artist": "Aphex Twin"}]';

        expect(readPicks(answer, 10)).toEqual([
            { title: 'Windowlicker', artist: 'Aphex Twin' },
            { title: 'Xtal', artist: 'Aphex Twin' },
        ]);
    });

    it('reads an array a model wrapped in prose', () => {
        // A perfectly good array that JSON.parse will not touch, which is why the brackets are
        // located rather than the whole answer parsed.
        const answer = 'Here you go:\n[{"title": "A", "artist": "One"}]\nHope that works!';

        expect(readPicks(answer, 10)).toEqual([{ title: 'A', artist: 'One' }]);
    });

    it('reads an array a reasoning model thought out loud before', () => {
        const answer = '<think>I should search first, then pick.</think>[{"title": "A", "artist": "One"}]';

        expect(readPicks(answer, 10)).toEqual([{ title: 'A', artist: 'One' }]);
    });

    it('drops an entry missing a title or an artist rather than repairing it', () => {
        // A half-named record resolves to the wrong one or to nothing, and both are worse than a
        // shorter set that the floor will finish.
        const answer = '[{"title": "A"}, {"artist": "Two"}, {"title": "C", "artist": "Three"}, {"title": "  ", "artist": "Four"}]';

        expect(readPicks(answer, 10)).toEqual([{ title: 'C', artist: 'Three' }]);
    });

    it('trims what it keeps', () => {
        expect(readPicks('[{"title": "  A  ", "artist": " One "}]', 10)).toEqual([{ title: 'A', artist: 'One' }]);
    });

    it('falls back to a numbered list, which is what a local model actually sends', () => {
        const answer = '1. "Windowlicker" by Aphex Twin\n2. Teardrop by Massive Attack';

        expect(readPicks(answer, 10)).toEqual([
            { title: 'Windowlicker', artist: 'Aphex Twin' },
            { title: 'Teardrop', artist: 'Massive Attack' },
        ]);
    });

    it('reads a dashed list with either dash', () => {
        const answer = '- Windowlicker — Aphex Twin\n- Teardrop - Massive Attack';

        expect(readPicks(answer, 10)).toEqual([
            { title: 'Windowlicker', artist: 'Aphex Twin' },
            { title: 'Teardrop', artist: 'Massive Attack' },
        ]);
    });

    it('skips a list line it cannot split rather than guessing', () => {
        const answer = '1. "Windowlicker" by Aphex Twin\n2. something with no separator at all';

        expect(readPicks(answer, 10)).toEqual([{ title: 'Windowlicker', artist: 'Aphex Twin' }]);
    });

    it('never returns more than was asked for', () => {
        const answer = '[{"title": "A", "artist": "One"}, {"title": "B", "artist": "Two"}, {"title": "C", "artist": "Three"}]';

        expect(readPicks(answer, 2)).toHaveLength(2);
    });

    it('answers with nothing for an answer that holds no picks at all', () => {
        expect(readPicks('I could not find anything suitable.', 10)).toEqual([]);
        expect(readPicks('', 10)).toEqual([]);
    });

    it('keeps every complete record when the model ran out of room mid-array', () => {
        // The failure that cost a live run its whole answer. `JSON.parse` over the span from the
        // first bracket to the last cannot read a truncated array at all, so the parse threw, the
        // line reader got the raw JSON, and a real pick came out as
        // `Single Version","artist":"Louis Armstrong"}, — {"title":"A Kiss To Build A Dream On`.
        // Reading objects one at a time makes truncation cost the one record it interrupted.
        const answer =
            '[{"title": "A Kiss To Build A Dream On - Single Version", "artist": "Louis Armstrong"}, ' +
            '{"title": "Alone Together", "artist": "Kenny Dorham"}, ' +
            '{"title": "So What", "arti';

        expect(readPicks(answer, 10)).toEqual([
            { title: 'A Kiss To Build A Dream On - Single Version', artist: 'Louis Armstrong' },
            { title: 'Alone Together', artist: 'Kenny Dorham' },
        ]);
    });

    it('never hands JSON to the line reader, however little of it survived', () => {
        // The other half of the same bug: scraping JSON as prose does not fail, it invents records,
        // and each invention then costs a provider lookup.
        expect(readPicks('[{"title": "So What - Alt', 10)).toEqual([]);
    });

    it('reads a title containing a brace or an escaped quote', () => {
        // Why this scans rather than matching a regex: both are legal inside a JSON string and both
        // appear in real titles.
        const answer = '[{"title": "Say \\"Hello\\" {Reprise}", "artist": "One"}, {"title": "B", "artist": "Two"}]';

        expect(readPicks(answer, 10)).toEqual([
            { title: 'Say "Hello" {Reprise}', artist: 'One' },
            { title: 'B', artist: 'Two' },
        ]);
    });

    it('does not read an empty array as a reason to try the line reader', () => {
        // An array of nothing usable is the model saying nothing, not an invitation to scrape
        // whatever prose surrounds it.
        expect(readPicks('[]', 10)).toEqual([]);
    });
});
