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
import type { CastMember } from './production.cast.js';
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
    station?: string;
    /**
     * Who is on the programme and which of them has each beat, already decided.
     *
     * Stated rather than asked for, exactly as the beat count is. The outline's job is to plan
     * CONTENT that fits the person who has to say it — a caller's beat is something a listener would
     * ring in about, and the host's is a question or an answer to one — and it cannot do that
     * without being told. What it must not do is choose, which is why there is no `lead` in the
     * shape it answers with any more.
     */
    speakers?: readonly { ordinal: number; who: CastMember }[];
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
    /**
     * Signature phrases this production has already used, so this beat does not use them again.
     *
     * **The half of the sheet a beat could never see, and the single worst thing measured on the
     * first live run**: "I said what I said" appeared in 23 of 24 beats, and the presenter's
     * background in 6. The cause is structural rather than a bad model — the persona sheet goes into
     * EVERY beat's system turn, catchphrases and all, and each beat dutifully used one because
     * nothing told it the last twenty had.
     *
     * It is the same mechanism `break.prompt.ts` already runs between breaks, applied inside one
     * programme, and it works the same way: name what is spent and invite a new one, because a model
     * told only what it may not say reaches for the nearest other thing the sheet gave it.
     */
    spent?: readonly string[];
}

/**
 * Ask for the shape of a production.
 *
 * The beat COUNT is stated rather than requested, which is the load-bearing half. Everything else
 * here is content: what each beat is about, what it plants, and what it lands.
 *
 * ## The presenter is deliberately NOT here
 *
 * The outline decides what the programme is about; the beats decide who is saying it. That split is
 * the same one the personas design already draws when it says a character's `music` line is the only
 * part that reaches what the station PLAYS — what a presenter sounds like has nothing to do with
 * what the programme is about.
 *
 * It is also measured. Handed the sheet, the outline pass planned the presenter's tics as structure:
 * it came back with runners of "recurring self-humorous firing anecdotes" and "the 'Oh wow, Yikes!'
 * dramatic lead-in before each explanation", and a beat whose payoff was "I keep this joke running
 * until I say 'I said what I said' later". That is the catchphrase repetition of the previous run
 * promoted from an accident to a plan — and it would have fought the spent-phrase rule in every beat
 * below, because one of them was telling the model to repeat itself and the other was telling it not
 * to.
 */
export function outlinePrompt(request: OutlineRequest): LlmMessage[] {
    const system = [
        `You plan a ${request.kind} for a radio station. You decide what it is about; you do not decide how long it is.`,
        '',
        'Rules:',
        `- Plan exactly ${request.beats} beats. Not more, not fewer. Each one runs about ${request.wordsPerBeat} spoken words.`,
        '- A beat is a single movement of the programme: one idea, developed. It is not a heading and not a bullet point.',
        '- Give the whole thing a throughline: the one thing it is really about.',
        // Setup and payoff are what make this a programme rather than a sequence, and they are the
        // only way a beat can know about a beat it will never see.
        '- Where it helps, plant something in one beat for a later one to land. Say what is planted and which beat lands it.',
        // Named narrowly on purpose. Asked for "threads", a model offers the presenter's verbal tics —
        // a catchphrase to repeat, a stock exclamation before every explanation — which is a plan to
        // be repetitive rather than a plan for a programme.
        '- Runners are threads of SUBJECT that come back through the programme: an idea, a question, a running argument. Two or three at most. They are never a phrase to repeat, a catchphrase, or a way of speaking.',
        '- Do not write any of the script. This is a plan.',
        ...(dialogueRules(request.speakers) ?? []),
        '',
        'Answer with JSON only, in this shape:',
        '{"throughline": "...", "runners": ["..."], "beats": [{"title": "...", "angle": "...", "itemIndexes": [0], "setup": "...", "payoff": "..."}]}',
        'Every field except "title" is optional. Use "itemIndexes" only for items you were actually given.',
        // Said in as many words, because a model handed a cast and a JSON shape will add a field to
        // the shape to hold it. Who speaks is already decided and a beat that named somebody else
        // would be drafted as one character and spoken in another's voice.
        ...(request.speakers === undefined || request.speakers.length === 0 ? [] : ['Do not add a field for who speaks. That is already decided.']),
    ].join('\n');

    const user = [
        `The programme is called "${request.title}".`,
        ...(request.brief === undefined ? [] : ['', `What was asked for: ${request.brief}`]),
        ...(request.station === undefined ? [] : ['', `It goes out on ${request.station}.`]),
        ...speakerLines(request.speakers),
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
        ...(request.persona === undefined
            ? []
            : [
                  ...personaLines(request.persona),
                  '',
                  // The single most important line in this prompt, and it took a live 24-beat run to
                  // find. A persona sheet is written in units of BREAKS — "about once a break",
                  // "roughly every twenty minutes" — because that is what a station normally asks it
                  // for. A beat is not a break: it is one movement of a programme with twenty-odd of
                  // them. Read per beat, "once a break" becomes twenty-four times, which is exactly
                  // what happened — the presenter's catchphrase appeared in 23 of 24 beats and their
                  // own history in 6.
                  'One more thing about the character above. What follows is ONE programme, not one break: you are already part way through it and you will be speaking for a while yet. ' +
                      'Where that description rations something — a signature phrase, an admission about yourself, a piece of your own history — the ration is for the WHOLE programme rather than for this beat. ' +
                      'Assume the other beats have used most of it already.',
                  '',
              ]),
        'Rules:',
        `- Write about ${request.words} spoken words. This one number is not yours to change.`,
        '- Continuous spoken prose. No headings, no bullet points, no stage directions, no speaker labels, no markdown.',
        // The failure this catches is a production that sounds like several short programmes played
        // back to back, and it is the single most common thing a beat gets wrong.
        opening
            ? '- This is the OPENING beat. Set the programme up and get into it.'
            : '- This beat is in the MIDDLE of the programme. Do not greet anybody, do not introduce the programme, and do not re-state what it is about. Carry on from where the last beat left off.',
        // The other half of the repetition problem. Spent catchphrases are handled per beat in the
        // user turn; this covers the BACKGROUND, which is not a phrase and so cannot be detected as
        // one — a presenter who has been fired from three stations mentioned it in six of
        // twenty-four beats, because the sheet offers it every time and only the first beat has any
        // reason to use it.
        ...(opening
            ? []
            : [
                  '- You have already introduced yourself. Do not say your own name, your history or your credentials again; this audience has been listening for a while.',
              ]),
        '- Make the beat about one thing and develop it. Covering less, properly, beats covering more.',
        // The general version of this rule ("do not invent names, dates, figures") was in place for
        // the first live runs and did not hold: one came back with a lab in the wrong city, a decade
        // that had not happened yet, a part count off the assembly line and a spec that does not
        // exist. A model reaches for a specific because a specific sounds like knowledge, so the
        // rule has to name the swap and give it somewhere to go instead.
        '- Where you are not certain of a detail, say the general thing instead of inventing a specific one. "A factory in Japan" is better than the wrong city; "not many" is better than a number you made up. A vague sentence that is true is worth more than a precise one that is not.',
        "- Never invent a place, a date, a price, a quantity, a chart position, a technical specification, or words in somebody's mouth. If a sentence only works with one of those in it, write a different sentence.",
        '- This goes out on the radio as fact. Nobody listening can check it, and nothing later can take it back.',
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
        parts.push(
            [
                'The programme has just said this:',
                `"...${request.runIn.trim()}"`,
                // Measured: without this, beats opened by reciting the run-in word for word before
                // saying anything of their own. Handed a quotation, a model treats it as something
                // to pick up and read rather than as a position to start from.
                'Those words have already been spoken. Do NOT repeat them, quote them, or rephrase them. Start the next sentence after them.',
            ].join('\n'),
        );
    }

    // Named, and a new one invited rather than only forbidden. Told only what it may not say, a
    // model reaches for the nearest other thing the sheet gave it — which is the failure one rule
    // over, and is exactly how the same block in `break.prompt.ts` is worded.
    if (request.spent !== undefined && request.spent.length > 0) {
        parts.push(
            `You have already said ${request.spent.map(phrase => `"${phrase}"`).join(' and ')} earlier in this programme. ` +
                `Do not use ${request.spent.length === 1 ? 'it' : 'any of them'} again. Say it a different way, or make up a new line of your own.`,
        );
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

/**
 * The extra rules a conversation needs, or nothing at all for one voice.
 *
 * Nothing rather than a paragraph explaining that there is nobody on the phone, which is the same
 * bargain every prompt in this tree keeps: a model is told about the facility it has, and a
 * monologue's outline prompt stays byte-identical to the one built before callers existed.
 */
function dialogueRules(speakers: OutlineRequest['speakers']): string[] | undefined {
    if (speakers === undefined || speakers.length === 0) return undefined;

    return [
        '- This is a conversation, not a talk. Each beat is one TURN by the person named against it below.',
        "- A caller's turn is what somebody who rang the station would actually say: their own experience, their own opinion, their own question.",
        "- The host's turns are the ones that introduce them, ask them something, and answer what they said.",
        '- Plan the turns so each one has something to react to. A turn that could have been said first is a turn nobody is listening to.',
    ];
}

/** Who has which beat, as the user turn states it. */
function speakerLines(speakers: OutlineRequest['speakers']): string[] {
    if (speakers === undefined || speakers.length === 0) return [];

    return [
        '',
        'Who speaks each beat, which is already decided:',
        ...speakers.map(({ ordinal, who }) => `${ordinal + 1}. ${describe(who)}`),
    ];
}

/** One cast member as the prompt names them: what they are, and what they are called. */
function describe(who: CastMember): string {
    const role = who.role === 'caller' ? 'a listener who has phoned in' : 'the presenter';
    return who.name === undefined ? role : `${who.name}, ${role}`;
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
