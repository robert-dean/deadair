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

import type { LlmMessage, SpeechCue } from '@deadair/plugin-sdk';
import type { Persona } from '#modules/personas/persona.js';
import { latitudeOf, personaLines } from '#modules/personas/persona.sheet.js';
import type { PersonaNotesForPrompt } from '#modules/personas/persona.note.js';
import type { PersonaStoryForPrompt } from '#modules/personas/persona.story.js';
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
    /** The speaker's own sheet, which is whoever this turn belongs to rather than whoever presents. */
    persona?: Persona;
    /**
     * Who is speaking this turn.
     *
     * Absent for a production with no cast, which is every one the station made before callers: the
     * presenter says all of it and none of the conversation rules below are sent.
     */
    speaker?: CastMember;
    /** Who said the run-in, when it was somebody else. What turns a continuation into an answer. */
    previousSpeaker?: CastMember;
    /**
     * This is the first the listener has heard of this speaker.
     *
     * A caller's first turn is where they are put on air, which is NOT the programme's opening beat
     * — they arrive in the middle of it. It is the one place in a production where a greeting is
     * right, because it is what somebody who has just been put through actually says.
     */
    firstTurn?: boolean;
    station?: string;
    /** What was wrong with the previous attempt, for the one re-draft a beat gets. */
    correction?: string;
    /**
     * The things this speaker can do that are not words, out of what the engine performs.
     *
     * Resolved by the caller from the render side, exactly as `break.prompt.ts` resolves its own:
     * one answer per turn, so the rule the model is shown and the strip its answer goes through
     * cannot disagree about what was on offer. Empty asks for nothing, which is the state of every
     * station whose engine only reads words.
     */
    reactions?: readonly SpeechCue[];
    /**
     * What this character has accumulated: what it has settled into, and what it has said before.
     *
     * The same two halves the break prompt carries and in the same two turns — a trait beside the
     * sheet, because it is who this person IS, and a saying beside the show's memory, because it is
     * what they DID. Resolved and RESTED by the caller, so a turn nobody airs does not spend the
     * next one's lines.
     */
    notebook?: PersonaNotesForPrompt;
    /**
     * One thing that happened to this character, offered rather than requested.
     *
     * A caller's own past, which is the whole reason a phone-in with a roster is worth more than one
     * with a random name each time. Fenced exactly as the break prompt fences one: it happened to
     * YOU, and it is never a fact about a record.
     */
    story?: PersonaStoryForPrompt;
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
    const caller = request.speaker?.role === 'caller';
    // A caller's FIRST turn is the one where they are put on air, which is not the same question as
    // the programme's first beat: they arrive in the middle of it and they do greet, because that is
    // what somebody who has just been put through actually says.
    const answering = request.previousSpeaker !== undefined && request.previousSpeaker.role !== request.speaker?.role;
    const arriving = caller && answering && request.firstTurn === true;

    const system = [
        caller
            ? `You are a listener who has phoned in to a ${request.kind} on a radio station, and you are on the air now. You write your next turn on the call, and it is read aloud exactly as you write it.`
            : `You write one beat of a ${request.kind} for a radio station. It is read aloud exactly as you write it.`,
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
                  ...traitLines(request.notebook),
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
        ...openingRule({ opening, caller, arriving }),
        // The other half of the repetition problem. Spent catchphrases are handled per beat in the
        // user turn; this covers the BACKGROUND, which is not a phrase and so cannot be detected as
        // one — a presenter who has been fired from three stations mentioned it in six of
        // twenty-four beats, because the sheet offers it every time and only the first beat has any
        // reason to use it.
        ...(opening || arriving
            ? []
            : [
                  '- You have already introduced yourself. Do not say your own name, your history or your credentials again; this audience has been listening for a while.',
              ]),
        answering
            ? // The failure a conversation has that a monologue cannot: two people taking turns to
              // read out prepared statements. What makes it a call is that each turn is about the
              // last one.
              '- Answer what was just said to you before you say anything else. Make one point, and leave the other person something to come back on.'
            : '- Make the beat about one thing and develop it. Covering less, properly, beats covering more.',
        // The general version of this rule ("do not invent names, dates, figures") was in place for
        // the first live runs and did not hold: one came back with a lab in the wrong city, a decade
        // that had not happened yet, a part count off the assembly line and a spec that does not
        // exist. A model reaches for a specific because a specific sounds like knowledge, so the
        // rule has to name the swap and give it somewhere to go instead.
        ...groundingRules(request, caller, answering),
        ...reactionRules(request.reactions, caller),
        '- Do not end by summarising what you just said.',
    ].join('\n');

    const parts: string[] = [`The programme is called "${request.title}".`];
    // Who the other person is, which the host in particular cannot do without: putting somebody on
    // air means saying their name, and a presenter who was never told it says "our caller" for a
    // whole programme.
    if (request.previousSpeaker !== undefined && answering) {
        parts.push(
            caller
                ? `You are talking to ${nameOf(request.previousSpeaker)}, who is presenting.`
                : `${nameOf(request.previousSpeaker)} is on the line. Use their name.`,
        );
    }
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

    // What this character has said on this station before tonight, which is the half of a memory
    // that outlives one programme. Offered rather than requested, in the words the break prompt uses
    // and for the reason measured there: handed a list, a model gets through the list.
    const said = (request.notebook?.said ?? []).filter(note => note.trim().length > 0);
    if (said.length > 0) {
        parts.push(
            [
                'Things you have said on this station before, which a regular listener may remember:',
                ...said.map(note => `- ${note}`),
                'These are yours to build on, not a list to get through. Pick one up only if this moment gives you a reason to. You do not have to mention any of them.',
            ].join('\n'),
        );
    }

    if (request.story !== undefined) parts.push(storyLines(request.story));

    // Verbatim, and last before the instruction, so it is the freshest thing in the model's context
    // when it starts writing. A summary here produces an introduction; the actual words produce a
    // continuation.
    if (request.runIn !== undefined && request.runIn.trim().length > 0) {
        parts.push(
            [
                // The same words either way, and a different thing to do with them. Between two
                // beats of one voice the run-in is a POSITION to carry on from; across a change of
                // speaker it is something that was said TO you, which is the whole difference
                // between a programme continuing and a conversation happening.
                answering ? `${nameOf(request.previousSpeaker)} has just said this to you:` : 'The programme has just said this:',
                `"...${request.runIn.trim()}"`,
                // Measured: without this, beats opened by reciting the run-in word for word before
                // saying anything of their own. Handed a quotation, a model treats it as something
                // to pick up and read rather than as a position to start from.
                answering
                    ? 'Those words have already been said out loud. Do NOT repeat them, quote them back, or rephrase them. Answer them.'
                    : 'Those words have already been spoken. Do NOT repeat them, quote them, or rephrase them. Start the next sentence after them.',
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
 * The one thing a speaker can do that is not words, or nothing at all when they cannot.
 *
 * Nothing rather than a rule saying "you may not cough", which would spend a line telling a model
 * about a facility it was never given — the same bargain the break prompt keeps. What differs here
 * is only the invitation: a presenter's cue is a reaction and a caller's is what makes a phone call
 * sound like one, so the sentence asking for it says so.
 */
function reactionRules(reactions: readonly SpeechCue[] | undefined, caller: boolean): string[] {
    if (reactions === undefined || reactions.length === 0) return [];

    const written = reactions.map(cue => `[${cue}]`).join(', ');
    return [
        `- You can do one thing that is not words: ${written}. Write it in square brackets exactly like that, at the point it happens, and it is performed rather than read out. ` +
            (caller
                ? 'At most one in a turn, and only where you would actually have done it. You are on a telephone, not in a studio.'
                : 'At most one in a turn, and only where you would actually have done it. A presenter who laughs at everything is not funny.'),
    ];
}

/**
 * What this speaker may state as true, which is the one rule a caller does not share with the host.
 *
 * ## The station stands behind its presenter and not behind its callers
 *
 * The grounding block underneath every beat exists because a production goes out as FACT: nobody
 * listening can check it and nothing later can take it back. That is exactly right for the station's
 * own voice, and it is the wrong rule for somebody who rang in — a phone-in is somebody's opinion,
 * aired because it is somebody's opinion, and a caller who may only say what they can prove is a
 * caller with no reason to have rung.
 *
 * So a caller whose sheet carries a `latitude` gets a licence instead. It is narrow and says so: it
 * covers what THEY think, and it does not cover a real person, a real event, or anything a listener
 * would take as the station reporting something.
 *
 * ## The other half is on the host, and it is what makes the licence safe
 *
 * A claim nobody answers is a claim the station made. So a host turn that follows a caller is told
 * to move it along rather than confirm it — which is a rule about the HOST's own words and needs no
 * enforcement anywhere else.
 *
 * A caller with no latitude gets the ordinary rules, unchanged. The rung is what asks for the
 * licence; a sheet that never asked for one is a person on the phone who talks like everybody else.
 */
function groundingRules(request: BeatRequest, caller: boolean, answering: boolean): string[] {
    const licensed = caller && latitudeOf(request.persona) !== undefined;

    if (licensed) {
        return [
            "- You may say what you THINK. Your opinions, your theory, what you reckon: that is what you rang up with and the station is not claiming any of it is true.",
            '- It stays yours. Say "I reckon", "I read somewhere", "you ask me" — never state it as something everybody knows.',
            "- Never say a real, named person did something. Never describe a real event as though you were reporting it. Never put words in anybody's mouth.",
            '- Where a detail would make it sound like news rather than like you, leave the detail out.',
        ];
    }

    return [
        '- Where you are not certain of a detail, say the general thing instead of inventing a specific one. "A factory in Japan" is better than the wrong city; "not many" is better than a number you made up. A vague sentence that is true is worth more than a precise one that is not.',
        "- Never invent a place, a date, a price, a quantity, a chart position, a technical specification, or words in somebody's mouth. If a sentence only works with one of those in it, write a different sentence.",
        ...(answering && !caller
            ? // The host's half of the licence above. A claim nobody answers is a claim the station
              // made, and the presenter is the only person on the programme who can say so.
              [
                  "- Your caller may say things you cannot check. Do not confirm one, do not repeat it as fact, and do not argue it down either. Take it as theirs — \"that's you, that is\", \"well, there you go\" — and move the programme on.",
              ]
            : []),
        '- This goes out on the radio as fact. Nobody listening can check it, and nothing later can take it back.',
    ];
}

/**
 * Where this speaker is in the programme, which is not the same question as where the BEAT is.
 *
 * A caller arriving is in the middle of a programme and at the start of their own part in it, and
 * those two facts want opposite instructions. Getting it wrong in either direction is audible: a
 * caller told not to greet anybody is put on air and starts mid-sentence, and one told to open the
 * programme introduces the show they just rang.
 */
function openingRule(where: { opening: boolean; caller: boolean; arriving: boolean }): string[] {
    if (where.arriving) {
        return [
            // "Thanks for calling" is the PRESENTER's line and a model reaches for it anyway, because
            // it is the most common sentence in the room. Measured on the first live call-in, where
            // the caller opened with it. Saying which way round the call went is what stops it.
            '- You have just been put on air. YOU rang THEM: you have been holding on the line and the presenter has just picked you up.',
            '- Say hello in a few words, the way somebody who has been holding actually does, then get straight to what you rang about. Do not thank them for calling you.',
        ];
    }

    if (where.opening) return ['- This is the OPENING beat. Set the programme up and get into it.'];

    return [
        where.caller
            ? '- You are already on the call. Do not say hello again and do not say who you are again. Carry on from what was just said to you.'
            : '- This beat is in the MIDDLE of the programme. Do not greet anybody, do not introduce the programme, and do not re-state what it is about. Carry on from where the last beat left off.',
    ];
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

/**
 * Who this character has become, in the system turn beside the sheet.
 *
 * `break.prompt.ts`' own block, in its own register: named as things the character HAS DONE rather
 * than as instructions, because the sheet above it is already a list of rules and a second
 * imperative list competes with the first.
 */
function traitLines(notes: PersonaNotesForPrompt | undefined): string[] {
    const traits = (notes?.trait ?? []).map(trait => trait.trim()).filter(trait => trait.length > 0);
    if (traits.length === 0) return [];

    return [`Things you have settled into on this station: ${traits.join(' ')}`, ''];
}

/**
 * One thing that happened to this character, as the user turn offers it.
 *
 * The break prompt's fence, kept word for word where it matters: it happened to YOU, it is not a
 * fact about a record, and it is never something the station knows. A caller's anecdote is fiction
 * about somebody the station stands behind none of, which makes the fence more load-bearing here
 * rather than less.
 */
function storyLines(story: PersonaStoryForPrompt): string {
    const lines = [
        'Something that happened to you, which you could bring up if this moment gives you a reason to:',
        story.story,
        ...(story.details.length === 0 ? [] : ['You also remember:', ...story.details.map(detail => `- ${detail}`)]),
    ];

    if (story.timesTold > 0) {
        lines.push(
            'You have told this on air before, so a regular listener may know it. Tell it the way somebody tells a story twice: shorter, ' +
                'or from a different end of it, or for the one detail that is new.',
        );
    }

    lines.push(
        'You do not have to mention it. If you do, it happened to YOU — it is not a fact about any record, so do not attach it to one, ' +
            'do not present it as something the station knows, and never let it become a claim about anybody real.',
    );

    return lines.join('\n');
}

/** What to call somebody in a prompt: their on-air name, or what they are. */
const nameOf = (who: CastMember | undefined): string =>
    who?.name ?? (who?.role === 'caller' ? 'Your caller' : 'The presenter');

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
