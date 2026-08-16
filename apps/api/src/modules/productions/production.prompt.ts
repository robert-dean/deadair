/**
 * What the station asks a model for when it is making a production, and what it will accept back.
 *
 * Two prompts, and the split between them is the whole design. The OUTLINE decides content and shape
 * once; each BEAT is then written on its own, knowing what it owes and nothing about the future.
 *
 * ## A beat is never shown the beats after it
 *
 * The obvious design hands each beat the whole outline and lets it work out where it is. This does
 * not, for two reasons that both cost something real. Context: on a host whose window spilling VRAM
 * drops it to a couple of tokens a second, sending the whole programme with every beat is the
 * difference between a production and an evening. And drift: the moment one beat is re-drafted,
 * every later beat has been told something that is no longer true.
 *
 * So a beat gets a MAP — the beat list as titles, with its own marked and the ones behind it marked
 * written — plus the verbatim tail of the beat before it, plus what it was told to plant and land.
 * That is enough to be part of a shape, and it is a fixed cost per beat rather than a growing one.
 *
 * ## The hand-off is verbatim, and that is what makes it sound continuous
 *
 * Not a summary of the previous beat: its actual last words. A model handed "the previous beat
 * discussed the price of the machine" writes an introduction to a topic; one handed the sentence that
 * ended the last beat carries on from it. This is v1's `tailTurns`, and with one voice it is
 * continuity where with a cast it is a hand-off — the same mechanism either way, which is why the
 * shape does not change when the cast grows.
 *
 * ## Timing is stated and never asked for
 *
 * Every beat is told about how many words it has, because that number is arithmetic
 * (`production.plan.ts`) and a model asked to decide it produces one beat per item — which is how
 * one story in a ten-minute show came to be asked for 1300 spoken words.
 */

import type { LlmMessage } from '@deadair/plugin-sdk';
import type { Persona } from '#modules/personas/persona.js';
import { personaLines } from '#modules/personas/persona.sheet.js';
import type { OutlineBeat, ProductionOutline } from './production.js';

/** How many words of the previous beat are handed over as the run-in. */
export const TAIL_WORDS = 40;

/** What the outline pass is working from. */
export interface OutlineRequest {
    kind: string;
    title: string;
    /** What the operator asked for, in their own words. */
    brief?: string;
    /** How many beats the arithmetic decided on. The model fills them; it does not choose how many. */
    beats: number;
    /** About how many words each beat gets, for the model's sense of pace. */
    wordsPerBeat: number;
    /** Anything the production was handed to cover, in order. Indexes into this are what a beat names. */
    items?: readonly string[];
    persona?: Persona;
    station?: string;
}

/** What one beat is written from. */
export interface BeatRequest {
    kind: string;
    title: string;
    brief?: string;
    /** Where this beat comes, from 0. */
    ordinal: number;
    /** About how many spoken words it should be. */
    words: number;
    /** The whole outline, for the map. A beat sees titles, never the text of what is coming. */
    outline?: ProductionOutline;
    /** This beat's own assignment out of that outline. */
    beat?: OutlineBeat;
    /** The last few words of the beat before, verbatim. Absent for the first beat. */
    runIn?: string;
    /** The items this beat covers, already resolved from its indexes. */
    items?: readonly string[];
    persona?: Persona;
    station?: string;
    /** What was wrong with the previous attempt, for the one re-draft a beat gets. */
    correction?: string;
}

/**
 * Ask for the shape of a production.
 *
 * The beat COUNT is stated rather than requested, which is the load-bearing half. Everything else
 * here is content: what each beat is about, what it plants, and what it lands.
 */
export function outlinePrompt(request: OutlineRequest): LlmMessage[] {
    const system = [
        `You plan a ${request.kind} for a radio station. You decide what it is about; you do not decide how long it is.`,
        '',
        ...(request.persona === undefined ? [] : [...personaLines(request.persona), '']),
        'Rules:',
        `- Plan exactly ${request.beats} beats. Not more, not fewer. Each one runs about ${request.wordsPerBeat} spoken words.`,
        '- A beat is a single movement of the programme: one idea, developed. It is not a heading and not a bullet point.',
        '- Give the whole thing a throughline: the one thing it is really about.',
        // Setup and payoff are what make this a programme rather than a sequence, and they are the
        // only way a beat can know about a beat it will never see.
        '- Where it helps, plant something in one beat for a later one to land. Say what is planted and which beat lands it.',
        '- Runners are threads that come back through the programme. Two or three at most, and only if they are actually funny or useful.',
        '- Do not write any of the script. This is a plan.',
        '',
        'Answer with JSON only, in this shape:',
        '{"throughline": "...", "runners": ["..."], "beats": [{"title": "...", "angle": "...", "itemIndexes": [0], "setup": "...", "payoff": "..."}]}',
        'Every field except "title" is optional. Use "itemIndexes" only for items you were actually given.',
    ].join('\n');

    const user = [
        `The programme is called "${request.title}".`,
        ...(request.brief === undefined ? [] : ['', `What was asked for: ${request.brief}`]),
        ...(request.station === undefined ? [] : ['', `It goes out on ${request.station}.`]),
        ...(request.items === undefined || request.items.length === 0
            ? ['', 'You have been given no source material, so the content is yours to invent. Keep it to what you actually know.']
            : ['', 'Cover these, by index:', ...request.items.map((item, index) => `${index}. ${item}`)]),
    ].join('\n');

    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

/**
 * Ask for one beat.
 *
 * The user turn is this beat's moment; the system turn is the standing job, which is the same split
 * `break.prompt.ts` uses and for the same reason.
 */
export function beatPrompt(request: BeatRequest): LlmMessage[] {
    const opening = request.ordinal === 0;

    const system = [
        `You write one beat of a ${request.kind} for a radio station. It is read aloud exactly as you write it.`,
        '',
        ...(request.persona === undefined ? [] : [...personaLines(request.persona), '']),
        'Rules:',
        `- Write about ${request.words} spoken words. This one number is not yours to change.`,
        '- Continuous spoken prose. No headings, no bullet points, no stage directions, no speaker labels, no markdown.',
        // The failure this catches is a production that sounds like several short programmes played
        // back to back, and it is the single most common thing a beat gets wrong.
        opening
            ? '- This is the OPENING beat. Set the programme up and get into it.'
            : '- This beat is in the MIDDLE of the programme. Do not greet anybody, do not introduce the programme, and do not re-state what it is about. Carry on from where the last beat left off.',
        '- Make the beat about one thing and develop it. Covering less, properly, beats covering more.',
        '- Say only what you actually know. Do not invent names, dates, figures or quotations.',
        '- Do not end by summarising what you just said.',
    ].join('\n');

    const parts: string[] = [`The programme is called "${request.title}".`];
    if (request.brief !== undefined) parts.push(`What was asked for: ${request.brief}`);
    if (request.outline?.throughline !== undefined) parts.push(`What it is really about: ${request.outline.throughline}`);

    // The map: every beat as a title, with this one marked. Titles only — a beat that could read the
    // text of the beats after it would be writing against a plan that changes under it.
    if (request.outline !== undefined && request.outline.beats.length > 0) {
        parts.push(
            ['The whole programme, beat by beat:', ...request.outline.beats.map((beat, index) => mapLine(beat, index, request.ordinal))].join('\n'),
        );
    }

    if (request.outline !== undefined && request.outline.runners.length > 0) {
        parts.push(['Threads that run through the programme, if one fits here:', ...request.outline.runners.map(runner => `- ${runner}`)].join('\n'));
    }

    if (request.beat !== undefined) {
        const brief = beatBrief(request.beat);
        if (brief.length > 0) parts.push(brief.join('\n'));
    }

    if (request.items !== undefined && request.items.length > 0) {
        parts.push(['What this beat covers:', ...request.items.map(item => `- ${item}`)].join('\n'));
    }

    // Verbatim, and last before the instruction, so it is the freshest thing in the model's context
    // when it starts writing. A summary here produces an introduction; the actual words produce a
    // continuation.
    if (request.runIn !== undefined && request.runIn.trim().length > 0) {
        parts.push(['The programme has just said this. Carry straight on from it:', `"...${request.runIn.trim()}"`].join('\n'));
    }

    parts.push(`Write beat ${request.ordinal + 1}${request.beat === undefined ? '' : `, "${request.beat.title}"`}, in about ${request.words} words.`);

    if (request.correction !== undefined) parts.push(request.correction);

    return [
        { role: 'system', content: system },
        { role: 'user', content: parts.join('\n\n') },
    ];
}

/**
 * The run-in handed to the next beat: the last words of this one, verbatim.
 *
 * Taken from the END rather than the start, and whole words rather than characters, so the next beat
 * is never handed half a word to continue from.
 */
export function runInFrom(script: string, words = TAIL_WORDS): string {
    const all = script.trim().split(/\s+/).filter(Boolean);
    return all.slice(Math.max(0, all.length - words)).join(' ');
}

/** One line of the beat map: what it is, and whether it is done, current, or still to come. */
function mapLine(beat: OutlineBeat, index: number, current: number): string {
    const marker = index === current ? '>>' : '  ';
    const when = index < current ? ' (already written)' : index === current ? ' (WRITE THIS ONE)' : '';
    return `${marker} ${index + 1}. ${beat.title}${when}`;
}

/** What this beat owes: its angle, and any setup or payoff the outline gave it. */
export function beatBrief(beat: OutlineBeat): string[] {
    const lines: string[] = [];
    if (beat.angle !== undefined) lines.push(`The angle for this beat: ${beat.angle}`);
    if (beat.payoff !== undefined) lines.push(`Land this callback to something set up earlier: ${beat.payoff}`);
    // "Drop it in naturally" is doing real work: told to plant something, a model announces that it
    // is planting something.
    if (beat.setup !== undefined) lines.push(`Plant this here for a later beat to pay off, without underlining it: ${beat.setup}`);
    return lines;
}
