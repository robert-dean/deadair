/**
 * What the station asks a model to remember about its own presenter's life, and what it will accept
 * back.
 *
 * Pure functions and no I/O, so every decision here is testable without a model. The binding that
 * uses them is `persona.story.pass.service.ts`.
 *
 * ## This is the one pass that INVENTS, and everything about it follows from that
 *
 * `persona.notes.model.ts` next door is built around never writing anything new: a note has to quote
 * a line the station broadcast, and one whose quote does not exist is thrown away. That check is the
 * whole of why a `said` note can go active unattended.
 *
 * There is no equivalent here and there cannot be. A story is fiction about a character — nothing
 * entails it, no corpus contains it, and a verifier asked whether it is true has no question to
 * answer. So the safeguard is the other one this codebase already uses where nothing can be checked:
 * **everything this writes arrives `suggested`**, and the operator is the check. That is the `trait`
 * note's rule and `pronunciation.gloss.ts`'s below its confidence bar.
 *
 * ## The fence is about what a story may CLAIM, not about what it may mention
 *
 * A story may name a record or an artist this station actually plays — that is most of what makes
 * one worth having, and it is what grounds "the night I first heard this" in a library rather than
 * in a model's training data. What it may never do is state a FACT about them: a gig, a date, a
 * venue, an incident, anything a listener could look up and find false. The character's own
 * experience of a record is unfalsifiable and is the whole of what is on offer here; everything
 * around it is the station making things up about real people in the voice it uses for true things.
 *
 * The seeded stories in `persona.story.defaults.ts` are stricter still and name nobody at all. That
 * is not this rule being applied twice — those go live unattended, and these wait for somebody.
 *
 * ## Two shapes of answer, because a story that grows is the point
 *
 * A pass may propose a new STORY or a DETAIL on one the character already has. The second is the
 * more valuable and the less obvious: it is what makes a character's past accumulate rather than
 * simply lengthen, and it is why a detail is a row of its own that can be turned down without losing
 * the story it was hung on.
 */

import type { LlmMessage } from '@deadair/plugin-sdk';

/** A bit with enough history to summarise, as the recap prompt shows it. */
export interface RunningBit {
    id: string;
    title: string;
    story: string;
    /** What the character actually said, oldest first, so the arc of it is visible. */
    said: readonly string[];
}

/**
 * Ask a model where each of these running bits has got to.
 *
 * Its own turn rather than a fourth shape in {@link storyPrompt}, and the split is the point: that
 * one INVENTS and this one SUMMARISES. Everything the story prompt is fenced by — no claim about a
 * real person, nothing famous, write it as a script — is about material being made up, and none of
 * it applies to a sentence saying what the station already broadcast. Mixing them would put a
 * summariser behind rules for an inventor and invite it to embellish to satisfy them.
 *
 * That difference is also why a recap can be stored without anybody approving it: it is derived
 * from the station's own record rather than inferred about the character, which is the same line
 * `said` and `trait` notes are split on one table over.
 */
export function recapPrompt(bits: readonly RunningBit[]): LlmMessage[] {
    return [
        {
            role: 'system',
            content: [
                'A radio presenter keeps coming back to the same running jokes on air. For each one below, say in ONE sentence where it has got to.',
                '',
                'Rules:',
                '- Summarise only what is there. Do not add a new development, a punchline or a detail nobody said.',
                '- Say what the thing has BECOME over the whole run, not what was said last. "It has gone from a complaint to a running feud with the machine" is useful; repeating the last line is not.',
                '- Write it for the presenter to read as a reminder, not for a listener. It is never said on air.',
                '- One sentence each. If a bit has not actually gone anywhere, say that.',
                '',
                'Answer with JSON only, in this shape:',
                '{"recaps":[{"title":"...","recap":"..."}]}',
            ].join('\n'),
        },
        {
            role: 'user',
            content: bits.map(bit => [`"${bit.title}": ${bit.story}`, ...bit.said.map(said => `  - ${said}`)].join('\n')).join('\n\n'),
        },
    ];
}

/** The recaps out of a model's answer, matched to the bits they were asked about. */
export function readRecaps(answer: string, bits: readonly RunningBit[]): { id: string; recap: string; tellings: number }[] {
    const parsed = parseRecapAnswer(answer);
    if (parsed === undefined) return [];

    const byTitle = new Map(bits.map(bit => [bit.title.trim().toLowerCase(), bit]));
    const out: { id: string; recap: string; tellings: number }[] = [];
    const seen = new Set<string>();

    for (const entry of parsed) {
        const title = text(entry.title);
        const recap = text(entry.recap)?.slice(0, MAX_RECAP_CHARS);
        if (title === undefined || recap === undefined) continue;

        const bit = byTitle.get(title.toLowerCase());
        // A recap for a bit nobody asked about is a model answering a question it was not put, and
        // there is no story to attach it to anyway.
        if (bit === undefined || !take(seen, bit.id)) continue;

        out.push({ id: bit.id, recap, tellings: bit.said.length });
    }

    return out;
}

function parseRecapAnswer(answer: string): { title?: unknown; recap?: unknown }[] | undefined {
    const start = answer.indexOf('{');
    if (start < 0) return undefined;

    try {
        const parsed: unknown = JSON.parse(answer.slice(start, answer.lastIndexOf('}') + 1));
        const list = (parsed as { recaps?: unknown }).recaps;
        return Array.isArray(list) ? (list as { title?: unknown; recap?: unknown }[]) : undefined;
    } catch {
        return undefined;
    }
}

/** How many proposals one pass over one character is asked for. */
export const MAX_PROPOSALS = 3;

/** How long a proposed telling may be, matching the contract and the column's own check. */
export const MAX_STORY_CHARS = 4000;

/** How long a proposed detail may be, likewise. */
export const MAX_DETAIL_CHARS = 1000;

/** How long a handle may be. */
export const MAX_TITLE_CHARS = 200;

/**
 * How long a recap may be.
 *
 * One line, and short on purpose: it is read into a break prompt in place of the tellings it
 * summarises, and a recap longer than those would make the thing it replaces cheaper.
 */
export const MAX_RECAP_CHARS = 500;

/** How many aired tellings a running bit needs before it is worth summarising. */
export const MIN_RECAP_TELLINGS = 3;

/** One proposal, in whichever of the two shapes it took. */
export type StoryProposal =
    | { kind: 'story'; title: string; story: string; source?: string }
    /** `title` names which of the character's existing stories this belongs to. */
    | { kind: 'detail'; title: string; detail: string; source?: string }
    /**
     * The next part of an ARC the character is already telling. `title` names which one.
     *
     * A third shape rather than a detail with a number on it, because the two are not the same
     * claim: a detail is something the story picked up and changes nothing about where it has got
     * to, while a beat is what the character says NEXT. See `persona.story.beat.ts`.
     */
    | { kind: 'beat'; title: string; beat: string; source?: string }
    /**
     * A running thing the character has ALREADY been doing on air, noticed rather than invented.
     *
     * The one proposal here that is not fiction. It carries a `quote` that must literally appear in
     * something the station broadcast, checked the way a `said` note's is — so what is being offered
     * is "you keep coming back to this, shall we make it a thing" rather than a new idea.
     */
    | { kind: 'bit'; title: string; story: string; quote: string; source?: string };

/** Who the model is being asked to remember for, in the words the prompt uses. */
export interface StorySubject {
    label: string;
    /** Completes "You are …" on the persona's own sheet. */
    style: string;
    /** The dialect, so a proposal comes back in the character's own voice rather than in plain English. */
    diction?: readonly string[];
    /** What they talk about, which is what keeps a proposal in the character's own world. */
    quirks?: readonly string[];
    /** Wording that breaks the character, which is as much a fence on a story as on a break. */
    avoid?: readonly string[];
}

/** One story the character already has, as the prompt shows it. */
export interface ExistingStory {
    title: string;
    story: string;
    details: readonly string[];
    /**
     * Whether this one is told in parts, so the pass knows it may propose the next.
     *
     * Only an arc takes a beat, and that is checked here rather than left to the service: a beat
     * proposed onto an anecdote is a row nothing will ever read.
     */
    arc?: boolean;
    /** The parts it already has, in order, so the model writes the NEXT one rather than a variant. */
    beats?: readonly string[];
}

/**
 * The pass's one turn.
 *
 * The rules are all prohibitions except two, and the two exceptions are the ones a model will not
 * infer: write it as a SCRIPT, because the station reads a story out as it stands when no model is
 * available, and prefer a detail on a story that exists, because a shelf of six unrelated anecdotes
 * is a character with a biography rather than one with a past.
 *
 * The instruction to answer with an empty list is load-bearing and is stated as a normal answer, for
 * `distilPrompt`'s reason: a model that believes an empty answer is a wrong answer fills it, and
 * here the filling becomes the character's history.
 */
export function storyPrompt(
    subject: StorySubject,
    existing: readonly ExistingStory[],
    limit = MAX_PROPOSALS,
    corpus: readonly string[] = [],
): LlmMessage[] {
    const sheet = [
        subject.diction && subject.diction.length > 0 ? `How they speak: ${subject.diction.join('; ')}.` : undefined,
        subject.quirks && subject.quirks.length > 0 ? `In character: ${subject.quirks.join('; ')}.` : undefined,
        subject.avoid && subject.avoid.length > 0 ? `Never say: ${subject.avoid.join('; ')}.` : undefined,
    ].filter((line): line is string => line !== undefined);

    return [
        {
            role: 'system',
            content: [
                'You write down things that have happened to a radio presenter, so the station can tell them on air later.',
                '',
                'There are three kinds of answer:',
                '- "story": something new that happened to this presenter. Give it a short handle and the telling itself.',
                '- "detail": one more thing they remember about a story they already have. Name that story by its exact handle.',
                '- "beat": the NEXT part of a story they are already telling in parts. Name that story by its exact handle. Only the ones marked "told in parts" below can take one.',
                '- "bit": a running thing they have ALREADY been doing on air, which nobody has written down yet. Only propose one if you can see it happening in what they actually said, and quote the line you saw it in word for word.',
                '',
                'Rules:',
                // The one that is a correctness rule rather than a taste one, and the only one whose
                // failure a listener cannot tell from the station being wrong.
                "- Nothing you write may be a claim about a real person, band or event. A record can be in the story — heard, played, worn out, requested — but never a gig, a date, a venue, a meeting or anything that happened TO an artist. Their experience of the music, never the music's history.",
                // The same rule again, aimed at the case the one above does not cover in a model's
                // reading of it. It was written for a pass that could only look at this station's
                // own library, where the only way to state something about an artist was to invent
                // it — so "may not claim" and "may not invent" were the same sentence. A pass with a
                // search tool can now find a true thing and put it in a story, and every word of the
                // rule above still permits that. See [tool-plugins](https://github.com/robert-dean/deadair/discussions/44).
                '- This holds for anything you looked up as well. A tool result is a fact about the world, and a story is fiction about one presenter: use what you find to choose what they might have been listening to, never to say what an artist did. If a story would be worse without the thing you looked up, it is the wrong story.',
                '- Nothing famous happens to them. No celebrity, no scandal, no disaster, no illness, no politics. Small things: a room, a caller, a tape, a night nobody else remembers.',
                '- Write it as a SCRIPT, out loud, in their own voice, with an ending. The station reads it exactly as you wrote it when no model is available.',
                '- Two or three sentences. A story nobody can get to the end of is not one.',
                '- Prefer adding a detail to a story they already have over inventing a new one. A presenter with a past has a few stories they keep filling in, not a dozen they mention once.',
                '- Never repeat a story or a detail they already have below, in any wording.',
                '- A beat carries the story ON. It is not a summary and not a variation on a part they already have: it is what they say next, picking up where the last part left off, and it must make sense to somebody who heard that part and nothing else.',
                '- The handle is never said out loud. It is how the station lists them.',
                '- A "bit" is something you SPOTTED, never something you thought of. Its quote must be one of the lines below, copied exactly. If you cannot find one, do not propose a bit.',
                '- If nothing worth remembering comes to you, answer with an empty list. That is a normal answer.',
                '',
                'Answer with JSON only, in this shape:',
                '{"proposals":[{"kind":"story","title":"...","story":"...","source":"..."},{"kind":"detail","title":"...","detail":"...","source":"..."},{"kind":"beat","title":"...","beat":"...","source":"..."},{"kind":"bit","title":"...","story":"...","quote":"...","source":"..."}]}',
                '',
                '"source" is one short phrase saying what gave you the idea — a record this station plays, something in its library. It is for the operator reading your proposal and is never said on air.',
            ].join('\n'),
        },
        {
            role: 'user',
            content: [
                `This is ${subject.label}, who is ${subject.style}.`,
                ...sheet,
                '',
                existing.length === 0
                    ? 'They have no stories yet.'
                    : ['What they already have:', ...existing.map(story => describe(story))].join('\n'),
                '',
                ...(corpus.length === 0 ? [] : ['', 'What they have actually said on air lately:', ...corpus.map(script => `- ${script}`)]),
                '',
                `Give at most ${limit}.`,
            ].join('\n'),
        },
    ];
}

/** One existing story, as the prompt shows it: the handle it must be named by, and what it holds. */
function describe(story: ExistingStory): string {
    return [
        `- "${story.title}"${story.arc === true ? ' (told in parts)' : ''}: ${story.story}`,
        // The parts in order, so a proposed beat carries the story on rather than restating one of
        // them. Numbered because "the next one" is the whole ask.
        ...(story.beats ?? []).map((beat, at) => `  ${at + 1}. ${beat}`),
        ...story.details.map(detail => `  · ${detail}`),
    ].join('\n');
}

/**
 * The proposals out of a model's answer, with everything unusable dropped.
 *
 * `readNotes`' posture: tolerant of the wrapping, strict about the content. What it cannot be strict
 * about is TRUTH — there is nothing to check a story against — so the checks here are the ones that
 * can be made without one: both halves present, inside the column's own bounds, not a duplicate of
 * something this character already holds, and, for a detail, naming a story that actually exists.
 *
 * A detail naming a story the character does not have is dropped rather than promoted to a new
 * story, which is the same call `kindOf` makes one file over: guessing would attach a sentence
 * written as a fragment to a story it was never about.
 */
export function readProposals(
    answer: string,
    existing: readonly ExistingStory[],
    limit = MAX_PROPOSALS,
    corpus: readonly string[] = [],
): StoryProposal[] {
    const parsed = parseAnswer(answer);
    if (parsed === undefined) return [];

    const byTitle = new Map(existing.map(story => [story.title.trim().toLowerCase(), story]));
    const held = new Set(existing.flatMap(story => [story.story.trim().toLowerCase(), ...story.details.map(detail => detail.trim().toLowerCase())]));

    const out: StoryProposal[] = [];
    const seen = new Set<string>();

    for (const entry of parsed) {
        const title = text(entry.title)?.slice(0, MAX_TITLE_CHARS);
        const source = text(entry.source)?.slice(0, 1000);
        if (title === undefined) continue;

        const kind = typeof entry.kind === 'string' ? entry.kind.trim().toLowerCase() : '';
        const story = text(entry.story);
        const detail = text(entry.detail);
        const beat = text(entry.beat);
        const quote = text(entry.quote);

        if (kind === 'bit' && story !== undefined && story.length <= MAX_STORY_CHARS) {
            // A quote that is not literally in what the station said is a model NOTICING something
            // that never happened, which is the one failure this shape exists to make impossible.
            // `readNotes`' check exactly, and for the same reason: the claim is about the corpus
            // rather than about the character, so it can be checked and therefore must be.
            if (quote === undefined || !corpus.some(script => script.includes(quote))) continue;
            if (byTitle.has(title.toLowerCase()) || held.has(story.toLowerCase())) continue;
            if (!take(seen, `story:${title.toLowerCase()}`)) continue;

            out.push({ kind: 'bit', title, story, quote, ...(source === undefined ? {} : { source }) });
        } else if (kind === 'story' && story !== undefined && story.length <= MAX_STORY_CHARS) {
            // A new story under a handle this character already uses is the model editing one it was
            // shown, which is what the detail shape is for.
            if (byTitle.has(title.toLowerCase()) || held.has(story.toLowerCase())) continue;
            if (!take(seen, `story:${title.toLowerCase()}`)) continue;

            out.push({ kind: 'story', title, story, ...(source === undefined ? {} : { source }) });
        } else if (kind === 'beat' && beat !== undefined && beat.length <= MAX_STORY_CHARS) {
            const found = byTitle.get(title.toLowerCase());
            // Only onto an arc, and never a part it already has in those words. A beat on anything
            // else is a row nothing reads; a repeat is the model restating what it was shown.
            if (found === undefined || found.arc !== true) continue;
            if ((found.beats ?? []).some(held => held.trim().toLowerCase() === beat.toLowerCase())) continue;
            if (!take(seen, `beat:${beat.toLowerCase()}`)) continue;

            out.push({ kind: 'beat', title: found.title, beat, ...(source === undefined ? {} : { source }) });
        } else if (kind === 'detail' && detail !== undefined && detail.length <= MAX_DETAIL_CHARS) {
            const found = byTitle.get(title.toLowerCase());
            if (found === undefined || held.has(detail.toLowerCase())) continue;
            if (!take(seen, `detail:${detail.toLowerCase()}`)) continue;

            out.push({ kind: 'detail', title: found.title, detail, ...(source === undefined ? {} : { source }) });
        } else continue;

        if (out.length >= limit) break;
    }

    return out;
}

const take = (seen: Set<string>, key: string): boolean => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
};

/** A model's JSON, however it wrapped it. `parseAnswer`'s twin one file over. */
function parseAnswer(
    answer: string,
): { kind?: unknown; title?: unknown; story?: unknown; detail?: unknown; beat?: unknown; quote?: unknown; source?: unknown }[] | undefined {
    const start = answer.indexOf('{');
    const end = answer.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;

    try {
        const parsed = JSON.parse(answer.slice(start, end + 1)) as { proposals?: unknown };
        return Array.isArray(parsed.proposals) ? (parsed.proposals as { kind?: unknown }[]) : undefined;
    } catch {
        return undefined;
    }
}

const text = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};
