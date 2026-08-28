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

/** How many proposals one pass over one character is asked for. */
export const MAX_PROPOSALS = 3;

/** How long a proposed telling may be, matching the contract and the column's own check. */
export const MAX_STORY_CHARS = 4000;

/** How long a proposed detail may be, likewise. */
export const MAX_DETAIL_CHARS = 1000;

/** How long a handle may be. */
export const MAX_TITLE_CHARS = 200;

/** One proposal, in whichever of the two shapes it took. */
export type StoryProposal =
    | { kind: 'story'; title: string; story: string; source?: string }
    /** `title` names which of the character's existing stories this belongs to. */
    | { kind: 'detail'; title: string; detail: string; source?: string };

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
export function storyPrompt(subject: StorySubject, existing: readonly ExistingStory[], limit = MAX_PROPOSALS): LlmMessage[] {
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
                'There are two kinds of answer:',
                '- "story": something new that happened to this presenter. Give it a short handle and the telling itself.',
                '- "detail": one more thing they remember about a story they already have. Name that story by its exact handle.',
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
                // rule above still permits that. See `docs/todo/tool-plugins.md`.
                '- This holds for anything you looked up as well. A tool result is a fact about the world, and a story is fiction about one presenter: use what you find to choose what they might have been listening to, never to say what an artist did. If a story would be worse without the thing you looked up, it is the wrong story.',
                '- Nothing famous happens to them. No celebrity, no scandal, no disaster, no illness, no politics. Small things: a room, a caller, a tape, a night nobody else remembers.',
                '- Write it as a SCRIPT, out loud, in their own voice, with an ending. The station reads it exactly as you wrote it when no model is available.',
                '- Two or three sentences. A story nobody can get to the end of is not one.',
                '- Prefer adding a detail to a story they already have over inventing a new one. A presenter with a past has a few stories they keep filling in, not a dozen they mention once.',
                '- Never repeat a story or a detail they already have below, in any wording.',
                '- The handle is never said out loud. It is how the station lists them.',
                '- If nothing worth remembering comes to you, answer with an empty list. That is a normal answer.',
                '',
                'Answer with JSON only, in this shape:',
                '{"proposals":[{"kind":"story","title":"...","story":"...","source":"..."},{"kind":"detail","title":"...","detail":"...","source":"..."}]}',
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
                `Give at most ${limit}.`,
            ].join('\n'),
        },
    ];
}

/** One existing story, as the prompt shows it: the handle it must be named by, and what it holds. */
function describe(story: ExistingStory): string {
    return [`- "${story.title}": ${story.story}`, ...story.details.map(detail => `  · ${detail}`)].join('\n');
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
export function readProposals(answer: string, existing: readonly ExistingStory[], limit = MAX_PROPOSALS): StoryProposal[] {
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

        if (kind === 'story' && story !== undefined && story.length <= MAX_STORY_CHARS) {
            // A new story under a handle this character already uses is the model editing one it was
            // shown, which is what the detail shape is for.
            if (byTitle.has(title.toLowerCase()) || held.has(story.toLowerCase())) continue;
            if (!take(seen, `story:${title.toLowerCase()}`)) continue;

            out.push({ kind: 'story', title, story, ...(source === undefined ? {} : { source }) });
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
function parseAnswer(answer: string): { kind?: unknown; title?: unknown; story?: unknown; detail?: unknown; source?: unknown }[] | undefined {
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
