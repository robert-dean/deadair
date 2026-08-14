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

    it('makes searching mandatory rather than encouraged', () => {
        // The grounding rule, now about provenance rather than about the library: a name no tool
        // returned still resolves to nothing and is dropped, whichever tool could have returned it.
        const system = systemOf(setPrompt({ count: 5, avoid: [] }));

        expect(system).toMatch(/MUST find records with the search_library and search_catalog tools/);
        expect(system).toMatch(/Never name a record from your own knowledge/);
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
        // records literally titled "Jazz Club". Expanding the brief is the one thing here the model's
        // own knowledge is for, and it does not touch the grounding rule — knowing a brief implies
        // Bill Evans is knowledge, naming a record a search returned is provenance.
        const system = systemOf(setPrompt({ count: 5, avoid: [] }));

        expect(system).toMatch(/A brief describes a STYLE, not a search term/);
        expect(system).toMatch(/search for THOSE by name/);
        // And the axis the search itself offers for it, which is the half the model cannot infer.
        expect(system).toMatch(/genre, yearFrom and yearTo filters/);
        // The rule it must not be read as loosening.
        expect(system).toMatch(/Never name a record from your own knowledge/);
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

    it('carries the operator’s own description of the music', () => {
        const system = systemOf(setPrompt({ count: 5, avoid: [] }, { persona: 'Krautrock and dub, nothing after 1985.' }));

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

    it('says the brief beats the station description where the two disagree', () => {
        // They genuinely can: a station described as ambient whose operator asked for metal. The
        // person in the room wins.
        const user = userOf(setPrompt({ count: 5, avoid: [], brief: 'heavy metal hits' }, { persona: 'Ambient and nothing else.' }));

        expect(user).toMatch(/follow this/i);
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

    it('does not read an empty array as a reason to try the line reader', () => {
        // An array of nothing usable is the model saying nothing, not an invitation to scrape
        // whatever prose surrounds it.
        expect(readPicks('[]', 10)).toEqual([]);
    });
});
