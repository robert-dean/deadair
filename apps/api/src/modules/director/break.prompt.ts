/**
 * What the station asks a model for, and what it will accept back.
 *
 * Two pure functions and no I/O, so the interesting decisions here — which are all about what the
 * model must NOT do — are testable without a model. The binding that uses them is
 * `model.talk.break.writer.ts`.
 *
 * ## The one failure this is shaped around
 *
 * `docs/todo/station-intelligence.md` §9: a prompt asked to be concrete about music and shown no
 * track fields reaches into training data and describes a record that is not playing. The failure
 * is specific — it is not that a model invents facts, it is that it frames real facts as a CUE
 * ("coming up", "you just heard", "that was"). So the FRAMING is banned rather than the noun, since
 * a break about a record that may not name the record is not a break. And certainty is asked for
 * separately, because inventing a credit and mis-cueing a real record are independent failures and
 * one instruction covering both gets neither.
 *
 * That ban was an instruction and nothing read it back, which is the half {@link misCuedIn} now
 * closes: a break may cue a record it was genuinely shown and still put it on the wrong side of
 * itself, and a mis-cue is baked into audio that cannot be re-cut. It is the same enforcement
 * `segments.claims_item_id` is for a forward promise, pointed at the words instead of the order.
 *
 * ## The notes, and the second failure they bring
 *
 * A record now arrives with up to two short true sentences about it, chosen by the caller (see
 * `BreakTrack.facts`). They make the §9 rules above MORE necessary rather than less: a model handed
 * one real fact will happily hang a cue off it. They also bring a failure of their own, which is a
 * model reading a note out as it stands — "Active as a recording artist from 1948 to 2025" is a
 * real row here, and it is a database entry rather than something a person says. So the notes are
 * offered as raw material for one line, in the station's own voice, droppable.
 *
 * That instruction is in the USER turn rather than the system one, because the failure does not
 * exist for a station that has enriched nothing: with no notes there is nothing to read aloud
 * badly, and a rule about them would be a rule about nothing.
 */

import { sentencesWithin, withoutCues, type LlmMessage, type SpeechCue } from '@deadair/plugin-sdk';
import { padCue, withoutPads } from '#modules/render/pad.cues.js';
import { MAX_REACTIONS, speakableScript, stripWrapping } from '#modules/render/speakable.script.js';
import {
    characterFault,
    latitudeOf,
    personaLines,
    personaVoiceReminder,
    spentCatchphrases,
    LATITUDE_INSTRUCTIONS,
    LATITUDE_LICENCE,
    LATITUDE_MAX_WORDS,
    type CharacterContext,
    type CharacterFault,
    type PersonaLatitude,
    type PersonaSheet,
} from '#modules/personas/persona.sheet.js';
import type { PersonaNotesForPrompt } from '#modules/personas/persona.note.js';
import type { PersonaStoryForPrompt } from '#modules/personas/persona.story.js';
import type { SpokenWeather } from '#modules/weather/weather.words.js';
import type { BreakStory, BreakTrack, BreakWriteRequest } from './break.writer.js';
import { contradictsDayPart, namesWrongTimeOfDay, type RoughTime } from './clock.words.js';

/**
 * What makes one KIND of break's prompt different from another's.
 *
 * The seam that keeps this file from growing a branch per kind. `BreakWriter` is already a registry
 * over kinds rather than one writer with parameters, on the argument that a fifth kind of break is a
 * fifth writer; a `greeting?: boolean` here would have been that same mistake made a second time,
 * one flag at a time, until the prompt builder was a switch statement.
 *
 * So a kind brings its own shape and the shared discipline stays here. Everything a break owes
 * whatever it is — the grounding rules, the persona sheet and its diction reminder, the word ceiling,
 * the notes rule, the recent-scripts rule, the clock instruction — is in {@link systemPrompt} and
 * {@link userPrompt}, where no kind can opt out of it. What a shape may change is what the break IS:
 * one sentence, one opening, and any rule that is true of this kind and false of the one beside it.
 *
 * Shapes live beside their writers, so this file imports the interface and none of them.
 */
export interface BreakPromptShape {
    /** What this sort of break is, in one sentence, in the system turn. */
    job: string;
    /**
     * Whether the record that has just finished is shown at all.
     *
     * Not every break is about what just played. A greeting is about somebody who has only now
     * arrived, so what they missed is not theirs to be back-announced — and showing it anyway is an
     * invitation for a model to cue a record its listener never heard.
     */
    showsPrevious: boolean;
    /**
     * Whether the rest of this broadcast's records are offered as something to refer back to.
     *
     * Off unless a shape asks for it, and the two kinds that decline are instructive. A WELCOME must
     * not have it for the same reason it has `showsPrevious: false` — an arriving listener did not
     * hear any of it, so a presenter reminiscing about the last half hour is talking to the room it
     * just lost. A BULLETIN must not have it because a list of records in front of a model that has
     * been asked to report the news is a list it will find a way to read out.
     *
     * What it is FOR is the ordinary link, where the failure it fixes is a station that sounds like
     * it walked in halfway through its own show: every break knew the record either side of it and
     * nothing before that, so nothing could ever be referred back to.
     */
    showsPlayed?: boolean;
    /** What the user turn opens with, before the records. Absent for a break that needs no framing. */
    opening?: (request: BreakWriteRequest) => string | undefined;
    /**
     * Rules this kind owes on top of the shared ones, rendered at the end of the same list.
     *
     * For a rule that is true of one kind and FALSE of another, which is a narrower thing than it
     * sounds: almost everything a break owes is owed by all of them, which is why the shared list is
     * as long as it is and why this is empty on most shapes. The one that forced it is "make one
     * point" — exactly right for a link between two records, and a licence to drop two thirds of a
     * bulletin if the news shape had to read it.
     */
    rules?: readonly string[];
    /**
     * Whether a script that names neither record it was shown is refused.
     *
     * On for the ordinary link and off everywhere else, and the asymmetry is the point. A welcome is
     * written before it is placed and frequently has no record at all; a bulletin's job is the
     * stories and it hands back to the music as a courtesy. Only the link between two records is a
     * break whose whole purpose is the record, so it is the only kind where naming none of them is a
     * failure rather than a choice.
     *
     * See {@link namedRecordIn} for what counts as naming one, and the note on
     * {@link TALK_BREAK_SHAPE.rules} for why this had to become checkable.
     */
    mustNameRecord?: boolean;
    /**
     * Whether the records shown carry their {@link BreakTrack.facts} with them.
     *
     * On unless a shape says otherwise, because notes are the point of the enrichment. Off for a
     * BULLETIN, and that is the one exception rather than a knob: a bulletin is shown the record
     * coming up only so it can hand back to the music in a line, and everything a note adds there is
     * risk in the kind of break where being wrong is worst.
     *
     * Measured on this station. A bulletin handed the next record's notes read them out on the way
     * out of the headlines: "released in May three thousand nine hundred thirty-three", "featuring
     * Grant Young and Sterling Campbell each playing half the album". Both are a model finishing a
     * note it half-understood, in the voice it has just spent forty words establishing as the voice
     * that reports facts.
     */
    showsFacts?: boolean;
    /**
     * Whether this character's NOTEBOOK reaches the prompt: what it has settled into, and what it has
     * said on this station before.
     *
     * On unless a shape says otherwise, and off for a BULLETIN — which is {@link showsFacts}' exact
     * argument transplanted, because it is exactly the same hazard one source further out. A model
     * asked to report the news and handed a list of material will find a way to read the material
     * out, and a sentence this character said about a record last fortnight is worse in a bulletin
     * than a discography note, because nothing about it is even trying to be true today.
     *
     * It withholds BOTH halves rather than only the sayings. The sheet still goes, so the bulletin
     * still sounds like the station's own presenter; what is withheld is the accumulated extra, on
     * the same ground `NEWS_SHAPE` already passes `dialect: 'optional'` — a bulletin is the one kind
     * where being in character is not the job.
     *
     * A WELCOME keeps it, which is the one place this parts company with
     * {@link BreakPromptShape.showsPlayed}. That is off for a welcome because an arriving listener
     * heard none of this show, and the argument stops there: somebody tuning in has heard this
     * STATION before, which is the entire premise of a note.
     */
    showsNotebook?: boolean;
    /**
     * Whether this kind may carry one of the character's own STORIES, and on whose terms.
     *
     * Absent for every kind that may not, which is most of them — and `NEWS_SHAPE` is the one where
     * that is an argument rather than an omission, on {@link BreakPromptShape.showsNotebook}' exact
     * ground: a model asked to report the news and handed material will find a way to read the
     * material out, and an anecdote is worse there than a discography note because nothing about it
     * is even trying to be true today. A welcome is the station's front door rather than a slot for
     * one.
     *
     * The two modes are two different claims about what the break IS, which is why this is not a
     * boolean:
     *
     * - `offered` — the story is optional material on a break about something else, and saying so is
     *   the whole of the difference. The ordinary talk break.
     * - `told` — the story IS the break, so the optionality goes: a presenter who declined to tell it
     *   would be a break about nothing.
     *
     * **Whether there is a story here at all is the CALLER's decision**, not this flag's. A
     * character's {@link PersonaSheet.storytelling} rung is applied where the story is read, because
     * that is where it is also RESTED — a rung consulted here instead would have the caller spending
     * a story's turn on a break that never carried it, and the store would report a telling nobody
     * heard. This is the same division `showsNotebook` already makes: the shape vetoes, and what is
     * in the prompt is what the job put there.
     */
    stories?: 'offered' | 'told';
    /**
     * Whether a persona's {@link PersonaSheet.latitude} is offered on this kind of break.
     *
     * Off unless a shape asks for it, and the shape has the last word rather than the sheet — which
     * is the same asymmetry {@link BreakPromptShape.mustNameRecord} has, pointed the other way. A
     * persona is who the station IS, and a kind of break is a job it is doing.
     *
     * ## The line is REPORTING, and it moved once
     *
     * It used to sit around the ordinary link alone, on two arguments: a welcome is a greeting to
     * somebody who has just arrived rather than a slot for a monologue, and a story already has all
     * the room it needs. Both were arguments about LENGTH, and length is the half a rung least
     * decides. {@link LATITUDE_MAX_WORDS} reaches a kind through {@link maxWordsFor}'s `Math.max`, so
     * a ceiling the station set higher is never pulled down by a rung, and what those two kinds
     * actually gain is the REGISTER: the character an operator chose the rung for in the first place.
     * A station whose links are unleashed and whose greeting is prim was two characters, and nothing
     * on either page said which one a listener would get.
     *
     * A bulletin and a forecast still refuse it, which is the half of the old argument that holds: a
     * report's accuracy is not a character choice, so a station whose character is unleashed still
     * reads the news in forty words.
     */
    allowsLatitude?: boolean;
    /**
     * The {@link BreakPromptShape.rules} to send INSTEAD when latitude is in force.
     *
     * Swapped rather than appended, and that is the whole reason this exists as a second list. "Make
     * one point" and "take that thought as far as it goes" are the same slot said twice, and a model
     * handed both hedges between them — which is the argument that already makes a persona replace
     * the station's role sentence rather than queue behind it.
     *
     * A shape writing one of these owns BOTH versions, so the rules a kind cannot give up are visible
     * in both lists rather than being reconstructed by whoever reads the diff later. For the talk
     * break that is "name a record", which {@link BreakPromptShape.mustNameRecord} still refuses over
     * whatever room the character was given.
     */
    latitudeRules?: readonly string[];
    /**
     * Whether a performance cue may be written into this kind of break.
     *
     * Off unless a shape asks for it, and the shape has the last word exactly as it does over
     * {@link BreakPromptShape.allowsLatitude}. A cue is the presenter being a person, so the ordinary
     * link is where it belongs and a BULLETIN is where it plainly does not: a newsreader who sighs
     * over a story has editorialised it, in a kind of break whose whole discipline is that it does
     * not. A welcome is excluded on the narrower ground that it is the station's front door and is
     * written before it is placed, which is one flag to reconsider once the talk break has been
     * heard.
     *
     * Independent of latitude, and not a rung of it: a terse character may laugh and an unleashed one
     * need not. The two compose because they are about different things.
     */
    allowsCues?: boolean;
    /**
     * Whether this kind of break may hit a pad at all.
     *
     * {@link BreakPromptShape.allowsCues}' neighbour and, for the talk break, its twin — but the two
     * are separate flags rather than one "may perform" flag, because they are permissions over
     * different things and a kind can want one without the other. A cue is the presenter being a
     * person; a pad is the station's own noise, which is a house style rather than a mood. The
     * bulletin refuses both and refuses them for the same reason stated twice: a newsreader who
     * sighs over a story has editorialised it, and one who hits an air horn after it has done
     * something worse.
     */
    allowsPads?: boolean;
    /**
     * Whether this kind of break is told what the character has had on its mind.
     *
     * `PersonaSheet.preoccupations`, of which the caller has already chosen one. Off unless a shape
     * says otherwise, and the ordinary talk break is the only one that says so: this is
     * {@link BreakPromptShape.showsFacts}' argument one source further out. A bulletin handed a
     * standing subject of the presenter's will work it into the news, and a subject that is not even
     * trying to be true today is worse in that voice than a discography note is.
     *
     * A welcome is excluded on the narrower ground `allowsCues` uses: it is the station's front door,
     * written before it is placed, and what a character has been chewing over is not what a listener
     * arriving wants first.
     */
    allowsPreoccupation?: boolean;
}

/**
 * The shape of an ordinary talk break: the link between two records.
 *
 * The wording is exactly what this file said before there were shapes, moved rather than rewritten.
 */
export const TALK_BREAK_SHAPE: BreakPromptShape = {
    job: 'You write one short spoken link between records. It is read aloud exactly as you write it.',
    showsPrevious: true,
    // The one kind that is presenting a SHOW rather than an arrival or a bulletin, so it is the one
    // that has anything to refer back to.
    showsPlayed: true,
    // The one rule here that ASKS FOR LESS, and it is what buys a character room to exist. Measured:
    // the word ceiling is not what bounds a break — 2 of 137 answers reached it and the median came
    // in at 28 words — so a break is short because the model stops, and what it spends those 28
    // words on is the whole question. It was spending them on content: both titles, both artists and
    // a note read out, with a marker at the front and a signature at the end, which is a listing with
    // decoration rather than somebody talking.
    //
    // The second half says what the saved words are FOR, and it is here because asking for less
    // turned out to be only half a rule. Every instruction this prompt carries points downwards — do
    // not name a record you were not given, you need not mention both, make one point — and a model
    // reading all of them writes the shortest correct thing it can: the five model breaks this
    // station has captured came in at 11, 13, 20, 27 and 29 words against a ceiling of 40, so it is
    // stopping at half its allowance with nothing telling it what the other half is for. This is not
    // permission to run long, which the ceiling still refuses; it is the one instruction in the list
    // that points at the voice rather than at the content.
    //
    // The second rule is the same doctrine pointed at the SHAPE rather than at the length, and it is
    // the one the captured breaks argued for. Measured over the last 45 talk breaks this station
    // wrote: almost every one of them was an announcement with a fact bolted on — "Deadair's next
    // spin is X by Y", "X drops next", four of them opening with those exact words — and the model
    // was not doing anything it had been told not to. Every instruction in this prompt describes a
    // break in terms of the records either side of it, so a model reading all of them writes the
    // most correct cue it can, and a cue read in character is still a cue.
    //
    // What it is missing is that the listener HEARD the record. They do not need to be told what
    // played, which is why the interesting half of a break is the presenter's own reaction to it —
    // the thing a template can never write and the only reason a model is here at all. Stated as
    // what a break IS rather than as another prohibition, because the list is already long on those
    // and one more would push it the same way.
    // The correction, and it is a correction rather than an addition: the rule above said "naming
    // them is the least useful thing you can do", and a model reading that stopped naming them at
    // all. Measured over thirty-nine consecutive model talk breaks under one persona, roughly three
    // quarters named neither record — "Tonight the groove lands. Friend, a cue from Jerez rises. The
    // pressing shows a twin mark" is a real one, and a listener has no idea what is playing.
    //
    // So the ask is now BOTH halves in one sentence, because they were never in tension and stating
    // them separately let the model satisfy the second by dropping the first. The point still has to
    // be the presenter's own; it just has to be attached to something a listener can identify.
    // `mustNameRecord` below is what makes the attached half checkable, on the same bargain every
    // other refusal here is on: the station asks for it plainly before it refuses a script for
    // missing it.
    rules: [
        'Make one point, and make it the way only you would. A break is a single thought said well, not everything you know about both ' +
            'records: the words you save by leaving one of them out are yours to spend on saying it like yourself.',
        'Name a record, and then say what you make of it. Your point has to be ABOUT one of the records above, and a listener has to be ' +
            'able to tell which — so say its title, or who it is by, somewhere in the break. One of the two is plenty; both is usually ' +
            'one too many.',
        'Talk, do not announce. Naming the record is not the break, it is what the break hangs on: a reaction, an opinion, something it ' +
            'reminded you of. If your break would still make sense read out by anybody else, it is not yours yet.',
    ],
    mustNameRecord: true,
    // Optional material rather than the point of the break, so the character's own rung decides
    // whether it appears. See `BreakPromptShape.stories`.
    stories: 'offered',
    // The link between two records is the one kind with room to give. See `allowsLatitude`.
    allowsLatitude: true,
    // The same three rules with the first one turned around, which is the only one of them that was
    // ever about restraint. Rules two and three are unchanged and deliberately so: a character given
    // room still has to be talking ABOUT a record a listener can identify — `mustNameRecord` refuses
    // it either way, and a refusal for a rule that was quietly dropped from its own prompt would be
    // the trick question every other guard here is written to avoid.
    latitudeRules: [
        'Take the thought as far as it goes. This is not a link to get through: if the record sets you off, follow it — the tangent, the ' +
            'grudge, the story it dragged up. Say the whole of it and stop when you are actually finished.',
        'Name a record, and then say what you make of it. Your point has to be ABOUT one of the records above, and a listener has to be ' +
            'able to tell which — so say its title, or who it is by, somewhere in the break. One of the two is plenty; both is usually ' +
            'one too many.',
        'Talk, do not announce. Naming the record is not the break, it is what the break hangs on: a reaction, an opinion, something it ' +
            'reminded you of. If your break would still make sense read out by anybody else, it is not yours yet.',
    ],
    // A link between two records is the presenter being a person, which is exactly what a cue is for.
    // See `allowsCues` for why the bulletin and the welcome are not.
    allowsCues: true,
    // And the one place a soundboard belongs, on the same grounds read one step out: the link is
    // where the station gets to sound like itself.
    allowsPads: true,
    // The one kind with somewhere to put a subject of its own. See `allowsPreoccupation`.
    allowsPreoccupation: true,
};

/** How the station wants this break to sound, and how long it may run. */
export interface PromptSettings {
    /** What the station calls itself, from `stream.title`. */
    station?: string;
    /** What it calls its presenter: the active persona's name, or `station.djName` behind it. */
    dj?: string;
    /**
     * Who the station is right now, from `deadair.personas`.
     *
     * The `style` completes "You are …" in place of the station's own sentence, and the sheet's
     * facets are rendered between that and the rules. A station with no persona is unchanged, which
     * is the state every fresh install is in until it picks one.
     */
    persona?: PersonaCharacter;
    /**
     * What this character has accumulated, from `deadair.persona_notes`.
     *
     * Called a NOTEBOOK here and not "notes", which is not fussiness: in this file "the notes" has
     * meant a record's enrichment facts since the day the facts arrived, it means that in three
     * rules the model is actually sent, and two things with one name in one prompt builder is how a
     * shape ends up withholding the wrong one.
     *
     * Two lists rather than one because they are rendered in two different turns, and that split is
     * the design rather than a formatting choice. A `trait` is who the presenter IS, so it sits in
     * the system turn with the sheet; a `said` is what the presenter DID, so it sits in the user turn
     * with the show's own memory. Put both in one place and either a fact about last Tuesday becomes
     * part of the character or the character becomes a detail of this hour.
     *
     * Absent, or empty, leaves the prompt byte-identical to one built with no notebook at all, which
     * is `personaLines`' own guarantee held one level up.
     */
    notebook?: PersonaNotesForPrompt;
    /**
     * The one thing this character has had on its mind, from `PersonaSheet.preoccupations`.
     *
     * Chosen by the caller for {@link PromptSettings.notebook}'s reason, and rendered only where
     * {@link BreakPromptShape.allowsPreoccupation} says so — the caller offers, the shape decides,
     * which is `pads` beside it. Nothing is spent by choosing one, so unlike a story or a note there
     * is no rotation here to spoil by asking twice.
     */
    preoccupation?: string;
    /**
     * The one story this break may draw on, from `deadair.persona_stories`.
     *
     * ONE, already chosen by the caller, which is the whole shape of the feature rather than a
     * convenience. The measured failure of handing a model material is that the model gets through
     * the material — the notes reached 108 of 137 captured prompts and the answers recite them — and
     * a list of anecdotes in a forty-word break would be a presenter reading their own biography.
     * The rotation lives in the store, where `last_told_at` can be stamped by whoever actually went
     * on air; nothing here decides WHICH.
     *
     * Read by the caller for {@link PromptSettings.notebook}'s reason exactly: the caller rested what
     * it took, so a writer that fetched its own would spend the rotation a second time and show a
     * different story to the guard than to the prompt.
     *
     * Absent leaves the prompt byte-identical to one built before any of this existed, which is the
     * state of every station until somebody writes a story down.
     */
    story?: PersonaStoryForPrompt;
    /** The ceiling, in words. See {@link DEFAULT_MAX_WORDS}. */
    maxWords?: number;
    /**
     * Whether the presenter has to keep it broadcast-clean.
     *
     * Named for what it asks of the WRITER rather than for the setting behind it: a model is being
     * told how to speak, not what a `track_sources` row is marked. So a caller that wants a clean
     * script for some other reason can ask for one without pretending to have a content policy.
     *
     * On when `rotation.advisory` is anything but `prefer-explicit`, because a clean track list
     * narrated by a DJ who swears is the same failure with an extra step. Note the asymmetry with
     * the record side, and it is deliberate: `prefer-clean` is only a lean about WHICH COPY to play
     * because most catalogue has no clean twin to choose, whereas a presenter always has the choice
     * of their own words. There is nothing for a preference to fall back to here.
     *
     * The answer is NOT checked against this. The floor under every model writer is a template the
     * operator wrote, so it is clean by construction, and a model that ignores the rule costs one
     * break rather than a policy breach. A word list would be a permanent, locale-bound maintenance
     * surface bought for very little.
     */
    cleanLanguage?: boolean;
    /**
     * The things the presenter can do that are not words: a laugh, a sigh.
     *
     * Called REACTIONS here and `SpeechCue` everywhere else, which is the same rename {@link
     * PromptSettings.notebook} makes and for the identical reason: "cue" already means something in
     * this file. {@link AnswerGuard.cues} is the two records a break sits BETWEEN, which is what a
     * radio presenter means by the word, and it is read by `misCuedIn` three lines from where this
     * would be read. Two things with one name in one prompt builder is how a shape ends up
     * withholding the wrong one.
     *
     * Resolved by the caller from the render side rather than read here, exactly as `persona` and
     * `notebook` are, and for the same reason: one answer per break, so the rule the model is shown
     * and the guard the answer is judged by cannot disagree about what was on offer.
     *
     * Empty or absent asks for nothing, which is the state of every station whose engine only reads
     * words — and it leaves the prompt byte-identical to one built before any of this existed.
     * **Offering one the engine cannot perform is the thing this must not do**, because the words go
     * into audio that cannot be re-cut. The render path strips an unperformable one anyway, so the
     * cost of getting it wrong here is a break that READS oddly rather than one that SOUNDS wrong.
     */
    reactions?: readonly SpeechCue[];
    /**
     * The pads this character can reach for, by name, or absent for one with no board.
     *
     * {@link PromptSettings.reactions}' shape and its rule about agreement — what the prompt offers
     * and what the guard judges must be the same list — with the one difference being who performs
     * it. A reaction goes to the ENGINE, so the risk of offering a bad one is a break that reads
     * oddly. A pad goes to the JOIN, out of a file the station holds, so offering a name the board
     * does not carry costs the break its sound and nothing else: `keepPads` drops it.
     *
     * Names rather than rows, because a name is the whole of what a model needs and the only part of
     * a pad it could ever give back.
     */
    pads?: readonly string[];
}

/** The half of a persona a prompt uses: who they are, and how they speak. */
export interface PersonaCharacter extends PersonaSheet {
    /** Completes "You are …". */
    style: string;
}

/**
 * How long a break may run, in words.
 *
 * Forty is about fifteen seconds read aloud, which is a talk break rather than a monologue. Stated
 * to the model in seconds as well as words, because a model reasons about a spoken length better
 * than about a count, and enforced in {@link readAnswer} in words, because that is the half that
 * can actually be checked.
 */
export const DEFAULT_MAX_WORDS = 40;

/** Roughly how fast a voice reads, for turning a word ceiling into a length a model understands. */
const WORDS_PER_SECOND = 2.6;

/**
 * The rung in force for this prompt, or `undefined` for the station's ordinary discipline.
 *
 * The shape has the veto and the sheet only ever offers, which is why both are read here rather than
 * at either end. See {@link BreakPromptShape.allowsLatitude}.
 */
const latitudeIn = (settings: PromptSettings, shape: BreakPromptShape): PersonaLatitude | undefined =>
    shape.allowsLatitude === true ? latitudeOf(settings.persona) : undefined;

/**
 * The reactions the PRESENTER may use, which is not the whole vocabulary any more.
 *
 * The station's original four. `SPEECH_CUES` is wider now, because somebody on the end of a
 * telephone clears their throat and a presenter does not — see the note there, and
 * `production.cues.ts` for the set a caller gets. This is the half that keeps the widening from
 * reaching the person being paid to talk.
 */
export const PRESENTER_CUES: readonly SpeechCue[] = ['laugh', 'chuckle', 'sigh', 'gasp'];

/** Re-exported so a caller reasoning about a break's reactions needs one import rather than two. */
export { MAX_REACTIONS };

/**
 * What this prompt may offer, which is the shape's permission and the engine's ability together.
 *
 * Both are vetoes and neither is a preference, so this is an intersection rather than a fallback: a
 * kind of break that should not carry one is not talked into it by a capable engine, and a kind that
 * may is not given one by an engine that cannot perform it.
 */
const offeredReactions = (settings: PromptSettings, shape: BreakPromptShape): readonly SpeechCue[] =>
    shape.allowsCues === true ? (settings.reactions ?? []) : [];

/**
 * The reaction rule, or nothing at all when there is none to offer.
 *
 * Nothing rather than a rule saying "you may not laugh", which would spend a line of the prompt
 * telling a model about a facility it was never given — the same reason a break with no stories says
 * nothing about stories.
 *
 * The wording asks for restraint in the rule itself rather than leaving it to the guard, on the
 * bargain every check in this file keeps: a script is only judged for something the prompt actually
 * asked for. Here the guard trims rather than refuses, so the bargain is softer, but the rule still
 * has to be the honest version of what is going to happen.
 */
function reactionRules(settings: PromptSettings, shape: BreakPromptShape): string[] {
    const reactions = offeredReactions(settings, shape);
    if (reactions.length === 0) return [];

    const written = reactions.map(cue => `[${cue}]`).join(', ');
    return [
        `- You can do one thing that is not words: ${written}. Write it in square brackets exactly like that, at the point it happens, and it is performed rather than read out. ` +
            'At most one in a break, and only where you would actually have done it. A presenter who laughs at everything is not funny, and most breaks want none at all.',
    ];
}

/**
 * What pads this prompt may offer, which is the shape's permission and the rack's contents together.
 *
 * {@link offeredReactions}' intersection exactly. Both are vetoes and neither is a preference: a
 * bulletin is not talked into an air horn by a well-stocked board, and a character with an empty
 * rack is not given one by a kind of break that would have allowed it.
 *
 * **Exported because a writer has to build its guard from this call and not from the request**, which
 * is {@link maxWordsFor}'s rule applied to a list instead of to a number. The prompt and the guard
 * are written in different files and read at different moments, so a guard that intersected the
 * request itself would keep a pad hit in a kind of break whose shape refused to offer one — and the
 * symptom would be a bulletin with an air horn in it and nothing anywhere saying which of the two
 * lists was wrong.
 */
export const offeredPads = (settings: PromptSettings, shape: BreakPromptShape): readonly string[] =>
    shape.allowsPads === true ? (settings.pads ?? []) : [];

/**
 * The soundboard rule, or nothing at all when there is no rack to reach for.
 *
 * Nothing rather than a rule saying "you have no sound effects", on {@link reactionRules}' argument:
 * a line of the prompt spent describing a facility the character was never given is a line further
 * from the end, and the end is where the grounding rules are.
 *
 * Two things it says that the reaction rule does not have to. It names the pads EXACTLY as a script
 * must write them, because `padCue` is the only spelling `padsIn` will find and a model shown
 * "airhorn" that answers "(air horn)" has hit nothing. And it says the sound is PLAYED rather than
 * spoken, because the failure it prevents is a model narrating the pad — "and then the air horn" —
 * which reads as a person describing their own soundboard.
 */
function padRules(settings: PromptSettings, shape: BreakPromptShape): string[] {
    const pads = offeredPads(settings, shape);
    if (pads.length === 0) return [];

    const written = pads.map(padCue).join(', ');
    return [
        `- You have a soundboard: ${written}. Write one exactly like that, on its own, at the moment you hit it, and the sound is PLAYED — ` +
            'do not describe it or say its name as words. At most one in a break, and most breaks want none: a soundboard is funny once.',
    ];
}

/**
 * How long a break may run here, in words.
 *
 * **The one place the ceiling is resolved, and a writer must build both of its ceilings from this
 * call.** {@link PromptSettings.maxWords} is what the model is TOLD and {@link AnswerGuard.maxWords}
 * is what {@link readAnswer} refuses at, and the two are read in different files at different moments
 * — so a persona given room in the prompt and judged at the default would have every one of its
 * breaks declined for doing exactly what it was asked, in silence, with the floor quietly writing the
 * lot. That failure has no symptom other than a station that stopped sounding like the character an
 * operator picked, which is why this is a function rather than two literals that happen to agree.
 *
 * `Math.max` rather than a replacement: a kind with a ceiling of its own already answered the
 * question of how long ITS break may run, and a rung is a floor under that rather than a correction
 * to it.
 */
export function maxWordsFor(settings: PromptSettings, shape: BreakPromptShape): number {
    const base = settings.maxWords ?? DEFAULT_MAX_WORDS;
    const latitude = latitudeIn(settings, shape);
    return latitude === undefined ? base : Math.max(base, LATITUDE_MAX_WORDS[latitude]);
}

/**
 * The conversation, oldest first, with the system prompt as the first turn.
 *
 * One system turn and one user turn. The system turn is who the station is and what a break may
 * never do; the user turn is this particular moment. Split that way so the rules read as standing
 * instructions rather than as something about these two records, which is what they are.
 */
export function breakPrompt(request: BreakWriteRequest, settings: PromptSettings, shape: BreakPromptShape): LlmMessage[] {
    return [
        { role: 'system', content: systemPrompt(settings, shape) },
        { role: 'user', content: userPrompt(request, settings, shape) },
    ];
}

function systemPrompt(settings: PromptSettings, shape: BreakPromptShape): string {
    const station = settings.station?.trim();
    const dj = settings.dj?.trim();
    const persona = settings.persona;
    const maxWords = maxWordsFor(settings, shape);
    const seconds = Math.round(maxWords / WORDS_PER_SECOND);
    const latitude = latitudeIn(settings, shape);

    // A persona replaces the role sentence rather than being appended to it, because "you are the
    // voice of a radio station" and "you are a pirate captain who runs one" are the same slot said
    // twice, and a model handed both hedges between them.
    const role =
        persona === undefined
            ? `You are the voice of a radio station${station ? ` called ${station}` : ''}${dj ? `, and your name is ${dj}` : ''}.`
            : `You are ${persona.style}${station ? `, on a station called ${station}` : ''}${dj ? `, and your name is ${dj}` : ''}.`;

    const lines = [
        role,
        // The sheet sits between the role and the rules, which leaves the grounding discipline in
        // the recency position it has always had.
        // The shape's veto is applied HERE rather than by the caller that chose the subject, which
        // is `offeredPads`' division: what a kind of break offers is a property of the kind, and a
        // job that filtered on it would be a second opinion about the same question.
        ...(persona === undefined
            ? []
            : personaLines(
                  persona,
                  shape.allowsPreoccupation === true && settings.preoccupation !== undefined ? { preoccupation: settings.preoccupation } : {},
              )),
        // Immediately after the sheet, and inside the same block, because a trait IS a sheet line —
        // one this character grew into rather than one its author typed. Gated on the persona as
        // well as on the shape: a note about a character nobody is presenting has nothing to attach
        // to, and a station that dropped its persona should read exactly as it did before.
        ...(persona === undefined || shape.showsNotebook === false ? [] : traitLines(settings.notebook)),
        // Beside the sheet's own brevity line, which is the last thing `personaLines` renders, and
        // for the same reason it is last there: how much of itself a character says belongs with the
        // word ceiling rather than among the facets of a voice. This is that instruction pointed the
        // other way.
        ...(latitude === undefined ? [] : [LATITUDE_INSTRUCTIONS[latitude]]),
        shape.job,
        '',
        'Rules:',
        // The §9 pair, stated as two rules rather than one, because they fail independently.
        '- Only ever refer to the records listed below. Never name, cue, or allude to any other song, artist or album, even one you are sure about.',
        '- Say only what the notes below actually tell you. If you are not certain of something, leave it out rather than reaching for it.',
        // What a script physically is. A model given no shape here writes stage directions.
        `- Keep it under ${maxWords} words, around ${seconds} seconds spoken.`,
        '- Write only the words to be spoken. No stage directions, no speaker labels, no quotation marks around the whole thing, no emoji.',
        '- Write numbers, times and symbols the way they should be read out loud.',
        // Beside the two rules above, because all three are about what a script physically is rather
        // than what it says. This one is the only delivery control the station has: `SpeechRequest`
        // carries text, a voice and a format, so nothing between here and the engine can ask for a
        // reading — the marks in the words ARE the reading. They survive intact, which is what makes
        // this worth asking for: `transposeForSpeech` keeps `.,!?;:` through `settle`, turns an em or
        // en dash into a comma (a real pause), and turns `…` into three dots.
        //
        // The two prohibitions are not style. Capitals are worse than useless because
        // `sayInitialisms` matches its list case-SENSITIVELY, so a model shouting `US` meaning "us"
        // is spelled out as two letters; asterisks and anything else in brackets never survives at
        // all, since `tidyAnswer` strips them as stage directions before the script is even stored.
        //
        // "Anything else" rather than "brackets" because the cue rule below carves exactly four
        // spellings out of that. Said this way whether or not a cue is on offer: the sentence is
        // true either way, and one that changed shape with the engine would be two rules to keep
        // honest instead of one.
        //
        // It opened "punctuation is your only stage direction" until the rule below gave the model a
        // second one. Both sentences were true separately and contradicted each other in the same
        // list, which is the thing this prompt can least afford: a model reading two rules that
        // disagree hedges, and hedging here means writing neither the punctuation nor the reaction.
        '- Punctuate for the delivery, because the marks are how it gets read: a question mark lifts the line, a comma or a dash is a breath, a full stop lands it. Capitals do not sound like anything, and asterisks are stripped before the voice sees them.',
        // Only where the SHAPE permits one and the ENGINE can perform it. Both halves are needed and
        // they fail differently: without the first a bulletin sighs over a story, and without the
        // second the station writes notation that either gets silently deleted or, on an engine that
        // never claimed it, is read out as the word.
        //
        // The budget is stated as a rule and enforced in `readAnswer` rather than trusted, because
        // the engine's own sample scripts run about one cue per sentence — a style a local model may
        // well have been tuned on, and one that would be wall-to-wall on a 28-word break.
        ...reactionRules(settings, shape),
        // Immediately after the reactions, because the two are the same KIND of instruction — the
        // only two things a script may carry that are not words — and a model reading them together
        // is reading one idea rather than two unrelated notations.
        ...padRules(settings, shape),
        '- Do not greet the listener by name, promise anything you have not been told, or mention the time unless you are given it.',
        // Conditional and near the end, because it is the one rule here that is about the station's
        // own policy rather than about what a break IS. Both halves are needed: a model told only
        // not to swear will still quote an explicit title or lyric back, which is the same words
        // arriving by a route the first half does not cover.
        // The two share a slot and the clean rule wins it, which is the whole of "a persona narrows
        // within station policy and never widens it". A station that has said it is broadcast-clean
        // is not talked out of that by whoever is presenting, so an `unleashed` character on a clean
        // station gets the restraint and no licence — and the licence appears only where the policy
        // had already left the presenter free, where its job is to say so rather than to leave the
        // model guessing from the absence of a rule.
        ...(settings.cleanLanguage
            ? ['- This station is broadcast-clean. No profanity or crude language, and do not quote an explicit lyric or title word for word.']
            : latitude === 'unleashed'
              ? [`- ${LATITUDE_LICENCE}`]
              : []),
        // Last in the list, because a rule true of this kind alone should not push the shared ones
        // further from the end than they already are.
        ...(latitude === undefined ? (shape.rules ?? []) : (shape.latitudeRules ?? shape.rules ?? [])).map(rule => `- ${rule}`),
    ];

    // AFTER the rules, and that position is the whole reason it exists. The failure it addresses is
    // caused BY the rules: a host reads seven careful instructions about naming records accurately
    // and answers them in careful, plain English. See `persona.sheet.ts`.
    const reminder = persona === undefined ? undefined : personaVoiceReminder(persona);
    if (reminder !== undefined) lines.push('', reminder);

    return lines.join('\n');
}

function userPrompt(request: BreakWriteRequest, settings: PromptSettings, shape: BreakPromptShape): string {
    const parts: string[] = [];

    const opening = shape.opening?.(request);
    if (opening !== undefined) parts.push(opening);

    // A kind that does not look backwards never sees the record behind it, rather than seeing it and
    // being told not to mention it: a model shown a record will find a way to cue it.
    const previous = shape.showsPrevious ? request.previous : undefined;

    // Same doctrine, applied to the notes: a shape that has no use for them withholds them rather
    // than showing them and asking for restraint. See `BreakPromptShape.showsFacts`.
    const withFacts = shape.showsFacts !== false;

    if (previous) parts.push(`The record that has just finished:\n${describe(previous, withFacts)}`);
    if (request.next) parts.push(`The record coming up next:\n${describe(request.next, withFacts)}`);

    // Both absent is a legitimate moment — the top of an order with nothing behind it, and every
    // welcome, which is written BEFORE it is placed and so has no neighbours to be given.
    //
    // Keyed on whether a record was actually shown rather than on `parts` being empty, which is what
    // it read for as long as it existed and which quietly excused the one kind that needs it most: a
    // shape with an `opening` has already pushed a part by here, so `WELCOME_SHAPE` — the only kind
    // that structurally never has a record — could never reach this line. What that produced is a
    // greeting mining the only concrete material left in its prompt, which is the recent-scripts
    // list: a welcome went out in front of AC/DC's "Back In Black" talking about Sodom's "Agent
    // Orange", lifted whole from the talk break above it, and the rule the model broke was one it
    // had never been given. Hence "not one you said in an earlier break" said in as many words —
    // the recent list is shown as a shape to avoid and reads as a menu when nothing else is there.
    if (previous === undefined && request.next === undefined) {
        parts.push(
            'You have not been given a record. Do not name a song, an artist or an album at all — not one you know, and not one that ' +
                'appears in anything you said earlier. Nothing about a record here would be something this station handed you.',
        );

        // The second half only where there is genuinely nothing else in the prompt to talk about. A
        // bulletin has no records either and has three stories to report, so telling it to identify
        // the station and stop would be telling it not to do its job.
        if ((request.stories?.length ?? 0) === 0) parts.push('Say something brief that identifies the station and nothing more.');
    }

    if (previous && !request.next) {
        // Said explicitly, because a model handed one record will reach for a second. This is the
        // same withholding the deterministic writer does by choosing a phrasing with no `next` in
        // it, and the reason the caller left the next record out is that it could not be trusted.
        parts.push('You have not been told what plays next. Do not say what is coming up.');
    }

    if (previous && request.next) {
        // Shown two records, a model names two records, and at 28 words naming both leaves room for
        // nothing else — which is why what came back was a credit line with a marker on the front.
        // Permission rather than instruction: the station's own phrasings already work this way (a
        // template whose optional chunk was dropped mentions one record and is a perfectly good
        // break), and the model was the only writer that had never been told it could.
        //
        // It costs nothing downstream. `claimsNext` over-stamps deliberately — told what plays next
        // means allowed to name it, so a break that chose not to is stamped anyway and at worst
        // loses itself to a drift it never promised anything about.
        parts.push(
            'You do not have to mention both records. One of them, handed over the way only you would say it, is better than both said flatly.',
        );
    }

    // Asked of what the model can actually SEE: a rule about reading notes aloud is a rule about
    // nothing when the only record carrying any was withheld by the shape.
    if (withFacts && hasFacts(previous, request.next)) {
        // Only when there are notes, because the thing this guards against cannot happen without
        // them. Two failures: reading a database line out as it stands ("Active as a recording
        // artist from 1948 to 2025" is a real row in this install's enrichment), and treating a
        // true fact as a licence to cue whatever it mentions.
        //
        // The optionality is stated FIRST and in as many words, because "work at most one of them
        // in" was read as an instruction to work one in: notes reached 108 of 137 captured prompts
        // and the answers recite them, which is where "Mastodon kicked off in Atlanta in
        // two-hundred-eighty-two" and "Juggernaut of Justice, crafted by Bob Marlette" came from. A
        // model that spends a third of a 28-word break on a fact it was shown has spent it on the
        // one part of the break no listener needed and the character could not survive.
        parts.push(
            'The notes are things the station knows to be true, offered in case one is worth saying. ' +
                'You do not have to use any of them, and most breaks are better without one: a note earns its place only if you can ' +
                'say it as yourself. Never more than one, never read out as it stands, never a date or a credit for its own sake. ' +
                'Anything a note mentions that is not one of the records above is background, never something to cue or play.',
        );
    }

    // The other side of the same coin, and it was missing for as long as the block above existed.
    // The rules only ever described what to do with notes, so a record arriving with NONE left the
    // model with an instruction about an empty list and no instruction at all about the silence —
    // and a character sheet asking for specifics is a standing invitation to supply them.
    //
    // What that produced, measured over thirty-nine breaks under a persona whose own quirks say
    // "start from a note you were actually given": "same pressing plant, same catalogue number as
    // Princesa", "the year 1958 echoes faintly", "a techno echo from 1986", "the DVD holds nine
    // vids". Not one of those records carried a single note. The station was stating fabricated
    // discography as fact in a confident voice, which is the bulletin failure arriving through the
    // music door.
    //
    // Named per record rather than as a blanket, because the partial case is the dangerous one: told
    // one note about the record behind it, a model will happily invent a matching one about the
    // record in front, and a rule that only fires when BOTH are empty would never see it.
    // Judged against what the model can SEE rather than against what the request carried, which is
    // what makes it true for a shape that withheld the notes: from inside a bulletin's prompt the
    // station does know nothing about the record it is handing back to, and that is exactly the
    // guard a bulletin needs most.
    const unknown = [previous, request.next].filter(
        (track): track is BreakTrack => track !== undefined && (!withFacts || (track.facts?.length ?? 0) === 0),
    );
    if (unknown.length > 0) {
        parts.push(
            // "Beyond the title and who it is by" was true when those were the only two fields a
            // record arrived with, and stopped being true the moment `BreakTrack` started carrying
            // the year, the album and the length. Left as it was, this paragraph forbade dates on
            // the same screen that printed one, which is a prompt arguing with itself and a model
            // resolving it whichever way it likes. It now names the listing rather than enumerating
            // what the listing contains, so a field added later cannot make it a lie again.
            //
            // Dates keep their clause rather than losing it, narrowed to what is actually shown:
            // with no year listed "beyond any year listed above" forbids every date, which is the
            // old rule unchanged, and with one it forbids the pressing dates and session dates the
            // rest of the sentence is about.
            `The station knows nothing about ${unknown.map(track => `"${track.title}"`).join(' or ')} beyond what is listed above. ` +
                'Say nothing else about it as fact — no dates beyond any year listed above, no labels, no pressings or catalogue numbers, ' +
                'no studios, no sessions, no chart placings, no connection to any other record. What you think of it is yours to say. ' +
                'What happened to it is not, unless you were told.',
        );
    }

    // IMMEDIATELY after that block, and the position is the argument for the default rung. What the
    // paragraph above hands a model is a prohibition and nothing else — the station knows nothing,
    // so say nothing — while the character sheet three inches up is asking for specifics. Measured
    // over thirty-nine breaks under one persona, what filled that silence was invented pressing
    // plants and catalogue numbers. A story is the something else, and it is true: it just is not
    // true ABOUT THE RECORD, which is the one thing the block below has to make unmistakable.
    parts.push(...storyLines(settings, shape));

    // A bulletin's substrate, and the strictest rules in this file sit on it. Rendered whenever the
    // request carries stories rather than behind a flag on the shape, exactly as the clock and the
    // recent scripts are: what the prompt says is a function of what the moment holds.
    if (request.stories && request.stories.length > 0) {
        parts.push(['The stories to report, in this order:', ...request.stories.map(describeStory)].join('\n'));
        // The one place a model is told it may not paraphrase — and the line dividing what it may
        // reword from what it may not is what this block is FOR. Every other rule here is about a
        // record, where the worst case is an awkward sentence about music; here the worst case is
        // the station stating something false as news in a confident voice, which no listener can
        // check and no later break can take back.
        //
        // So the division is: the FACTS are fixed and the WORDING is the model's. That is a
        // reversal of what this used to ask for and it is deliberate. Asking for "a sentence of what
        // actually happened" under a headline the model had also been told it could read as it
        // stands specified a bulletin in two halves, and it got one — 42 of 104 aired bulletins read
        // a headline and then restated it, which tells a listener the story twice and teaches them
        // it once. Every safety rule underneath is unchanged and stated in the same breath as the
        // licence, because the licence is exactly the size of the rewording and no larger: no detail
        // that is not written down, no consequences, no opinion, and nothing joined into one story
        // that arrived as two.
        parts.push(
            'Read these as news, in the words an anchor would use. Tell each story as you would say it out loud: what happened, to whom, ' +
                'and where, in a sentence or two of ordinary spoken English. ' +
                'A headline is not one of those sentences — it is written to be seen, and read aloud it sounds like a headline — ' +
                'so take what happened from it and say that, rather than reading it out and then repeating yourself. ' +
                'A bulletin that reads out headlines and nothing else has told the listener nothing. ' +
                'The wording is yours; the facts are not. Say only what each story actually says: do not add detail, ' +
                'do not explain what it means, do not say what will happen next, and do not merge two stories into one. ' +
                "The text is the publisher's own wording — use it to know what happened, not as lines to read out. " +
                'Where a story has no text under it, say what its headline says in one spoken sentence and move on rather than filling the gap. ' +
                'If a story is unclear, leave it out rather than guessing at it. Do not say how you feel about any of it.',
        );
    }

    // The weather's substrate, rendered on the same terms as the stories above and carrying the same
    // shape of rule for the same reason. What differs is what "do not invent" means: a bulletin must
    // not add a detail to a story, and this must not add a NUMBER — and a plausible temperature is
    // much easier to write than a plausible news story, because the model knows roughly what August
    // in Atlanta is like and will say so if the line below does not stop it.
    if (request.weather !== undefined) {
        parts.push(describeWeather(request.weather));
        parts.push(
            'Give the weather from those figures and nothing else. Every number and every word about the sky has to be one written above: ' +
                'do not round, do not convert, do not add a figure that is not there, and do not say what it was like yesterday or what it ' +
                'will be like after the days listed. ' +
                'You may say it as a person would rather than reading a table, and you may leave a figure out — but a figure you say has to ' +
                'be one you were given. ' +
                'No advice about coats or umbrellas, and nothing about how the weather makes anyone feel.',
        );
    }

    // What the show has played, for a kind that is presenting one. OFFERED, and the wording of that
    // is the whole of this block: the measured failure of handing a model material is that the model
    // gets through it. "Work at most one of them in" read as an instruction to work one in, which is
    // why the notes rule two blocks up says "You do not have to use any of them" — and a list of
    // titles is that hazard one size larger, because a list is the one shape a model will simply
    // read out. So it says what the list is FOR (there is a show behind this record) and then says
    // plainly that using it is optional, and "make one point" in the rules is what holds the line.
    const played = shape.showsPlayed === true ? (request.played ?? []) : [];
    if (played.length > 0) {
        parts.push(
            [
                'Earlier in the show you played these, most recent first:',
                ...played.map(record => `- ${record.title} by ${record.artist}`),
                'This is here so you know there is a show behind this record, not a list to get through. ' +
                    'Refer back to one of them only if you have something to say about it. You do not have to mention any of them.',
            ].join('\n'),
        );
    }

    // What this character has said before tonight, which is the half of a presenter's memory that
    // outlives the broadcast. Placed ahead of the recent scripts rather than after them, because the
    // two are read very differently and running them together would confuse both: this one is
    // material that may be built on, and the one below is a shape to avoid.
    //
    // OFFERED, in the same words the played list is, and for the reason measured there: handed a
    // list, a model gets through the list. What this is for is a break that can say "I have been on
    // about this record for a fortnight", which is a thing only a station with a memory can say — and
    // a break that works one in because it was shown one is the failure it is trying to buy its way
    // out of.
    const said = shape.showsNotebook === false ? [] : (settings.notebook?.said ?? []);
    if (said.length > 0) {
        parts.push(
            [
                'Things you have said on this station before, which a regular listener may remember:',
                ...said.map(note => `- ${note}`),
                'These are yours to build on, not a list to get through. Pick one up only if this moment gives you a reason to. ' +
                    'You do not have to mention any of them.',
            ].join('\n'),
        );
    }

    if (request.recent && request.recent.length > 0) {
        parts.push(
            ['You said these recently. Do not reuse their opening or their shape:', ...request.recent.map(script => `- ${script}`)].join('\n'),
        );

        // The line above has said "do not reuse their opening" for as long as it has existed, and it
        // does not work: nine consecutive breaks on this station opened with the word "Yikes" and
        // four more with "Deadair's next spin is", every one of them written with the previous few
        // scripts sitting in the prompt. A rule about a list is a rule a model has to do work to
        // apply, and the work it skips is exactly the cheapest word in the answer.
        //
        // So the openings are extracted and NAMED, which is the move the spent-signature block below
        // already makes and the reason that one lands: the station asks for something specific
        // before it complains about not getting it. Same bargain, one rule earlier.
        const openings = spentOpenings(request.recent);
        if (openings.length > 0) {
            parts.push(
                `Your last few breaks started ${openings.map(opening => `"${opening}"`).join(', ')}. Start this one somewhere else — ` +
                    'a different first word and a different shape, not the same run-up with the records swapped.',
            );
        }

        // The opening rule one scale larger, and it exists because fixing the openings did not fix
        // the repetition — it moved it into the middle of the sentence. Measured over thirty-nine
        // consecutive breaks under one persona: groove 26, friend 35, signal 17, pattern 14, clock
        // 12, echo 11, needle 8, whispers 7. Every break opened differently and they were all the
        // same break.
        //
        // A persona is what makes this worse rather than better, which is the part worth stating:
        // `dictionMarkers` are asked for by name in every prompt and counted in every answer, so the
        // cheapest way to pass the character check is to say the marker list again, and nothing was
        // reading back how often. So the markers are deliberately NOT exempt here.
        //
        // An ASK and never a refusal, unlike the openings. A word is not wrong for being used twice,
        // the sheet genuinely does want its vocabulary in the answer, and a check that declined over
        // this would be refusing the character for being itself. Naming the habit is the whole
        // intervention — it is the same bargain the spent signatures are on, and that one lands.
        const worn = overusedWords(request.recent);
        if (worn.length > 0) {
            parts.push(
                `You have leaned on ${worn.map(word => `"${word}"`).join(', ')} in nearly every recent break. Reach past ${worn.length === 1 ? 'it' : 'them'} ` +
                    'this time. Your character has more than one way to say what it means, and saying it the same way every time is how a ' +
                    'presenter starts to sound like a recording.',
            );
        }

        // The moment-dependent half of the catchphrase rule, and it is here rather than in the sheet
        // for the reason everything is here rather than there: which signatures are spent is a fact
        // about tonight, and the system turn is who the station is. The sheet says "at most one, and
        // not every time"; this is the sentence that makes "not every time" mean something, and
        // `characterFault` refuses a script that ignores it.
        //
        // The invitation matters as much as the refusal. Told only what it may not say, a model
        // reaches for the nearest other thing the sheet gave it, which is a sample line — the
        // failure one rule over. Told to make a new one, it does the character rather than quoting
        // it, and the station gets a signature that is genuinely its own.
        const spent = settings.persona === undefined ? [] : spentCatchphrases(settings.persona, request.recent);
        if (spent.length > 0) {
            parts.push(
                `You have already said ${spent.map(phrase => `"${phrase}"`).join(' and ')} recently. Do not say ${spent.length === 1 ? 'it' : 'any of them'} again now. ` +
                    'If you want a line to go out on, make up a new one of your own in the same voice.',
            );
        }
    }

    // BEFORE the clock, and the order is the argument. `request.clock` is twelve-hour with no am or
    // pm — "just after half past seven" — which is right for a listener who is awake at the time and
    // is exactly half the information a model needs. Told the hour and not the half of the day, a
    // model fills the gap from the persona sheet, and a sheet listing `tonight` as a diction marker
    // fills it with "tonight": measured on this station, twelve of thirty-nine talk breaks written
    // between seven and ten in the MORNING opened on that word, one of them two breaks after a
    // welcome that had correctly said good morning.
    //
    // Stated as a fact about the moment rather than as words to use, which is the opposite posture
    // to the clock line below and deliberate. The clock is a phrasing whose expiry the station
    // tracks, so it has to come back verbatim to be checkable; this is context, and a presenter who
    // knows it is morning says so in whatever words the character has for it. What it is guarding is
    // the negative half, which is why that half is spelled out.
    if (request.dayPart) {
        parts.push(
            `It is ${request.dayPart.words} where your listener is. Everything you say has to fit that: do not call it any other part ` +
                'of the day, and do not reach for the hour, the light or the weather to set a scene you have not been told about.',
        );
    }

    if (request.clock) {
        // The exact words rather than a time, and an instruction to use them verbatim. A model
        // asked to say what time it is will invent its own phrasing, and the station has no way to
        // tell how long an invented one stays true — whereas these words come with their own expiry
        // and the answer can simply be searched for them. Wanting it rather than requiring it: a
        // break that came out without the time is still a break, and it just makes no claim.
        parts.push(
            `It is ${request.clock.words}. Work that in, using exactly the words "${request.clock.words}" ` +
                'and no other way of saying the time. Do not give an exact time and do not name the minutes.',
        );
    }

    const station = settings.station?.trim();
    if (station) parts.push(`The station is called ${station}. You may say so, but you do not have to every time.`);

    parts.push('Write the link now.');
    return parts.join('\n\n');
}

/**
 * One record, as the model is shown it.
 *
 * "Notes" rather than "facts", because the rule in the system turn already calls them that and the
 * two have to name the same thing for either to mean anything.
 */
function describe(track: BreakTrack, withFacts: boolean): string {
    const lines = [`- Title: ${track.title}`, `- Artist: ${track.artist}`];
    // Behind `withFacts` with the notes, and for that flag's own argument rather than because these
    // are facts in the enrichment sense: they are MATERIAL, and "a model handed a list of material
    // will find a way to read the material out" is exactly as true of a year as of a discography
    // note. A bulletin's job is the stories.
    //
    // Each one absent rather than blank when the order does not know it. See `BreakTrack`, and the
    // weather describer below, which states the rule this follows: a model given "Wind: —" fills
    // it in.
    //
    // Tested for EMPTINESS and not merely for `undefined`, which is the bug this shipped with. An
    // item with nothing in a text column carries the empty string rather than `undefined` — the
    // builder in `write.break.job.ts` says so one line above where it hands these over, and uses
    // `||` on the artist for exactly this reason. An `- Album: ` with nothing after it is the blank
    // field this comment promises never to draw, and the station aired the consequence: "Justin
    // Timberlake's first solo single from his album ." A zero year or a zero length is the same
    // claim in numbers and is dropped on the same test.
    if (withFacts) {
        if (track.year) lines.push(`- Year: ${track.year}`);
        if (track.album?.trim()) lines.push(`- Album: ${track.album.trim()}`);
        if (track.durationMs) lines.push(`- Length: ${spokenLength(track.durationMs)}`);
    }
    if (withFacts && track.facts && track.facts.length > 0) lines.push('- Notes:', ...track.facts.map(fact => `  - ${fact}`));
    return lines.join('\n');
}

/**
 * A length in words rather than in milliseconds.
 *
 * Minutes and seconds because this is something to TALK about — a record that goes on too long is a
 * subject — where the stored figure is a measurement. A model handed `401000` either reads it out or
 * divides it, and one of those is worse than the other.
 *
 * The two special cases are the ones a bare "6 minutes 0 seconds" gets wrong out loud.
 */
function spokenLength(durationMs: number): string {
    const total = Math.max(0, Math.round(durationMs / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;

    if (minutes === 0) return `${seconds} seconds`;
    if (seconds === 0) return `${minutes} minutes`;
    return `${minutes} minutes ${seconds} seconds`;
}

/**
 * One story, as the model is shown it.
 *
 * The headline first and on its own line, because it is the most reliable statement of what
 * happened: a published sentence somebody else already stands behind. That is what makes it good
 * SOURCE and it is also what used to make it bad copy — this doc said it "may be read more or less
 * as it stands", the rules beside it asked for a sentence of explanation underneath, and between
 * them they specified the headline-then-restatement that 42 of 104 aired bulletins came back as.
 * Both labels are the model's material now, and neither is a line to read out; the rule beside this
 * is what says so.
 *
 * The article where there is one and the teaser otherwise, never both: they overlap almost entirely
 * (a teaser is usually the article's own first sentence), and showing a model the same fact twice
 * under two labels is how one sentence gets read out as two stories.
 */
function describeStory(story: BreakStory): string {
    const lines = [`- Headline: ${story.headline}`];
    const told = story.body ?? story.summary;
    if (told) lines.push(`  Story: ${told}`);
    // Deliberately not offered as something to say. Attribution is a station's own decision — some
    // read it, some never do — and a model shown a publisher's name will credit it in a sentence
    // the operator never asked for.
    return lines.join('\n');
}

/**
 * The reading, as the model is shown it.
 *
 * A labelled list rather than the sentence the floor writes, because the point of a model here is
 * that it phrases the figures itself. What it must not do is INVENT one, which is why every line
 * carries its unit and why a measurement the service did not report is simply absent rather than
 * shown as a blank — a model given "Wind: —" will fill it in.
 *
 * The units are stated once, at the top, rather than on every line: they are already the station's
 * own, converted before this file ever saw them, and a model told the unit three times starts saying
 * it out loud.
 */
function describeWeather(weather: SpokenWeather): string {
    const degrees = weather.units === 'imperial' ? 'Fahrenheit' : 'Celsius';
    const speed = weather.units === 'imperial' ? 'miles per hour' : 'kilometres per hour';

    const lines = [
        `The weather in ${weather.place}, right now. Temperatures are in ${degrees} and wind in ${speed}; say the numbers as they are written.`,
        `- Sky: ${weather.current.words}${weather.current.description === undefined ? '' : ` (${weather.current.description})`}`,
    ];

    if (weather.current.temperature !== undefined) lines.push(`- Temperature: ${weather.current.temperature}`);
    if (weather.current.feelsLike !== undefined) lines.push(`- Feels like: ${weather.current.feelsLike}`);
    if (weather.current.wind !== undefined) lines.push(`- Wind: ${weather.current.wind}`);
    if (weather.current.humidity !== undefined) lines.push(`- Humidity: ${weather.current.humidity}%`);

    for (const [index, day] of (weather.days ?? []).entries()) {
        // Named as "today" and "tomorrow" rather than by date, because that is what a presenter says
        // and because a model handed `2026-08-31` will read the date out.
        const when = index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : day.date;
        const figures = [
            day.high === undefined ? undefined : `high ${day.high}`,
            day.low === undefined ? undefined : `low ${day.low}`,
            day.precipitationChance === undefined ? undefined : `${day.precipitationChance}% chance of rain`,
        ].filter(part => part !== undefined);

        lines.push(`- ${when}: ${[day.words, ...figures].join(', ')}`);
    }

    return lines.join('\n');
}

/**
 * How many words of a script count as its opening.
 *
 * Four, which is what the two observed failures need between them: an exclamation is one word
 * ("Yikes!") and a run-up is a clause ("Deadair's next spin is"). Fewer than four would name the
 * first of those and miss the second, which is the one a listener notices, since a repeated
 * exclamation at least varies afterwards where a repeated run-up does not.
 */
const OPENING_WORDS = 4;

/** How many openings are named. Enough to show a habit; short enough to stay one sentence. */
const MAX_OPENINGS = 4;

/**
 * How a script begins, as the words a listener would hear before the first breath.
 *
 * The leading clause rather than a fixed count, so "Yikes!" is named as itself rather than as
 * "Yikes! Ozzy's Bark at the" — a model told not to start with the second learns nothing, because it
 * was never going to say that again anyway.
 */
function openingOf(script: string): string | undefined {
    const clause = script.trim().split(/[,;:.!?—–]/, 1)[0] ?? '';
    const words = clause.trim().split(/\s+/).filter(Boolean).slice(0, OPENING_WORDS);
    return words.length === 0 ? undefined : words.join(' ');
}

/**
 * The traits this character has grown into, as system-prompt lines.
 *
 * Rendered in `personaLines`' own register — a clause list under one heading, not a bulleted table —
 * because these sit inside the sheet's block and a change of shape halfway through it would read as
 * a change of subject. Empty in, empty out, which is what keeps a prompt with no notebook identical
 * to one built before the notebook existed.
 *
 * Named as things the character HAS DONE rather than as instructions, deliberately. A trait is an
 * observation the station made about itself and the sheet above it is already a list of rules; a
 * second imperative list would compete with the first, and what a model does with two sets of orders
 * is hedge between them. This is the same reason a persona REPLACES the role sentence rather than
 * queueing behind it.
 */
function traitLines(notes: PersonaNotesForPrompt | undefined): string[] {
    const traits = (notes?.trait ?? []).map(trait => trait.trim()).filter(trait => trait.length > 0);
    if (traits.length === 0) return [];

    return [`Things you have settled into on this station: ${traits.join(' ')}`];
}

/**
 * The character's own story, as the user turn shows it — or nothing at all.
 *
 * Empty when the shape carries no stories, or when the caller sent none — and the second of those is
 * where the character's own rung was already applied, beside the stamp that rests it. See
 * {@link BreakPromptShape.stories}.
 *
 * ## Two things it must say, and they pull in opposite directions
 *
 * It has to be USABLE — a model that treats an anecdote as background it must not touch has been
 * handed nothing — and it has to be FENCED, because the failure this feature can produce is worse
 * than the one it fixes: a story hung off a discography is the station stating an invented fact
 * about a real record in the voice it uses for true ones. So the story is framed as something that
 * happened to YOU, and the fence is stated as what a story is not rather than as a prohibition on
 * mentioning it.
 *
 * ## Offered, in the words the notes are offered in
 *
 * "Work at most one of them in" read as an instruction to work one in, which is why the notes rule
 * says "You do not have to use any of them" in as many words. A story is that hazard one size
 * larger, since it is the most interesting thing in the prompt by a distance. Under `told` the
 * optionality goes, because there the story IS the break and a presenter who declined to tell it
 * would be a break about nothing.
 */
function storyLines(settings: PromptSettings, shape: BreakPromptShape): string[] {
    const story = settings.story;
    if (shape.stories === undefined || story === undefined) return [];

    const lines = [
        shape.stories === 'told'
            ? 'Something that happened to you, and what this break is for. Tell it:'
            : 'Something that happened to you, which you could tell if this moment gives you a reason to:',
        story.story,
        // The details are the half that makes a story worth keeping in a table rather than on a
        // sheet: they arrived one at a time, and a telling that uses one is a telling nobody has
        // heard. Shown as things the character also remembers rather than as a list to include,
        // which is the played-list block's own wording and for its measured reason.
        ...(story.details.length === 0 ? [] : ['You also remember:', ...story.details.map(detail => `- ${detail}`)]),
    ];

    // Only where it has actually gone out. A story told for the first time needs no warning, and a
    // rule about a thing that has not happened is a rule about nothing — the same reason the notes
    // rule is withheld from a prompt carrying no notes.
    if (story.timesTold > 0) {
        lines.push(
            'You have told this on air before, so a regular listener may know it. Tell it the way somebody tells a story twice: shorter, ' +
                'or from a different end of it, or for the one detail that is new.',
        );
    }

    lines.push(
        shape.stories === 'told'
            ? 'It happened to you and it is yours to tell. It is not a fact about any record: do not attach it to what is playing, do not ' +
                  'present it as something the station knows, and do not turn it into a claim about anybody real.'
            : 'You do not have to mention it, and most breaks are better without it. If you do, it happened to YOU — it is not a fact ' +
                  'about either record, so do not attach it to one, do not present it as something the station knows, and never let it ' +
                  'become a claim about the music you cannot back up.',
    );

    return [lines.join('\n')];
}

/**
 * The openings the station has just used, deduplicated, most recent first.
 *
 * Deliberately every recent opening rather than only the repeated ones: a habit is visible at two
 * and this list is at most six long, so waiting for a repeat means naming a phrase only after it has
 * already gone out twice. Deduplicated case-insensitively, because a model that opened with "Yikes"
 * and "yikes!" has one habit and telling it about two reads as noise.
 */
export function spentOpenings(recent: readonly string[] | undefined): string[] {
    if (recent === undefined) return [];

    const out: string[] = [];
    const seen = new Set<string>();
    for (const script of recent) {
        const opening = openingOf(script);
        if (opening === undefined) continue;

        const key = opening.toLowerCase();
        if (seen.has(key)) continue;

        seen.add(key);
        out.push(opening);
        if (out.length >= MAX_OPENINGS) break;
    }
    return out;
}

/**
 * How many recent breaks a word has to appear in before it counts as a habit.
 *
 * A share rather than a count, because `recent` is a window whose length is the caller's business
 * and a fixed number would mean something different at three scripts than at six. Half is where a
 * word stops being a word this character uses and starts being the word it always uses.
 */
const WORN_SHARE = 0.5;

/**
 * The fewest recent breaks worth judging a habit from.
 *
 * Three. Below it every content word in the window trivially clears the share above — a single
 * script makes each of its own words 100% — and the station would open every second break by
 * complaining about a word it had said once.
 */
const WORN_MIN_SCRIPTS = 3;

/** How many worn words are named. Enough to break the habit, short enough to stay one sentence. */
const MAX_WORN_WORDS = 5;

/**
 * The shortest word that can be a tic.
 *
 * Four, which is doing a job the stop list below cannot: English's function words are mostly short,
 * and a length floor removes almost all of them for free without anybody having to enumerate them.
 */
const MIN_WORN_LENGTH = 4;

/**
 * Words that mean nothing about a presenter's habits, however often they appear.
 *
 * Deliberately short, and deliberately only the structural ones. The temptation is to grow this
 * until nothing embarrassing gets named, and that would be the wrong direction: "like" and "still"
 * are exactly the tics a presenter develops, and a list long enough to be safe would be long enough
 * to catch nothing. What is here is grammar rather than vocabulary — words a sentence needs and a
 * character cannot be blamed for.
 */
const NOT_A_HABIT = new Set([
    'that',
    'this',
    'with',
    'from',
    'they',
    'them',
    'then',
    'than',
    'have',
    'been',
    'were',
    'will',
    'your',
    'yours',
    "you're",
    'about',
    'into',
    'onto',
    'over',
    'under',
    'what',
    'when',
    'where',
    'which',
    'while',
    'there',
    "there's",
    "that's",
    "it's",
    'here',
    "here's",
    'some',
    'more',
    'most',
    'much',
    'very',
    'been',
    'does',
    'each',
    'both',
    'also',
    'came',
    'come',
    'goes',
    'went',
]);

/**
 * The words this presenter has said in nearly every recent break.
 *
 * Counted as the number of SCRIPTS a word appears in rather than as a raw frequency, and that is the
 * whole measurement: a word said four times in one break is a sentence with a rhythm problem, and a
 * word said once in each of six breaks is a habit. Only the second is what a listener hears as the
 * station repeating itself.
 *
 * Ordered by how widespread the habit is, so the most worn word is named first and the sentence
 * degrades gracefully when it is cut at {@link MAX_WORN_WORDS}.
 */
export function overusedWords(recent: readonly string[] | undefined): string[] {
    const scripts = (recent ?? []).filter(script => script.trim().length > 0);
    if (scripts.length < WORN_MIN_SCRIPTS) return [];

    const appearances = new Map<string, number>();
    for (const script of scripts) {
        // Distinct per script, so four uses in one break count once. See the note above.
        for (const word of new Set(bareWords(script).split(' '))) {
            if (word.length < MIN_WORN_LENGTH || NOT_A_HABIT.has(word)) continue;
            appearances.set(word, (appearances.get(word) ?? 0) + 1);
        }
    }

    const floor = Math.max(WORN_MIN_SCRIPTS, Math.ceil(scripts.length * WORN_SHARE));
    return [...appearances.entries()]
        .filter(([, count]) => count >= floor)
        .sort(([leftWord, left], [rightWord, right]) => right - left || leftWord.localeCompare(rightWord))
        .slice(0, MAX_WORN_WORDS)
        .map(([word]) => word);
}

/** Whether either record came with anything to say about it. */
const hasFacts = (previous: BreakTrack | undefined, next: BreakTrack | undefined): boolean =>
    (previous?.facts?.length ?? 0) > 0 || (next?.facts?.length ?? 0) > 0;

/**
 * The record a script actually named, or `undefined` when it named none of them.
 *
 * Generous on purpose, and the generosity is the design rather than a weakness. What this is
 * catching is a break that mentions no record whatsoever — thirty-nine were measured and roughly
 * three quarters were that — and NOT a break that got a title slightly wrong. A strict comparison
 * here would refuse a presenter calling "(Don't Fear) The Reaper" the Reaper, which is what a
 * presenter calls it, and every refusal costs the station the model's sentence.
 *
 * So a record counts as named when the script carries its title, its title with any parenthetical
 * taken off, or the artist's name. Compared as bare words for {@link echoedSample}'s reason: a curly
 * apostrophe, a capital and a comma are not the difference between naming a record and not.
 */
export function namedRecordIn(script: string, records: readonly (BreakTrack | undefined)[]): BreakTrack | undefined {
    const spoken = ` ${bareWords(script)} `;

    return records.find(record => record !== undefined && identifiersOf(record).some(candidate => saysName(spoken, candidate)));
}

/**
 * Whether some bare words name a record, counting the possessive as the name.
 *
 * **"Iron Maiden's Run to the Hills" is how a presenter names a record**, and `bareWords` keeps the
 * apostrophe, so a plain `" iron maiden "` search never matches it: what is in the text is
 * `iron maiden's`. {@link misCuedIn} worked this out for itself and handled it inline; the check
 * above did not, and the two have been disagreeing about what naming a record means ever since.
 *
 * Measured on the live station, on every break it has ever refused for naming neither of the records
 * it was shown: of 51, only 8 genuinely named neither. **27 of the remaining 43 named a record in
 * the possessive** and were refused for it — "Bon Jovi's debut single, Runaway", "The Smashing
 * Pumpkins' Bullet with Butterfly Wings", "Megadeth's Hangar 18" — which makes this the single
 * largest cause of that refusal, ahead of anything about a persona sheet.
 *
 * Both endings, because English has two: `'s` for the singular and a bare `'` after a plural, and a
 * roster of bands is full of the second. One helper for both callers so they cannot drift apart
 * again, which is the whole reason this is not two inline expressions.
 */
const saysName = (spoken: string, candidate: string): boolean =>
    spoken.includes(` ${candidate} `) || spoken.includes(` ${candidate}'s `) || spoken.includes(` ${candidate}' `);

/**
 * The words that identify one record in a script: its title, its title with any aside taken off,
 * and its artist.
 *
 * The parenthetical is stripped as an ALTERNATIVE rather than instead: "Pink Moon" has none and is
 * unaffected, and a title that is entirely parenthetical falls back to the whole thing. Compared as
 * bare words for {@link echoedSample}'s reason: a curly apostrophe, a capital and a comma are not
 * the difference between naming a record and not.
 */
const identifiersOf = (record: BreakTrack): string[] =>
    [record.title, record.title.replace(/\([^)]*\)/g, ' '), record.artist].map(bareWords).filter(candidate => candidate.length > 0);

/**
 * How many words after a cue phrase still count as part of the cue.
 *
 * Eight, which covers "that was Iron Maiden's Run to the Hills" with room to spare and stops well
 * short of the next sentence. A window is what keeps this a check on the CUE rather than on the
 * whole break: a script may perfectly well back-announce one record and then mention the other
 * later, and only the words attached to the frame say which one it is claiming played.
 */
const CUE_WINDOW_WORDS = 8;

/**
 * The ways a script says a record has just played, as bare words.
 *
 * Deliberately the plain ones. A frame nobody writes catches nothing, and a frame that is ordinary
 * English somewhere else ("that's the thing about b-sides") costs a refusal only if the WRONG
 * record's name is sitting right behind it, which is the whole of what makes this safe.
 */
const BACK_ANNOUNCE_FRAMES = ['that was', "that's", 'that is', 'those were', 'you just heard', 'we just heard', 'you were listening to'];

/** The ways a script says a record is still to come. Same doctrine as {@link BACK_ANNOUNCE_FRAMES}. */
const FORWARD_FRAMES = ['coming up', 'next up', 'up next', 'next is', "here's", 'here comes', 'coming your way', 'stay tuned for'];

/** The two records a break sits between, so a cue can be judged against the right one. */
export interface BreakCues {
    previous?: BreakTrack;
    next?: BreakTrack;
}

/**
 * Whether a script cued a record on the WRONG SIDE of the break.
 *
 * ## The failure
 *
 * Measured on air on 19 August, segment `e26a93f0`, labelled `Talk break: Madhouse into Run to the
 * Hills`: the script opened "That was Iron Maiden's "Run to the Hills," …" about the record that had
 * not played yet. Every existing check passed it — it is unmistakably the persona speaking, it is
 * inside the ceiling, and {@link namedRecordIn} is satisfied because it named a record it was shown.
 * Nothing asked WHICH side of the boundary that record was on.
 *
 * The prompt was never the problem: the two records are labelled "The record that has just finished"
 * and "The record coming up next" in as many words. This is the same shape as the persona
 * prohibitions — a rule the station was already sending and nothing was reading back — and the same
 * shape as the failure this whole file is built around, which the header states as framing real
 * facts as a CUE. The framing was banned there and is now checkable here.
 *
 * ## Why it refuses so narrowly
 *
 * Only where BOTH records are known, because with one record there is no wrong side to confuse it
 * with, and the prompt already tells a one-record break not to say what is coming up. Only where the
 * name is attached to a frame, within {@link CUE_WINDOW_WORDS}. Only where the name is UNAMBIGUOUS —
 * an identifier the two records share (two songs by one artist, a self-titled record) is dropped
 * from both, so "that was Megadeth" going into more Megadeth is not a fault. And never where the
 * RIGHT record is named in the same window too, since "that was Madhouse, and now Run to the Hills"
 * is a correct double cue and reads as one only if both are counted.
 *
 * Every one of those is the same bargain the rest of the guards here are on: a refusal costs the
 * station the model's sentence and drops it to the floor, so this refuses only what it is sure of.
 */
export function misCuedIn(script: string, cues: BreakCues): boolean {
    const { previous, next } = cues;
    if (previous === undefined || next === undefined) return false;

    const words = bareWords(script).split(' ').filter(Boolean);

    // Shared identifiers dropped from BOTH sides: they cannot tell the two records apart, so a match
    // on one is not evidence of anything. See the note above about two songs by one artist.
    const shared = new Set(identifiersOf(previous).filter(one => identifiersOf(next).includes(one)));
    const namesIn = (from: number, record: BreakTrack): boolean => {
        const window = ` ${words.slice(from, from + CUE_WINDOW_WORDS).join(' ')} `;

        // The possessive counted as the name, because "Iron Maiden's Run to the Hills" is how a
        // presenter says it and a check that missed it would catch only half the failure. Through
        // {@link saysName} rather than inline, which is where this argument was worked out once and
        // then not applied to `namedRecordIn` — see the note there for what that cost.
        return identifiersOf(record)
            .filter(one => !shared.has(one))
            .some(one => saysName(window, one));
    };

    const cued = [
        { frames: BACK_ANNOUNCE_FRAMES, wrong: next, right: previous },
        { frames: FORWARD_FRAMES, wrong: previous, right: next },
    ];

    return cued.some(({ frames, wrong, right }) =>
        frames.some(frame => {
            const size = frame.split(' ').length;

            return words.some(
                (_, at) =>
                    at + size <= words.length &&
                    words.slice(at, at + size).join(' ') === frame &&
                    namesIn(at + size, wrong) &&
                    !namesIn(at + size, right),
            );
        }),
    );
}

/** A text as bare lower-case words, so a title and a script can be compared as speech, not as text. */
const bareWords = (text: string): string =>
    // A reaction comes out FIRST, or the brackets are stripped off it and `[laugh]` becomes the word
    // "laugh" for all three callers. Each would be wrong in its own way: `overusedWords` would tell a
    // station that laughs regularly it has a verbal tic, and the two matchers would find a word the
    // presenter never said. This is the one place all three agree on what a word is.
    withoutPads(withoutCues(text))
        .toLowerCase()
        .replace(/[‘’ʼ′]/g, "'")
        .replace(/[^a-z0-9']+/g, ' ')
        .trim();

/** What a model's answer has to survive to become a script. */
export interface AnswerGuard {
    /**
     * The ceiling this answer is refused past, defaulting to {@link DEFAULT_MAX_WORDS}.
     *
     * **Build it with {@link maxWordsFor}, from the same settings the prompt was built from.** A
     * persona's latitude moves this and the number the model was told together, and they are the
     * only two places the ceiling exists. See that function for what disagreeing costs.
     */
    maxWords?: number;
    /**
     * The character it was asked to write in, checked against what came back.
     *
     * A sheet that named no markers, no samples, no catchphrases and no forbidden wording makes no
     * checkable claim and so passes everything. See {@link characterFault}.
     */
    persona?: PersonaSheet;
    /**
     * Whether that character's DIALECT is required of the answer, or only its prohibitions.
     *
     * `required` by default, which is every kind of break whose job is voice. A bulletin passes
     * `optional`, and {@link CharacterContext.dialect} carries the whole argument for why one kind
     * gets to be plain while still being held to what the sheet forbids.
     */
    dialect?: CharacterContext['dialect'];
    /**
     * The last few things the station said, exactly as the prompt was shown them.
     *
     * Read only to decide which signature phrases are spent, and it has to be the same list the
     * prompt carried: a script refused for a repetition it was never warned about is the trick
     * question the markers used to be, and the whole bargain here is that the station asks for
     * something before it refuses a script for not doing it.
     */
    recent?: readonly string[];
    /**
     * The records this break was shown, at least one of which it has to name.
     *
     * Empty or absent means the question is not asked, which covers every kind whose shape does not
     * set {@link BreakPromptShape.mustNameRecord} and every moment that had no record to show — the
     * top of an order, and every welcome. A break cannot be refused for failing to name something it
     * was never given, which is the same bargain the markers and the spent signatures are on.
     */
    names?: readonly (BreakTrack | undefined)[];
    /**
     * The two records this break sits BETWEEN, so a cue can be judged against the right one.
     *
     * Separate from {@link AnswerGuard.names}, which is a flat list because the question it asks —
     * did this break name anything at all — does not care which side a record is on. This one is
     * only about the sides, so it needs them kept apart. Absent means the question is not asked, and
     * {@link misCuedIn} asks nothing unless both are present.
     */
    cues?: BreakCues;
    /**
     * The half of the day this break was told it was speaking in.
     *
     * The same `RoughTime` the prompt was built from, on {@link AnswerGuard.recent}'s bargain: the
     * station asks before it refuses. Absent means the question is not asked, which covers a break
     * whose row carried no `airs_at` — and that used to be every ordinary talk break, which is the
     * bug this exists downstream of rather than the state it is designed for.
     *
     * See {@link contradictsDayPart} for why it is judged at the resolution of light-and-dark rather
     * than word for word.
     */
    dayPart?: RoughTime;
    /**
     * When this break airs and where the station is, for the half of the same question a stretch
     * cannot answer.
     *
     * {@link AnswerGuard.dayPart} carries the words and their window; this carries the INSTANT, which
     * is what {@link namesWrongTimeOfDay} needs to judge a word naming a point in the day rather than
     * a half of it — "midday" is `afternoon` at ten past twelve and `afternoon` at half past four,
     * and only one of those is a break worth airing. Both come off the same `airs_at`, in the same
     * place, so a break judged by one is judged by the other.
     *
     * Absent asks nothing, exactly as an absent `dayPart` does and for the same reason.
     */
    moment?: { at: number; zone: string };
    /**
     * The pads this break was offered, which are the only `[sfx:…]` runs its script may keep.
     *
     * The same list the prompt was built from, on {@link AnswerGuard.recent}'s bargain: the station
     * asks for something before it judges a script by it. Absent means none were offered, which
     * takes every pad hit out — the right answer for a character with no board, and for a kind of
     * break that does not allow one.
     */
    pads?: readonly string[];
}

/**
 * A model's answer, tidied into something speakable, or nothing.
 *
 * Everything here is a thing a model does that a listener would hear as wrong rather than as
 * creative: a script wrapped in quotation marks, a `[warmly]` at the front, a `DJ:` label, a
 * paragraph where a link was asked for. Cheap to strip and impossible to un-hear.
 *
 * Answers `undefined` when what is left is not worth speaking, which the registry treats as this
 * writer having declined — and the floor underneath then says something correct instead.
 */
export function readAnswer(text: string, guard: AnswerGuard = {}): string | undefined {
    const tidied = tidyAnswer(text, guard);
    if (tidied === undefined) return undefined;

    // The ceiling, which CUTS at a sentence and declines only what cannot be cut at one. Everything
    // below judges what comes back from this rather than what the model sent, because the fitted
    // script is the one that airs and judging the other would be judging words nobody will hear.
    const script = fitToCeiling(tidied, guard);
    if (script === undefined) return undefined;

    // Every check below judges the WORDS, so a reaction comes out first and the cued script is what
    // is returned. It matters in three different ways and none of them is cosmetic: `runsLong`
    // splits on whitespace, so `[laugh]` would spend one of a break's forty words; `overusedWords`
    // counts the scripts a word appears in, so a station that laughs often would be told it has a
    // verbal tic; and `namedRecordIn` would be handed a token no record can ever match.
    // A pad comes out with them, and for all three of the same reasons: it would spend one of a
    // break's forty words, teach `overusedWords` that this station has a verbal tic called "sfx", and
    // hand `namedRecordIn` a token no record can match.
    const words = withoutPads(withoutCues(script));

    // A break about no record in particular. Checked BEFORE the character, because the two faults
    // want opposite things done about them and this one is the more basic: a script that named
    // nothing is wrong however well it is written, and reporting it as out-of-character would send
    // an operator to the persona page for a fault the prompt caused. See `namesNothing`.
    if (namesNothing(words, guard)) return undefined;

    // A break that named a record it was shown and then put it on the wrong side of itself: "that
    // was" about the record still to come. Checked here, in the same position `writeDecline` checks
    // it, because these two orders have to stay the same story — the note on `tidyAnswer` says why.
    // See `misCuedIn` for how narrowly it refuses.
    if (cuesWrongly(words, guard)) return undefined;

    // A break that called the afternoon "tonight". Beside the cue check because it is the same kind
    // of wrongness — a statement about the moment that a listener can check against their own window
    // — and above the character check for the reason that one sits below the others: being out of
    // character is a question worth asking only about a script the station could otherwise say.
    if (wrongDayPartIn(words, guard) !== undefined) return undefined;

    // A correct sentence that is not this character speaking, which is the failure a persona is
    // asked for and the one a model handed a page of content rules actually makes — in flat plain
    // English, in a lifted sample line, in a signature the station used four records ago, or in
    // wording the sheet forbids. Declined rather than re-drafted: the floor underneath speaks in
    // the same character, so the station gets an in-character line at once instead of paying for a
    // second generation to maybe get one.
    if (faultIn(words, guard) !== undefined) return undefined;

    return script;
}

/**
 * The tidying half of {@link readAnswer}: an answer as speakable words, or nothing.
 *
 * Split out so {@link writeDecline} can tell an answer that was empty from one that was too long
 * without re-running the checks in a different order and reporting something that did not happen.
 */
const tidyAnswer = (text: string, guard: AnswerGuard = {}): string | undefined =>
    speakableScript(text, { perform: PRESENTER_CUES, pads: guard.pads ?? [] });

/**
 * How much of a run-long script is worth keeping before it stops being one.
 *
 * A trim keeps the words in FRONT of the overrun, which is the whole argument for trimming at all:
 * the model made its point and then kept talking. Where the first sentence is most of the ceiling on
 * its own that reading no longer holds — what survives is an opening clause rather than a break, and
 * the floor's own phrasing says something whole instead. Half is a judgement rather than a
 * measurement; every trim this was built from kept between 86 and 91 words of a hundred.
 */
const MIN_KEPT_SHARE = 0.5;

/**
 * A tidied script cut to the guard's ceiling at a sentence boundary, or nothing.
 *
 * A cut rather than a refusal, which is a reversal and was measured rather than reasoned: of the six
 * answers this station has ever refused for length, every one made its point and then padded, and
 * every one of the tails thrown away was of the "make of that what you will" kind. So what the
 * ceiling used to discard was the good eighty words in front of the padding.
 *
 * The original argument survives in what this still refuses. Cutting a script MID-SENTENCE is worse
 * to air than the floor's correct line, so a single sentence that runs past the ceiling on its own is
 * declined exactly as before — `sentencesWithin` has no word-cut fallback for that reason — and so is
 * a trim so short it is no longer the break the model wrote. What is gone is only the claim that a
 * long answer means a misunderstood job.
 */
function fitToCeiling(script: string, guard: AnswerGuard): string | undefined {
    const ceiling = guard.maxWords ?? DEFAULT_MAX_WORDS;
    // The ordinary case, and it has to be answered before the share floor below: a break the model
    // kept to twelve words was never trimmed and must not be refused for being short.
    if (wordsIn(script) <= ceiling) return script;

    const fitted = sentencesWithin(script, ceiling);
    if (fitted === undefined) return undefined;

    return wordsIn(fitted) < ceiling * MIN_KEPT_SHARE ? undefined : fitted;
}

/**
 * How long a script is, on the one definition the ceiling is counted in.
 *
 * A reaction is not a word. `[laugh]` is a whitespace-separated token and would otherwise spend one
 * of a break's forty, which is small until it is the one that tips a good script over the ceiling —
 * and a break refused for length it did not have is the exact failure the ceiling was measured to
 * avoid. Counted here rather than at each caller so the trim and the refusal cannot disagree.
 */
const wordsIn = (script: string): number => withoutCues(script).split(/\s+/).filter(Boolean).length;

/**
 * Whether a script was shown records and named none of them.
 *
 * A guard carrying no records asks nothing, which is what makes this safe to apply to every kind: a
 * welcome and a bulletin simply never populate {@link AnswerGuard.names}, and a link at the top of
 * an order with nothing either side of it populates it with nothing.
 */
const namesNothing = (script: string, guard: AnswerGuard): boolean => {
    const offered = (guard.names ?? []).filter(record => record !== undefined);
    return offered.length > 0 && namedRecordIn(script, offered) === undefined;
};

/** Whether a script cued one of its records on the wrong side. See {@link misCuedIn}. */
const cuesWrongly = (script: string, guard: AnswerGuard): boolean => guard.cues !== undefined && misCuedIn(script, guard.cues);

/**
 * Whether a script named a half of the day that cannot be the one it was told.
 *
 * A guard with no daypart asks nothing, exactly as {@link namesNothing} asks nothing of a break that
 * was shown no records — and the reason is the same bargain: the prompt has to have said so before
 * the script can be refused for contradicting it.
 *
 * The measurement behind refusing at all is in {@link contradictsDayPart}. The short version is that
 * the prompt asks and is obeyed most of the time, and the times it is not are all the same word.
 *
 * Two questions rather than one, because a daypart is a STRETCH and some words a break reaches for
 * name a point inside one — "midday" is the afternoon at ten past twelve and still the afternoon at
 * half past four, so no comparison of stretches will ever separate them. See
 * {@link namesWrongTimeOfDay}. They share this predicate, and through it the `wrong-daypart` fault
 * and its sentence, because they are the same thing to a listener: the station saying what time it
 * is and being wrong.
 *
 * ## It answers the WORD, and that is the whole of why it is not a boolean
 *
 * Both checks already know which word they caught, and this threw it away for as long as it returned
 * `true`. What that cost is a question nobody could answer from the record: `contradictsDayPart` can
 * only ever fire on four strings — `tonight`, `this morning`, `this afternoon`, `this evening` — and
 * "which of the four, how often" is the difference between a sheet with one habit and a model with a
 * general problem. On the live station `conspiracy` sent a third of its breaks to the floor for
 * months with this fault among the leaders, and finding out which word did it meant reading raw
 * answers by hand, one at a time, only while `llm.captureWrites` happened to be on.
 *
 * The word reaches `script_history.reason` through {@link writeDecline}, so `scripts/break.declines.ts`
 * splits the fault by word with no change of its own: it groups on the reason string.
 */
const wrongDayPartIn = (script: string, guard: AnswerGuard): string | undefined =>
    contradictsDayPart(script, guard.dayPart) ?? namesWrongTimeOfDay(script, guard.moment?.at, guard.moment?.zone);

/**
 * Why a cleaned script is not the persona speaking, or `undefined` when it is.
 *
 * The same judgement {@link readAnswer} makes, exported so a writer can log WHICH of the four faults
 * it was without re-deriving it and drifting from what actually happened. A guard carrying no
 * persona answers `undefined`: a station that made no claim, rather than one that passed.
 */
export function faultIn(script: string, guard: AnswerGuard): CharacterFault | undefined {
    if (guard.persona === undefined) return undefined;

    return characterFault(guard.persona, script, {
        ...(guard.recent === undefined ? {} : { recent: guard.recent }),
        ...(guard.dialect === undefined ? {} : { dialect: guard.dialect }),
    });
}

/**
 * What an operator should go and change, per fault.
 *
 * Four sentences rather than one, because the four are not variations on "the model missed": a spent
 * signature is the station working exactly as designed and wants nothing done about it, a quoted
 * sample is a sheet whose examples are too magnetic for the model in front of them, forbidden
 * wording is worth reading a capture for, and a flat plain-English line is markers or diction wanting
 * work. Only the last two are usually a fault of the sheet at all.
 */
const FAULT_REASONS: Record<WriteFault, string> = {
    'nothing-said': 'the model answered with nothing the station could say',
    'ran-long':
        'the model wrote past the word ceiling with nothing whole to keep short of it, and a script cut mid-sentence is worse than the phrasing underneath it',
    'named-nothing': 'the model wrote a break about neither of the records it was shown, so a listener could not tell what was playing',
    'cued-wrong': 'the model announced a record on the wrong side of the break, telling a listener something had played when it had not',
    'wrong-daypart': 'the model called it the wrong half of the day, which a listener hears immediately and the station cannot take back',
    'quoted-sample': 'the model read one of the persona’s own sample lines back rather than writing in its voice',
    'spent-catchphrase': 'the model reached for a signature the station had just used',
    'avoided-wording': 'the model used wording the persona forbids',
    'out-of-character': 'the model wrote a line the station could say, but not in its own voice',
};

/**
 * Every way an answer can be refused: the four character faults, plus the two that come first.
 *
 * The two are separated because they want opposite things done about them and the row could not tell
 * them apart: a 203-word bulletin was reported as the model having "nothing to say here", which sent
 * an operator looking at a persona sheet for a ceiling that was in the way of a bulletin the prompt
 * had asked for.
 */
export type WriteFault = CharacterFault | 'nothing-said' | 'ran-long' | 'named-nothing' | 'cued-wrong' | 'wrong-daypart';

/**
 * Why a raw answer was refused, for a writer that wants to say so, or `undefined` when it was not.
 *
 * In {@link readAnswer}'s own order, which is what makes the reason the thing that actually happened
 * rather than the first thing this function happened to test: an empty answer is never a character
 * problem, and a script the station was never going to say is not worth asking whether it was in
 * character.
 *
 * It answers with the sentence as well as the fault because both destinations matter and neither is
 * the other: the fault is what a log line can be counted by, and the sentence is what reaches
 * `script_history.reason` and a person reading the console. Deriving them in one place is what stops
 * the row and the log disagreeing about the same break.
 */
export function writeDecline(text: string, guard: AnswerGuard): { fault: WriteFault; reason: string } | undefined {
    // `said` names the wording that actually caused it, for the one fault whose sentence cannot be
    // acted on without it. The rest are already specific: a break that named no record, or ran long,
    // or read a sample back, tells an operator where to look on its own. "The wrong half of the day"
    // does not — the fix for a model reaching for `tonight` in the morning is not the fix for one
    // saying `teatime` at ten, and the row could not tell them apart.
    //
    // Appended to the sentence rather than carried beside it, because the sentence is the thing that
    // reaches BOTH destinations already: `script_history.reason` and, through the writers, the log
    // line's own message. A second field would have to be threaded through five writers to arrive
    // where this arrives for nothing. It splits the fault into one row per word in
    // `scripts/break.declines.ts`, which groups on the reason and is the report this is for.
    const reasoned = (fault: WriteFault, said?: string) => ({
        fault,
        reason: said === undefined ? FAULT_REASONS[fault] : `${FAULT_REASONS[fault]}: it said "${said}"`,
    });

    const tidied = tidyAnswer(text, guard);
    if (tidied === undefined) return reasoned('nothing-said');

    // The same cut in the same position, and everything below reads what came back from it. A trim
    // is not a decline, so a script this shortens goes on to be judged like any other — which is the
    // half that keeps the two functions one story: `readAnswer` airs the fitted words, so those are
    // the words this has to be able to refuse.
    const speakable = fitToCeiling(tidied, guard);
    if (speakable === undefined) return reasoned('ran-long');

    if (namesNothing(speakable, guard)) return reasoned('named-nothing');
    // After naming and before character, which is where it belongs in the narrative this order is:
    // a break that named nothing has not got as far as cueing anything wrongly, and a break that
    // told the listener the wrong record played is not worth asking whether it did so in voice.
    if (cuesWrongly(speakable, guard)) return reasoned('cued-wrong');
    const daypart = wrongDayPartIn(speakable, guard);
    if (daypart !== undefined) return reasoned('wrong-daypart', daypart);

    const fault = faultIn(speakable, guard);

    return fault === undefined ? undefined : reasoned(fault);
}

/**
 * What the station CUT off an answer it kept, or `undefined` when it kept the lot.
 *
 * The sibling of {@link writeDecline} and derived the same way — from the raw text, through the same
 * two steps, in the same order — because the alternative is a writer measuring the difference between
 * what it sent and what came back and reporting a number this file did not produce.
 *
 * It exists at all because a trim is an EDIT the station made to something a listener then heard, and
 * an edit nothing records is indistinguishable from a model that writes to length. `raw` answers this
 * too, but only while `llm.captureWrites` is on, which is an evening of prompt tuning rather than the
 * ordinary state. A decline is not a trim: this answers `undefined` for one, because that break never
 * aired and {@link writeDecline} has the whole story about it.
 */
export function writeTrim(text: string, guard: AnswerGuard): { kept: number; dropped: number; reason: string } | undefined {
    const tidied = tidyAnswer(text, guard);
    if (tidied === undefined) return undefined;

    const fitted = fitToCeiling(tidied, guard);
    if (fitted === undefined || fitted === tidied) return undefined;

    const kept = wordsIn(fitted);
    const dropped = wordsIn(tidied) - kept;

    return {
        kept,
        dropped,
        reason: `the model wrote ${dropped} words past the word ceiling, so the break was cut back to its last whole sentence`,
    };
}
