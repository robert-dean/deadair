// The slow half of planting a break. Every failure here has to end as a row the director skips,
// never as an exception and never as a segment stuck `planned` forever: a break that cannot be
// written must cost the station that break and nothing else.

import { describe, expect, it, vi } from 'vitest';
import type { SpeechCue } from '@deadair/plugin-sdk';

import type { StoredBreakRequest } from '../../../src/modules/director/break.request.js';
import type { BreakStory } from '../../../src/modules/director/break.writer.js';
import { StationLineup } from '../../../src/modules/director/station.lineup.js';
import { WriteBreakJob } from '../../../src/modules/director/write.break.job.js';
import type { RundownTrack } from '../../../src/modules/playout/rundown.js';
import type { Persona } from '../../../src/modules/personas/persona.js';
import type { PersonaStoryForPrompt } from '../../../src/modules/personas/persona.story.js';
import type { Segment } from '../../../src/modules/render/segment.repository.js';
import type { ScriptWrite } from '../../../src/modules/render/script.history.repository.js';

vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const track = (title: string, artist: string, trackId?: string): RundownTrack => ({
    pluginId: 'deadair.spotify',
    externalId: title,
    title,
    artists: [artist],
    artist,
    ...(trackId === undefined ? {} : { trackId }),
});

const planned = (overrides: Partial<Segment> = {}): Segment =>
    ({ id: 'seg-1', kind: 'talkbreak', state: 'writing', label: 'Talk break', source: 'render', ...overrides }) as Segment;

/** A rotation with a break planted between the second and third record. */
const lineupWithBreak = async (segmentId = 'seg-1'): Promise<StationLineup> => {
    const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
    lineup.append([track('Solid Air', 'John Martyn'), track('Pink Moon', 'Nick Drake')]);
    lineup.insertSegments([{ segmentId, atIndex: 1 }]);
    return lineup;
};

function harness(
    options: {
        segment?: Segment;
        lineup?: StationLineup;
        written?: unknown;
        wrote?: boolean;
        historyThrows?: boolean;
        /** What the station knows about the records either side, keyed by track id. */
        facts?: Map<string, string[]>;
        factsThrow?: boolean;
        /** The persona on air, for the one test about handing it to the writers. */
        persona?: Persona;
        /** What that character has accumulated, for the tests about carrying and resting it. */
        notebook?: { trait: readonly string[]; said: readonly string[] };
        /** One of that character's own stories, for the tests about the rung and the rest. */
        story?: PersonaStoryForPrompt;
        /** The request this break was made for, for the one test about handing its context over. */
        request?: StoredBreakRequest;
        /** What a bulletin has to report, for the one test about handing the stories over. */
        stories?: readonly BreakStory[];
        /** What the bulletin is ABOUT, once the source has resolved the band's category. */
        subject?: { key: string; label: string };
        /** What this broadcast has played, for the tests about the writer's memory of the show. */
        played?: readonly { title: string; artist: string }[];
        /** What the installed engine can perform, for the tests about handing that to the writers. */
        cues?: readonly SpeechCue[];
        /** What the station has already said this broadcast. */
        said?: readonly string[];
        /** Present and `undefined` for the off-air case, which falls back to the per-kind read. */
        broadcastId?: string;
        /** For the one test that proves a broken history read still produces a break. */
        spokenThrows?: boolean;
        /** What is on the presenting character's soundboard. Empty for every test that is not about one. */
        pads?: { name: string }[];
        /** How long since the station last made a noise, which is what the floor's spacing reads. */
        breaksSincePad?: number;
        /** Which writer produced the words, since the floor's pad applies only to the station's own. */
        writer?: string;
        /** Settings as the STRINGS a config layer actually holds. See the off-case assertions. */
        settings?: Record<string, string>;
    } = {},
) {
    const segments = {
        claimForWrite: vi.fn(async () => ('segment' in options ? options.segment : planned())),
        // Read only for a segment the order does not hold, which is how the job tells a break that
        // is early from one that is deliberately waiting for its audio before it takes a slot.
        findById: vi.fn(async () => ('segment' in options ? options.segment : planned())),
        recentScripts: vi.fn(async () => []),
        writeScript: vi.fn(async () => options.wrote ?? true),
        breaksSincePad: vi.fn(async () => options.breaksSincePad ?? 0),
        markFailed: vi.fn(async () => {}),
    };
    const lineups = { load: vi.fn(async () => options.lineup) };
    // What a break was asked for, for one that came from a request. Read only when the segment names
    // one, so an ordinary planted break never reaches this.
    const requests = { findById: vi.fn(async () => options.request) };
    const history = {
        recordAll: vi.fn(async (_writes: readonly ScriptWrite[]) => options.historyThrows && Promise.reject(new Error('the history table is gone'))),
        spokenDuring: vi.fn(async () =>
            options.spokenThrows === true ? Promise.reject(new Error('the history table is gone')) : (options.said ?? []),
        ),
    };
    const wrote = (script: string, label: string, writer: string) => ({
        written: { script, label },
        writer,
        attempts: [{ writer, outcome: 'written', written: { script, label }, durationMs: 1 }],
    });
    const writers = { write: vi.fn(async () => options.written ?? wrote('talking', 'Talk break: one into two', options.writer ?? 'deterministic')) };
    const enrichment = {
        factsForTracks: vi.fn(async (_ids: readonly string[], _rotate?: number) =>
            options.factsThrow ? Promise.reject(new Error('the enrichment tables are gone')) : (options.facts ?? new Map<string, string[]>()),
        ),
    };
    // Who the station is right now. `undefined` unless a test asks otherwise, because a station
    // that has chosen no persona is the state every assertion below was written against.
    const personas = { presenting: vi.fn(async () => options.persona) };
    // A rack with nothing on it, which is what every persona in these tests has: `pads` answers `{}`
    // for an empty set, so the request is byte-identical to one built before soundboards existed.
    const pads = {
        onSet: vi.fn(async () => options.pads ?? []),
        named: vi.fn(async (_setKey: string, name: string) => (options.pads ?? []).find(pad => pad.name === name)),
        markUsed: vi.fn(async (_id: string) => {}),
    };
    // What that character has accumulated. Empty unless a test asks otherwise, and never read at all
    // for a station presenting as nobody — which is what the `personaKey === undefined` guard buys
    // and what most assertions here were written against.
    const notes = {
        forPrompt: vi.fn(async () => ({ notes: options.notebook ?? { trait: [], said: [] }, ids: options.notebook === undefined ? [] : ['n1'] })),
        markUsed: vi.fn(async () => {}),
    };
    // The character's own history. Named for the table rather than `stories`, which in this file
    // already means the headlines a bulletin reads. Nothing by default, which is every station until
    // somebody writes one down and the state every other assertion here was written against.
    const personaStories = {
        forPrompt: vi.fn(async () => (options.story === undefined ? undefined : { id: 's1', story: options.story })),
        markTold: vi.fn(async (_id: string) => {}),
    };
    const jobs = { send: vi.fn(async () => {}) };
    const config = { get: vi.fn((key: string, fallback: string) => options.settings?.[key] ?? fallback) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    // The feed's write side. Only a break that fell through to a second writer reaches it.
    const activity = { record: vi.fn(async (_event: Record<string, unknown>) => undefined) };
    // What a bulletin is written from. `undefined` for every kind that does not report, which is
    // every kind these assertions are about.
    const bulletin = {
        storiesFor: vi.fn(async (_kind: string, _context?: unknown, _now?: number) =>
            options.stories === undefined
                ? undefined
                : { stories: options.stories, ...(options.subject === undefined ? {} : { subject: options.subject }) },
        ),
    };
    // What this broadcast has played, for the writer's memory of the show it is presenting. Empty
    // unless a test asks otherwise, which is the state every other assertion here was written
    // against.
    const plays = { duringBroadcast: vi.fn(async () => options.played ?? []) };
    // Whether a broadcast is on at all. Present by default, because a break being written is
    // overwhelmingly a break on a station that is airing — the `undefined` case has its own test.
    const identity = { current: vi.fn(() => ('broadcastId' in options ? options.broadcastId : 'broadcast-1')) };
    // What the installed engine can perform beyond reading. Nothing by default, which is the state of
    // every station whose speech plugin only reads words and the one every other assertion here was
    // written against.
    const speech = { cues: vi.fn(async () => options.cues ?? []) };

    const job = new WriteBreakJob(
        lineups as never,
        segments as never,
        requests as never,
        history as never,
        writers as never,
        enrichment as never,
        bulletin as never,
        personas as never,
        pads as never,
        notes as never,
        personaStories as never,
        plays as never,
        identity as never,
        speech as never,
        activity as never,
        jobs as never,
        config as never,
        { id: 'job-1' } as never,
        {} as never,
        logger as never,
    );

    return {
        job,
        segments,
        pads,
        lineups,
        requests,
        history,
        writers,
        enrichment,
        personas,
        notes,
        personaStories,
        jobs,
        logger,
        activity,
        bulletin,
        plays,
        identity,
        speech,
    };
}

describe('WriteBreakJob', () => {
    it('writes the script and sends the render', async () => {
        const { job, segments, jobs } = harness({ lineup: await lineupWithBreak() });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).toHaveBeenCalledWith('seg-1', {
            script: 'talking',
            label: 'Talk break: one into two',
            writer: 'deterministic',
            // Always written, and empty for a break that hit nothing. It clears on a rewrite for
            // `claimsItemId`'s reason: a hit describes the words it was written beside.
            pads: [],
        });
        expect(jobs.send).toHaveBeenCalledWith('render.segment', { segmentId: 'seg-1' });
    });

    it('hands the writers whoever is on air, and nothing when nobody is', async () => {
        // Read here rather than by any writer, for the reason the facts are: the character the
        // station is in is a property of the moment, and each binding uses a different half of it.
        const persona = { id: 'p-1', key: 'pirate', label: 'Pirate captain', style: 'a pirate captain', active: true } as Persona;
        const { job, writers } = harness({ lineup: await lineupWithBreak(), persona });

        await job.run({ segmentId: 'seg-1' });

        expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ persona }));

        const bare = harness({ lineup: await lineupWithBreak() });
        await bare.job.run({ segmentId: 'seg-1' });

        expect(bare.writers.write).toHaveBeenCalledWith(expect.not.objectContaining({ persona: expect.anything() }));
    });

    it('hands the writers what a requested break is about, and asks nothing for a planted one', async () => {
        // Read off the row rather than carried in the payload, for the reason the neighbours are: a
        // job re-sent after a restart has to be able to find out what it is writing about.
        const context = { headline: 'the bridge is shut' };
        const { job, writers, requests } = harness({
            lineup: await lineupWithBreak(),
            segment: planned({ requestId: 'req-1' }),
            request: { id: 'req-1', kind: 'news', urgency: 'interrupt', source: 'operator', state: 'pending', context },
        });

        await job.run({ segmentId: 'seg-1' });

        expect(requests.findById).toHaveBeenCalledWith('req-1');
        expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ context }));

        // The station's own planted break, which is most of them: no request, so no read at all.
        const planted = harness({ lineup: await lineupWithBreak() });
        await planted.job.run({ segmentId: 'seg-1' });

        expect(planted.requests.findById).not.toHaveBeenCalled();
        expect(planted.writers.write).toHaveBeenCalledWith(expect.not.objectContaining({ context: expect.anything() }));
    });

    it('hands over what the format clock asked a planted break to be about', async () => {
        // The other producer of a context, and it is a different fact rather than a fallback: a
        // request says why something asked for this break, and a band says what the station's own
        // clock wanted this one to cover. It rides the ROW because the words are asked for several
        // passes after the band claimed the slot.
        const { job, writers } = harness({
            lineup: await lineupWithBreak(),
            segment: planned({ kind: 'news', context: { topic: 'technology' } }),
        });

        await job.run({ segmentId: 'seg-1' });

        expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ context: { topic: 'technology' } }));
    });

    it('lets what asked for a break outrank what the clock planted it for', async () => {
        // Both, which happens when an operator asks for a bulletin at a slot a band already claimed.
        // The request is on top: a break that exists because something happened is described by that
        // thing first.
        const { job, writers } = harness({
            lineup: await lineupWithBreak(),
            segment: planned({ kind: 'news', requestId: 'req-1', context: { topic: 'technology' } }),
            request: {
                id: 'req-1',
                kind: 'news',
                urgency: 'next',
                source: 'operator',
                state: 'pending',
                context: { topic: 'world', headline: 'the bridge is shut' },
            },
        });

        await job.run({ segmentId: 'seg-1' });

        expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ context: { topic: 'world', headline: 'the bridge is shut' } }));
    });

    it('hands a bulletin the stories, against the moment it will actually air', async () => {
        const stories = [{ headline: 'Bridge reopens after four years.' }];
        const { job, writers, bulletin } = harness({
            lineup: await lineupWithBreak(),
            segment: planned({ kind: 'news', airsAt: 1_700_000_000_000 }),
            stories,
        });

        await job.run({ segmentId: 'seg-1' });

        // The slot's own time rather than now: a bulletin written a quarter of an hour early is
        // judged fresh against when it is heard, not against when it was written.
        expect(bulletin.storiesFor).toHaveBeenCalledWith('news', undefined, 1_700_000_000_000);
        expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ stories }));
    });

    it('hands over what the bulletin turned out to be about, resolved rather than as a key', async () => {
        // The writers are handed a SUBJECT and never the raw context: the label is what a bulletin
        // says out loud, and resolving it in one place is what keeps the model binding and the floor
        // from resolving it differently.
        const { job, writers } = harness({
            lineup: await lineupWithBreak(),
            segment: planned({ kind: 'news', context: { topic: 'technology' } }),
            stories: [{ headline: 'Chip plant reopens.' }],
            subject: { key: 'technology', label: 'Technology' },
        });

        await job.run({ segmentId: 'seg-1' });

        expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ subject: { key: 'technology', label: 'Technology' } }));
    });

    it('hands no stories at all to a kind that does not report', async () => {
        // `undefined` from the source is what keeps the branch about news inside a file about news.
        const { job, writers } = harness({ lineup: await lineupWithBreak() });

        await job.run({ segmentId: 'seg-1' });

        expect(writers.write).toHaveBeenCalledWith(expect.not.objectContaining({ stories: expect.anything() }));
    });

    it('asks who is presenting THIS broadcast, not who the station is', async () => {
        // A show names its host and the station names its default. Resolving that in one place is
        // what stops the break writer and the record chooser disagreeing about who is on.
        const lineup = new StationLineup({ name: 'Tonight', mode: 'rotation', onEnd: 'extend', source: 'import', personaId: 'p-tonight' });
        lineup.append([track('Solid Air', 'John Martyn'), track('Pink Moon', 'Nick Drake')]);
        lineup.insertSegments([{ segmentId: 'seg-1', atIndex: 1 }]);
        const { job, personas } = harness({ lineup });

        await job.run({ segmentId: 'seg-1' });

        expect(personas.presenting).toHaveBeenCalledWith('p-tonight');
    });

    it("hands the writers this character's notebook, and rests what it took", async () => {
        // Rested HERE rather than inside a writer, so the rotation belongs to the moment: a model
        // that declined and a floor that could not read a note either way have between them still
        // used this character's turn, which is the only reading that makes the cooldown mean
        // anything.
        const persona = { id: 'p-1', key: 'pirate', label: 'Pirate captain', style: 'a pirate captain', active: true } as Persona;
        const notebook = { trait: ['has taken to calling the listener a shipmate'], said: ['called Booker T. the tightest band alive'] };
        const { job, writers, notes } = harness({ lineup: await lineupWithBreak(), persona, notebook });

        await job.run({ segmentId: 'seg-1' });

        expect(notes.forPrompt).toHaveBeenCalledWith('pirate');
        expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ notebook }));
        expect(notes.markUsed).toHaveBeenCalledWith(['n1']);
    });

    it('reads no notebook at all for a station presenting as nobody', async () => {
        // The state every fresh install is in, and the one every other assertion here was written
        // against: no persona means no key to look one up by, so the read never happens.
        const { job, writers, notes } = harness({ lineup: await lineupWithBreak() });

        await job.run({ segmentId: 'seg-1' });

        expect(notes.forPrompt).not.toHaveBeenCalled();
        expect(writers.write).toHaveBeenCalledWith(expect.not.objectContaining({ notebook: expect.anything() }));
    });

    it('writes the break anyway when the notebook cannot be read', async () => {
        // Best-effort, exactly like the facts and the broadcast's memory beside it. Nothing about a
        // notebook is worth a silent slot.
        const persona = { id: 'p-1', key: 'pirate', label: 'Pirate captain', style: 'a pirate captain', active: true } as Persona;
        const { job, segments, notes, logger } = harness({ lineup: await lineupWithBreak(), persona });
        notes.forPrompt.mockRejectedValueOnce(new Error('the database is away'));

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });

    // The character's own history, which is the one piece of material here whose ROTATION and whose
    // gate are the same decision: reading a story is what spends it, so a rung consulted anywhere
    // else would leave the store reporting tellings nobody heard.
    describe("one of the character's own stories", () => {
        const persona = (storytelling?: 'never' | 'occasionally' | 'often') =>
            ({
                id: 'p-1',
                key: 'conspiracy',
                label: 'Overnight host',
                style: 'an overnight host',
                active: true,
                ...(storytelling === undefined ? {} : { storytelling }),
            }) as Persona;
        const story: PersonaStoryForPrompt = {
            title: 'The Barstow lights',
            story: 'You saw three lights over the desert.',
            details: [],
            timesTold: 0,
        };
        /** The same rotation with both records catalogued, so there is something to know about them. */
        const catalogued = (): StationLineup => {
            const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
            lineup.append([track('Solid Air', 'John Martyn', 'track-a'), track('Pink Moon', 'Nick Drake', 'track-b')]);
            lineup.insertSegments([{ segmentId: 'seg-1', atIndex: 1 }]);
            return lineup;
        };

        const knownRecords = new Map([
            ['track-a', ['John Martyn was born in New Malden in 1948.']],
            ['track-b', ['Recorded over two nights.']],
        ]);

        it('hands one over on a talk break, and rests it', async () => {
            const { job, writers, personaStories } = harness({ lineup: await lineupWithBreak(), persona: persona('often'), story });

            await job.run({ segmentId: 'seg-1' });

            expect(personaStories.forPrompt).toHaveBeenCalledWith('conspiracy');
            expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ story }));
            expect(personaStories.markTold).toHaveBeenCalledWith('s1');
        });

        it('reads none at all at "never", so nothing is spent', async () => {
            const { job, writers, personaStories } = harness({ lineup: await lineupWithBreak(), persona: persona('never'), story });

            await job.run({ segmentId: 'seg-1' });

            expect(personaStories.forPrompt).not.toHaveBeenCalled();
            expect(personaStories.markTold).not.toHaveBeenCalled();
            expect(writers.write).toHaveBeenCalledWith(expect.not.objectContaining({ story: expect.anything() }));
        });

        // The default rung, and the moment it fires in is the one the prompt would otherwise answer
        // with a prohibition and nothing else — which is where the invented pressing plants came
        // from when it was measured.
        it('offers one by default only where the station knows nothing about the records', async () => {
            const silent = harness({ lineup: await lineupWithBreak(), persona: persona(), story });
            const known = harness({ lineup: catalogued(), persona: persona(), story, facts: knownRecords });

            await silent.job.run({ segmentId: 'seg-1' });
            await known.job.run({ segmentId: 'seg-1' });

            expect(silent.writers.write).toHaveBeenCalledWith(expect.objectContaining({ story }));
            expect(known.writers.write).toHaveBeenCalledWith(expect.not.objectContaining({ story: expect.anything() }));
            // And nothing was spent on the break that never carried one, which is the whole reason
            // this rung is read here rather than where the prompt is built.
            expect(known.personaStories.markTold).not.toHaveBeenCalled();
        });

        it('offers one at "often" even where both records carry notes', async () => {
            const { job, writers } = harness({ lineup: catalogued(), persona: persona('often'), story, facts: knownRecords });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ story }));
        });

        it('reads none for a station presenting as nobody', async () => {
            const { job, personaStories } = harness({ lineup: await lineupWithBreak(), story });

            await job.run({ segmentId: 'seg-1' });

            expect(personaStories.forPrompt).not.toHaveBeenCalled();
        });

        it('spends nothing for a character that has written none', async () => {
            const { job, writers, personaStories } = harness({ lineup: await lineupWithBreak(), persona: persona('often') });

            await job.run({ segmentId: 'seg-1' });

            expect(personaStories.markTold).not.toHaveBeenCalled();
            expect(writers.write).toHaveBeenCalledWith(expect.not.objectContaining({ story: expect.anything() }));
        });

        it('writes the break anyway when the stories cannot be read', async () => {
            // Best-effort, exactly like the notebook and the facts beside it.
            const { job, segments, personaStories, logger } = harness({ lineup: await lineupWithBreak(), persona: persona('often'), story });
            personaStories.forPrompt.mockRejectedValueOnce(new Error('the database is away'));

            await job.run({ segmentId: 'seg-1' });

            expect(segments.writeScript).toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalled();
        });

        // A bulletin is the argued exclusion: a model asked to report the news and handed material
        // reads the material out. Excluded HERE as well as at render, so it cannot spend one either.
        it('is never read for a kind whose shape carries no story', async () => {
            const { job, personaStories } = harness({
                lineup: await lineupWithBreak(),
                segment: planned({ kind: 'news' }),
                persona: persona('often'),
                story,
                stories: [{ headline: 'A thing happened' }],
            });

            await job.run({ segmentId: 'seg-1' });

            expect(personaStories.forPrompt).not.toHaveBeenCalled();
        });
    });

    it('hands the writers what the installed engine can perform', async () => {
        // Read here rather than by any writer, so every binding asked for this break agrees about
        // what was on offer — and so a station that changed engine between two breaks writes for the
        // one that is actually going to speak.
        const { job, writers } = harness({ lineup: await lineupWithBreak(), cues: ['laugh', 'sigh'] });

        await job.run({ segmentId: 'seg-1' });

        expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ reactions: ['laugh', 'sigh'] }));
    });

    it('says nothing about reactions for an engine that only reads words', async () => {
        // Most stations, and the state every other assertion here was written against. The prompt is
        // then byte-identical to one built before any of this existed.
        const { job, writers } = harness({ lineup: await lineupWithBreak() });

        await job.run({ segmentId: 'seg-1' });

        expect(writers.write).toHaveBeenCalledWith(expect.not.objectContaining({ reactions: expect.anything() }));
    });

    it('writes the break anyway when the engine cannot be asked', async () => {
        // Best-effort like the notebook above it. A flourish is never worth a silent slot, and the
        // render path strips an unperformable reaction on its own regardless.
        const { job, segments, speech } = harness({ lineup: await lineupWithBreak() });
        speech.cues.mockRejectedValueOnce(new Error('the engine is away'));

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).toHaveBeenCalled();
    });

    it("speaks a planted break in the persona's voice, and leaves a hand-planned one alone", async () => {
        // Written with the words rather than at render time, so a persona swapped in between cannot
        // have this sentence read out by a different character.
        const persona = { id: 'p-1', key: 'pirate', label: 'Pirate captain', style: 'a pirate captain', voice: 'salt', active: true } as Persona;
        const { job, segments } = harness({ lineup: await lineupWithBreak(), persona });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.objectContaining({ voice: 'salt', personaId: 'p-1' }));

        // A voice already on the row came from an operator through `POST /segments`, which is an
        // instruction rather than a default.
        const byHand = harness({ lineup: await lineupWithBreak(), persona, segment: planned({ voice: 'newsreader' }) });
        await byHand.job.run({ segmentId: 'seg-1' });

        expect(byHand.segments.writeScript).toHaveBeenCalledWith('seg-1', expect.objectContaining({ voice: 'newsreader' }));
    });

    it('offers no voice at all when no persona is on air', async () => {
        // Absent means leave the column alone, which is what keeps the speech plugin's own default
        // the answer for a station that has chosen nothing.
        const { job, segments } = harness({ lineup: await lineupWithBreak() });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.not.objectContaining({ voice: expect.anything() }));
    });

    it('records whichever writer actually spoke, rather than assuming', async () => {
        // The job cannot know: once a kind has more than one writer, the answer that came back has
        // been through however many declined before it. A constant here is the bug where every
        // break claims to be deterministic and a model quietly stops being visible.
        const { job, segments } = harness({
            lineup: await lineupWithBreak(),
            written: {
                written: { script: 'talking', label: 'Talk break: one into two' },
                writer: 'a-model',
                attempts: [
                    { writer: 'a-model', outcome: 'written', written: { script: 'talking', label: 'Talk break: one into two' }, durationMs: 1 },
                ],
            },
        });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.objectContaining({ writer: 'a-model' }));
    });

    describe('the record of what it wrote', () => {
        /** A model that threw, and the floor that covered for it. */
        const degraded = {
            written: { script: 'That was Solid Air.', label: 'Back-announce' },
            writer: 'deterministic',
            attempts: [
                { writer: 'a-model', outcome: 'failed', reason: 'out of budget', durationMs: 41 },
                { writer: 'deterministic', outcome: 'written', written: { script: 'That was Solid Air.', label: 'Back-announce' }, durationMs: 1 },
            ],
        };

        it('keeps every attempt, not only the one that produced words', async () => {
            // The floor's row on its own reads as a station that never had a model configured, which
            // is the wrong thing for an operator to conclude at the exact moment their model broke.
            const { job, history } = harness({ lineup: await lineupWithBreak(), written: degraded });

            await job.run({ segmentId: 'seg-1' });

            const written = history.recordAll.mock.calls[0]![0];
            expect(written).toHaveLength(2);
            expect(written[0]).toMatchObject({ writer: 'a-model', outcome: 'failed', reason: 'out of budget', durationMs: 41 });
            expect(written[1]).toMatchObject({ writer: 'deterministic', outcome: 'written', script: 'That was Solid Air.' });
        });

        it('tells the feed a break degraded, and says nothing when one did not', async () => {
            // The two facts the registry answers with every attempt for: that a writer was asked and
            // declined, and that the floor covered. `segments.writer` records who won and cannot say
            // who was asked, so this is not derivable from the row afterwards.
            const fell = harness({ lineup: await lineupWithBreak(), written: degraded });
            await fell.job.run({ segmentId: 'seg-1' });

            expect(fell.activity.record).toHaveBeenCalledOnce();
            expect(fell.activity.record.mock.calls[0]![0]).toMatchObject({
                module: 'render',
                kind: 'break.degraded',
                data: { wrote: 'deterministic' },
            });

            // The ordinary case. A line per break would bury everything else in the feed.
            const clean = harness({ lineup: await lineupWithBreak() });
            await clean.job.run({ segmentId: 'seg-1' });

            expect(clean.activity.record).not.toHaveBeenCalled();
        });

        it('keeps the records the break was written against', async () => {
            // A script that names the wrong record is only diagnosable next to what it was told.
            const { job, history } = harness({ lineup: await lineupWithBreak() });

            await job.run({ segmentId: 'seg-1' });

            expect(history.recordAll.mock.calls[0]?.[0]).toEqual([
                expect.objectContaining({
                    segmentId: 'seg-1',
                    kind: 'talkbreak',
                    previous: { title: 'Solid Air', artist: 'John Martyn' },
                    next: { title: 'Pink Moon', artist: 'Nick Drake' },
                }),
            ]);
        });

        it('keeps the attempt even when nothing could be written', async () => {
            const { job, history } = harness({
                lineup: await lineupWithBreak(),
                written: {
                    attempts: [{ writer: 'deterministic', outcome: 'declined', reason: 'nothing to say', durationMs: 1 }],
                    reason: 'nothing to say',
                },
            });

            await job.run({ segmentId: 'seg-1' });

            expect(history.recordAll.mock.calls[0]?.[0]).toEqual([
                expect.objectContaining({ writer: 'deterministic', outcome: 'declined', reason: 'nothing to say' }),
            ]);
        });

        it('still writes the break when the record of it cannot be kept', async () => {
            // The whole point of it being best-effort: nothing reads this table to decide anything,
            // so losing a row must cost a row and never the break it was describing.
            const { job, segments, jobs } = harness({ lineup: await lineupWithBreak(), historyThrows: true });

            await job.run({ segmentId: 'seg-1' });

            expect(segments.writeScript).toHaveBeenCalled();
            expect(jobs.send).toHaveBeenCalledWith('render.segment', { segmentId: 'seg-1' });
        });
    });

    it('derives the neighbours from the order as it stands now', async () => {
        // Not from the payload: between planting and writing, an operator can move a line and the
        // director can commit. A stale snapshot is how a station back-announces a record it never
        // played, which is the one mistake a listener can catch it out in.
        const { job, writers } = harness({ lineup: await lineupWithBreak() });

        await job.run({ segmentId: 'seg-1' });

        expect(writers.write).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'talkbreak',
                previous: { title: 'Solid Air', artist: 'John Martyn' },
                next: { title: 'Pink Moon', artist: 'Nick Drake' },
            }),
        );
    });

    // `artists` is the credit as written, for display, and everything a generator resolves carries
    // that whole line in ONE element — so `artists[0]` was the lead only by luck, and this is the
    // shape where the luck runs out. The listener heard "USHER, Lil Jon, Ludacris" read as if it
    // were one artist's name, while the same record arriving from a playlist lost its features
    // instead: the same words spoken differently depending on where the item came from.
    it('names the lead artist, not the credit line a resolved collaboration carries', async () => {
        const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
        lineup.append([
            { pluginId: 'deadair.spotify', externalId: 'yeah', title: 'Yeah!', artists: ['USHER, Lil Jon, Ludacris'], artist: 'USHER' },
            track('Pink Moon', 'Nick Drake'),
        ]);
        lineup.insertSegment('seg-1', 1);
        const { job, writers } = harness({ lineup });

        await job.run({ segmentId: 'seg-1' });

        expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ previous: { title: 'Yeah!', artist: 'USHER' } }));
    });

    describe('a break the running order does not hold', () => {
        /** The same two records, and no break planted between them. */
        const withoutBreak = (): StationLineup => {
            const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
            lineup.append([track('Solid Air', 'John Martyn'), track('Pink Moon', 'Nick Drake')]);
            return lineup;
        };

        const request = (urgency: StoredBreakRequest['urgency']): StoredBreakRequest => ({
            id: 'req-1',
            kind: 'welcome',
            urgency,
            source: 'audience',
            state: 'pending',
        });

        it('writes one that is waiting for its audio before it has a slot', async () => {
            // `interrupt` and `next` are rendered BEFORE they are injected, so having no position is
            // the whole design rather than a race. Deferring one is fatal and silent: nothing ever
            // re-offers a segment the order does not hold, so it sits `planned` until it expires.
            const { job, segments, writers, jobs } = harness({
                lineup: withoutBreak(),
                segment: planned({ kind: 'welcome', requestId: 'req-1' }),
                request: request('next'),
                written: {
                    written: { script: "You're listening to deadair.", label: 'Welcome' },
                    writer: 'deterministic',
                    attempts: [{ writer: 'deterministic', outcome: 'written', durationMs: 1 }],
                },
            });

            await job.run({ segmentId: 'seg-1' });

            // No neighbours at all, which is a shape the writers already answer for.
            expect(writers.write).toHaveBeenCalledWith(expect.not.objectContaining({ previous: expect.anything(), next: expect.anything() }));
            expect(segments.writeScript).toHaveBeenCalledWith('seg-1', {
                script: "You're listening to deadair.",
                label: 'Welcome',
                writer: 'deterministic',
                pads: [],
            });
            expect(jobs.send).toHaveBeenCalledWith('render.segment', { segmentId: 'seg-1' });
        });

        it('reads the request once, not once for the guard and again for the context', async () => {
            const { job, requests } = harness({
                lineup: withoutBreak(),
                segment: planned({ kind: 'welcome', requestId: 'req-1' }),
                request: request('next'),
            });

            await job.run({ segmentId: 'seg-1' });

            expect(requests.findById).toHaveBeenCalledTimes(1);
        });

        it('still defers one whose urgency takes an ordinary slot', async () => {
            // A `soon` or `whenever` request is planted like any other break and written through
            // before its job is sent, so absence from the order really is being early.
            const { job, segments, writers } = harness({
                lineup: withoutBreak(),
                segment: planned({ requestId: 'req-1' }),
                request: request('whenever'),
            });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).not.toHaveBeenCalled();
            expect(segments.claimForWrite).not.toHaveBeenCalled();
        });

        it('still defers a planted break the write-through has not landed for', async () => {
            // The race the guard was built for: the order is persisted through a throttle, so a
            // break can be planted, offered and picked up here before the row anybody can read
            // holds it. Claiming now would write a break that knows neither of its neighbours.
            const { job, segments, writers } = harness({ lineup: withoutBreak() });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).not.toHaveBeenCalled();
            expect(segments.claimForWrite).not.toHaveBeenCalled();
        });
    });

    describe('what the station knows about the records', () => {
        /** The same rotation, with both records catalogued, so there is something to look up. */
        const withIds = (segmentId = 'seg-1'): StationLineup => {
            const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
            lineup.append([track('Solid Air', 'John Martyn', 'track-a'), track('Pink Moon', 'Nick Drake', 'track-b')]);
            lineup.insertSegments([{ segmentId, atIndex: 1 }]);
            return lineup;
        };

        it('puts the facts on both records before anything is asked to write', async () => {
            const { job, writers, enrichment } = harness({
                lineup: withIds(),
                facts: new Map([
                    ['track-a', ['John Martyn was born in New Malden in 1948.']],
                    ['track-b', ['Nick Drake: English singer-songwriter.']],
                ]),
            });

            await job.run({ segmentId: 'seg-1' });

            expect(enrichment.factsForTracks).toHaveBeenCalledWith(['track-a', 'track-b'], expect.any(Number));
            expect(writers.write).toHaveBeenCalledWith(
                expect.objectContaining({
                    previous: {
                        title: 'Solid Air',
                        artist: 'John Martyn',
                        trackId: 'track-a',
                        facts: ['John Martyn was born in New Malden in 1948.'],
                    },
                    next: { title: 'Pink Moon', artist: 'Nick Drake', trackId: 'track-b', facts: ['Nick Drake: English singer-songwriter.'] },
                }),
            );
        });

        it('leaves a record the read had nothing for exactly as it was', async () => {
            const { job, writers } = harness({ lineup: withIds(), facts: new Map([['track-a', ['Born in New Malden in 1948.']]]) });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).toHaveBeenCalledWith(
                expect.objectContaining({ next: { title: 'Pink Moon', artist: 'Nick Drake', trackId: 'track-b' } }),
            );
        });

        it('asks nothing about records the catalog does not hold', async () => {
            // Every record on a station playing straight from a provider's playlist, before
            // anything has been ingested. Two neighbours with no ids is not a query worth making.
            const { job, enrichment } = harness({ lineup: await lineupWithBreak() });

            await job.run({ segmentId: 'seg-1' });

            expect(enrichment.factsForTracks).not.toHaveBeenCalled();
        });

        it('writes the break anyway when the facts cannot be read', async () => {
            // A fact makes a break better and never makes it possible. The floor writer never
            // wanted them, and the model has the two records either way.
            const { job, segments, jobs, writers, logger } = harness({ lineup: withIds(), factsThrow: true });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).toHaveBeenCalledWith(
                expect.not.objectContaining({ previous: expect.objectContaining({ facts: expect.anything() }) }),
            );
            expect(segments.writeScript).toHaveBeenCalled();
            expect(jobs.send).toHaveBeenCalledWith('render.segment', { segmentId: 'seg-1' });
            expect(logger.warn).toHaveBeenCalledOnce();
        });

        it('keeps the facts a writer was shown on the record of the write', async () => {
            // A break that said nothing interesting and a break that was TOLD nothing interesting
            // read identically from the script, and the tables cannot answer it afterwards.
            const { job, history } = harness({ lineup: withIds(), facts: new Map([['track-a', ['Born in New Malden in 1948.']]]) });

            await job.run({ segmentId: 'seg-1' });

            expect(history.recordAll.mock.calls[0]?.[0]?.[0]).toMatchObject({
                previous: { title: 'Solid Air', facts: ['Born in New Malden in 1948.'] },
            });
        });

        it('asks for the same facts on a retry, so a re-offered break is written from the same notes', async () => {
            const first = harness({ lineup: withIds() });
            await first.job.run({ segmentId: 'seg-1' });
            const second = harness({ lineup: withIds() });
            await second.job.run({ segmentId: 'seg-1' });
            const other = harness({ lineup: withIds('seg-2'), segment: planned({ id: 'seg-2' }) });
            await other.job.run({ segmentId: 'seg-2' });

            const rotation = (call: typeof first) => call.enrichment.factsForTracks.mock.calls[0]![1];
            expect(rotation(second)).toBe(rotation(first));
            expect(rotation(other)).not.toBe(rotation(first));
        });
    });

    it('records the reason on the row when the writer has nothing to say', async () => {
        const { job, segments, jobs } = harness({
            lineup: await lineupWithBreak(),
            written: {
                attempts: [{ writer: 'deterministic', outcome: 'declined', reason: 'nothing to say', durationMs: 1 }],
                reason: 'nothing to say',
            },
        });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.markFailed).toHaveBeenCalledWith('seg-1', 'nothing to say', 'writing');
        expect(jobs.send).not.toHaveBeenCalled();
    });

    describe('the forward claim', () => {
        it('stamps the line the words actually named', async () => {
            const lineup = await lineupWithBreak();
            const nextItem = lineup.all()[2]!;
            const { job, segments } = harness({
                lineup,
                written: {
                    written: { script: 'Coming up, Pink Moon.', label: 'Talk break', claimsNext: true },
                    writer: 'deterministic',
                    attempts: [
                        { writer: 'deterministic', outcome: 'written', written: { script: 'Coming up, Pink Moon.', label: 'x' }, durationMs: 1 },
                    ],
                },
            });

            await job.run({ segmentId: 'seg-1' });

            expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.objectContaining({ claimsItemId: nextItem.id }));
        });

        it('stamps nothing when the words promised nothing', async () => {
            // A phrasing whose intro was an optional chunk that got dropped made no promise, and a
            // break that promised nothing must not be thrown away later for one it never made.
            const { job, segments } = harness({ lineup: await lineupWithBreak() });

            await job.run({ segmentId: 'seg-1' });

            expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.not.objectContaining({ claimsItemId: expect.anything() }));
        });

        it('does not promise a record that has been taken out of the order', async () => {
            // The rewrite case, and the reason this job is re-offered at all: the break is being
            // written again precisely because the record it promised will not air, so reading that
            // line anyway would have it promise the same dead record a second time.
            const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
            lineup.append([track('Solid Air', 'John Martyn'), track('Pink Moon', 'Nick Drake')]);
            lineup.insertSegments([{ segmentId: 'seg-1', atIndex: 1 }]);
            lineup.markUnavailable(lineup.all()[2]!.id);
            const { job, writers } = harness({ lineup });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).toHaveBeenCalledWith(expect.not.objectContaining({ next: expect.anything() }));
            expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ previous: expect.objectContaining({ title: 'Solid Air' }) }));
        });

        it('back-announces past a record that never played, to the one that did', async () => {
            const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
            lineup.append([track('Solid Air', 'John Martyn'), track('Pink Moon', 'Nick Drake'), track('River Man', 'Nick Drake')]);
            lineup.insertSegments([{ segmentId: 'seg-1', atIndex: 2 }]);
            lineup.markUnavailable(lineup.all()[1]!.id);
            const { job, writers } = harness({ lineup });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ previous: expect.objectContaining({ title: 'Solid Air' }) }));
        });

        it('does not offer the next record across another segment', async () => {
            // The least trustworthy promise there is: an intervening segment is the region an
            // operator is most likely to edit, and it may itself air or be skipped. Withholding the
            // record is withholding the claim, and the writers already have phrasings for it.
            const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
            lineup.append([track('Solid Air', 'John Martyn'), track('Pink Moon', 'Nick Drake')]);
            lineup.insertSegments([{ segmentId: 'seg-1', atIndex: 1 }]);
            lineup.insertSegments([{ segmentId: 'seg-2', atIndex: 2 }]);
            const { job, writers } = harness({ lineup });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ previous: expect.objectContaining({ title: 'Solid Air' }) }));
            expect(writers.write).toHaveBeenCalledWith(expect.not.objectContaining({ next: expect.anything() }));
        });

        it('still back-announces across another segment, because what played is a fact', async () => {
            const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
            lineup.append([track('Solid Air', 'John Martyn'), track('Pink Moon', 'Nick Drake')]);
            lineup.insertSegments([{ segmentId: 'seg-2', atIndex: 1 }]);
            lineup.insertSegments([{ segmentId: 'seg-1', atIndex: 2 }]);
            const { job, writers } = harness({ lineup });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ previous: expect.objectContaining({ title: 'Solid Air' }) }));
        });
    });

    it('waits rather than writing a break the order does not hold yet', async () => {
        // Measured on the running station: the director writes the order through a throttle, so a
        // break can be planted, offered and picked up here before the row anybody can read holds
        // it. Claiming and writing anyway produced a break that knew neither of its neighbours and,
        // having consumed the claim, was never offered again — which is a station whose every talk
        // break is reduced to saying its own name.
        const { job, segments, writers, jobs } = harness({ lineup: await lineupWithBreak('some-other-break') });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.claimForWrite).not.toHaveBeenCalled();
        expect(writers.write).not.toHaveBeenCalled();
        expect(segments.markFailed).not.toHaveBeenCalled();
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('fails the segment when its running order has gone', async () => {
        const { job, segments } = harness({ lineup: undefined });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.markFailed).toHaveBeenCalledWith('seg-1', expect.stringContaining('gone'), 'writing');
    });

    it('does nothing when the claim was lost', async () => {
        // Another run got there first, or the segment was deleted, or it has already been written.
        // All ordinary races, and all the same answer: the claim is what says whose it is.
        const { job, segments, jobs } = harness({ segment: undefined });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).not.toHaveBeenCalled();
        expect(segments.markFailed).not.toHaveBeenCalled();
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('does not render when the row was claimed between the write and the save', async () => {
        const { job, jobs } = harness({ lineup: await lineupWithBreak(), wrote: false });

        await job.run({ segmentId: 'seg-1' });

        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('warns and stops on a payload with nothing to write', async () => {
        const { job, segments, logger } = harness();

        await job.run({});
        await job.run();

        expect(segments.claimForWrite).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    // What the station remembers of the show it is in the middle of. Every read here is keyed by the
    // BROADCAST rather than by a time window, because "what have we played tonight" is a question
    // about a programme: a window answers it with the tail of the previous show whenever one has
    // just started.
    describe('the memory of this broadcast', () => {
        it('hands the writers what this broadcast played and said, rather than the last few of this kind', async () => {
            const { job, writers, segments, plays, history } = harness({
                lineup: await lineupWithBreak(),
                played: [{ title: 'Yeah!', artist: 'USHER' }],
                said: ['that was the one before'],
            });

            await job.run({ segmentId: 'seg-1' });

            expect(plays.duringBroadcast).toHaveBeenCalledWith('broadcast-1', expect.any(Number));
            expect(history.spokenDuring).toHaveBeenCalledWith('broadcast-1', expect.any(Number));
            // The per-kind read is what this REPLACES, so it must not also happen: two sources of
            // "what did I say" is two lists that can disagree.
            expect(segments.recentScripts).not.toHaveBeenCalled();

            expect(writers.write).toHaveBeenCalledWith(
                expect.objectContaining({ played: [{ title: 'Yeah!', artist: 'USHER' }], recent: ['that was the one before'] }),
            );
        });

        it('leaves the played list off entirely when the broadcast has aired nothing yet', async () => {
            const { job, writers } = harness({ lineup: await lineupWithBreak(), played: [] });

            await job.run({ segmentId: 'seg-1' });

            // Absent rather than empty, which is the rule everywhere in this tree: a prompt renders
            // the block on what the moment HOLDS, and an empty heading is a heading with nothing
            // under it.
            expect(writers.write).toHaveBeenCalledWith(expect.not.objectContaining({ played: expect.anything() }));
        });

        // The fallback is not a nicety: handing an empty `recent` would quietly disarm the
        // spent-signature rule, and a writer repeating a catchphrase because nothing told it not to
        // is the failure `characterFault` exists for.
        it('falls back to the per-kind scripts when no broadcast is on', async () => {
            const { job, writers, segments, plays, history } = harness({
                lineup: await lineupWithBreak(),
                broadcastId: undefined,
            });

            await job.run({ segmentId: 'seg-1' });

            expect(segments.recentScripts).toHaveBeenCalledWith('talkbreak', expect.any(Number));
            expect(plays.duringBroadcast).not.toHaveBeenCalled();
            expect(history.spokenDuring).not.toHaveBeenCalled();

            expect(writers.write).toHaveBeenCalledWith(expect.not.objectContaining({ played: expect.anything() }));
        });

        // Memory makes a break better and never makes it possible, which is the same trade the facts
        // one file over already make.
        it('still writes the break, on the per-kind scripts, when the history read fails', async () => {
            const { job, writers, segments, logger } = harness({ lineup: await lineupWithBreak(), spokenThrows: true });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).toHaveBeenCalled();
            expect(segments.recentScripts).toHaveBeenCalledWith('talkbreak', expect.any(Number));
            expect(logger.warn).toHaveBeenCalled();
        });
    });
});

// The floor's own half of the soundboard. A station with no model still has a rack, and this is what
// reaches it — a sting after a phrasing an operator typed, every few breaks.
//
// The line it must not cross is the one the whole prompt is built around: a model shown the rack and
// choosing not to reach for it has made a judgement about its own sentence, and appending a sound to
// words somebody else shaped is two rules that disagree.
describe('WriteBreakJob putting a pad in by itself', () => {
    const withBoard = { key: 'wisecrack', id: 'p-1', label: 'Wisecrack', kind: 'host', style: 'dry', active: true, soundboard: 'wisecrack' };
    const rack = [{ id: 'pad-1', board: 'wisecrack', name: 'rimshot', label: 'Rimshot', audioChecksum: 'sum', audioExt: 'mp3', source: 'library', state: 'active' }];

    it('adds a sting to a break the floor wrote, once one is due', async () => {
        const { job, segments } = harness({ lineup: await lineupWithBreak(), persona: withBoard as never, pads: rack as never, breaksSincePad: 4 });

        await job.run({ segmentId: 'seg-1' });

        // At the end, because a phrasing is a sentence an operator typed and nothing here knows where
        // its beat falls. After the words is a sting; inside them is guessing at comic timing.
        expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.objectContaining({ script: 'talking [sfx:rimshot]' }));
    });

    it('resolves and rests what it added, so the rotation counts it like any other hit', async () => {
        const { job, segments, pads } = harness({ lineup: await lineupWithBreak(), persona: withBoard as never, pads: rack as never, breaksSincePad: 4 });

        await job.run({ segmentId: 'seg-1' });

        expect(pads.markUsed).toHaveBeenCalledWith('pad-1');
        expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.objectContaining({ pads: [{ name: 'rimshot', padId: 'pad-1' }] }));
    });

    it('waits when the last one was too recent', async () => {
        const { job, segments } = harness({ lineup: await lineupWithBreak(), persona: withBoard as never, pads: rack as never, breaksSincePad: 2 });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.objectContaining({ script: 'talking', pads: [] }));
    });

    it('leaves a break the MODEL wrote exactly as the model wrote it', async () => {
        // The line. A character that was shown the rack and said nothing has decided; the station
        // does not get to append a punchline to somebody else's sentence.
        const { job, segments } = harness({ lineup: await lineupWithBreak(), persona: withBoard as never, pads: rack as never, breaksSincePad: 40, writer: 'a-model' });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.objectContaining({ script: 'talking', pads: [] }));
    });

    it('never puts one in a BULLETIN, whatever the character has to hand', async () => {
        // The veto `NEWS_SHAPE.allowsPads: false` puts on the model's offer, re-expressed for the
        // floor — which makes no offer and would otherwise just append. It shipped without this and
        // a bulletin went out ending "Then, UFO. [sfx:rimshot]", twice, which is the exact failure
        // that flag exists to prevent arriving through the one door it does not cover.
        const { job, segments } = harness({
            lineup: await lineupWithBreak(),
            segment: { id: 'seg-1', kind: 'news', state: 'planned', label: 'News', source: 'render', pads: [] } as never,
            persona: withBoard as never,
            pads: rack as never,
            breaksSincePad: 40,
        });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.objectContaining({ script: 'talking', pads: [] }));
    });

    it('says nothing for a character with no board, however overdue it is', async () => {
        const { job, segments } = harness({ lineup: await lineupWithBreak(), pads: rack as never, breaksSincePad: 40 });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.objectContaining({ script: 'talking' }));
    });

    it('is switched off by the setting, and reads it as the STRING a config layer actually holds', async () => {
        // `config.get(key, false)` answers `'false'`, which is truthy: a switch written that way can
        // be turned on and never back off, in silence. Handing a real boolean here would pass either
        // way and prove nothing.
        const { job, segments } = harness({
            lineup: await lineupWithBreak(),
            persona: withBoard as never,
            pads: rack as never,
            breaksSincePad: 40,
            settings: { 'render.pads': 'false' },
        });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.objectContaining({ script: 'talking' }));
    });

    it('is switched off by a spacing of zero, which leaves a model free to reach for one', async () => {
        const { job, segments } = harness({
            lineup: await lineupWithBreak(),
            persona: withBoard as never,
            pads: rack as never,
            breaksSincePad: 40,
            settings: { 'render.padEveryBreaks': '0' },
        });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.objectContaining({ script: 'talking' }));
    });
});
