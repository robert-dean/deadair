/**
 * What the station asks a model for, and what it will accept back.
 *
 * Two pure functions and no I/O, so the interesting decisions here — which are all about what the
 * model must NOT do — are testable without a model. The binding that uses them is
 * `model.talk.break.writer.ts`. What it will accept back is read in `break.answer.guard.ts`.
 *
 * ## The one failure this is shaped around
 *
 * [station-intelligence](https://github.com/robert-dean/deadair/discussions/37) §9: a prompt asked to be concrete about music and shown no
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

import { withoutCues, type LlmMessage, type SpeechCue, type SpeechDelivery } from '@deadair/plugin-sdk';
import { padOffer, withoutPads, type PadUseNote } from '#modules/render/pad.cues.js';
import { MAX_REACTIONS } from '#modules/render/speakable.script.js';

import {
    latitudeOf,
    personaLines,
    personaVoiceReminder,
    spentCatchphrases,
    LATITUDE_INSTRUCTIONS,
    LATITUDE_LICENCE,
    LATITUDE_MAX_WORDS,
    TRIVIA_INSTRUCTIONS,
    TRIVIA_MAX_WORDS,
    triviaOf,
    type PersonaLatitude,
    type PersonaTrivia,
    type PersonaSheet,
} from '#modules/personas/persona.sheet.js';
import type { PersonaNotesForPrompt } from '#modules/personas/persona.note.js';
import type { PersonaStoryForPrompt } from '#modules/personas/persona.story.js';
import type { SpokenWeather } from '#modules/weather/weather.words.js';
import type { AlmanacEntry } from '@deadair/plugin-sdk';
import { languageName, languageRule } from '#modules/shared/language.name.js';
import { homeRule } from '#modules/shared/station.home.js';
import type { BreakStory, BreakTrack, BreakWriteRequest, SittingIn } from './break.writer.js';
import type { ChartPlacing } from '#modules/playout/rundown.js';
import { retryNudge } from './break.retry.js';
import { spoken } from './talk.break.writer.js';

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
    opening?: (request: BreakWriteRequest, settings: PromptSettings) => string | undefined;
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
     * How much of the character this kind of break carries. Absent is all of it.
     *
     * `lean` is for a break that reports somebody else's facts, which is `NEWS_SHAPE`: the sheet still
     * goes, so the bulletin still sounds like the station's presenter, but the signature phrases are
     * not offered, the character's words are allowed rather than asked for, and the closing reminder
     * to write "every sentence in your own speech" is not sent. That reminder sits after the rules,
     * the strongest position in the prompt, and it was telling a bulletin the opposite of its own
     * opening ("no jokes, no opinions"). See `PersonaLineOptions.lean` for what it produced on air.
     */
    voice?: 'lean';
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
     * Whether this kind of break may say what it is like outside, and on what terms.
     *
     * {@link BreakPromptShape.stories}' exact shape and for its exact reason — two kinds want the
     * same substrate on opposite terms, and the difference is the whole of what this field carries:
     *
     * - `reported` — the reading IS the break. The figures are the point, so the rules around them
     *   are the strictest in this file: no comparison, no advice, nothing about how it feels. The
     *   weather break.
     * - `offered` — the reading is colour on a break about something else, and the presenter may
     *   ignore it, react to it, or tie it to the record. The ordinary talk break.
     *
     * **The licence is the difference; the figures are not.** Both terms forbid inventing a number,
     * because that guard is about what the station KNOWS rather than about what this kind of break is
     * for, and `inventedFigure` is asked by both writers. What `offered` drops is the ban on advice
     * and on feeling — "it's sunny, get out there while it lasts" is the presenter doing their job,
     * and the same sentence in a bulletin is a newsreader editorialising. That is `allowsCues`' line
     * drawn around a different thing.
     *
     * **Whether there is a reading here at all is the CALLER's decision**, exactly as it is for a
     * story: `WeatherSource` decides which kinds get one and what it costs to ask, and a shape that
     * permits the weather on a station with no weather plugin simply never sees one.
     */
    weather?: 'reported' | 'offered';
    /**
     * Whether the day's entries are rendered on this kind of break, and on which terms.
     *
     * {@link BreakPromptShape.weather}'s exact shape and its exact reason, one substrate over:
     *
     * - `read` — the entry IS the break. The model picks one of the lines it was shown and says it,
     *   and the rules around it are the strictest here. The break about the date.
     * - `offered` — the day is colour on a break about something else, and the presenter may ignore
     *   it, which most breaks should. The ordinary talk break.
     *
     * **The licence is the difference; the evidence is not.** Both terms forbid adding what the
     * model remembers about an entry, because that guard is about what the station KNOWS rather than
     * about what this kind of break is for, and both are held to the years they were shown through
     * {@link AnswerGuard.years}. What `offered` drops is the instruction to pick one at all: a link
     * that happens to notice the date is worth more than one that reads an almanac out.
     *
     * **Whether there are entries here at all is the CALLER's decision**, exactly as for a reading:
     * `AlmanacSource` decides which kinds get them and what it costs to ask.
     */
    almanac?: 'read' | 'offered';
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
     * Whether a persona's {@link PersonaSheet.trivia} is offered on this kind of break.
     *
     * The ordinary link alone, and the reason is {@link BreakPromptShape.showsFacts}' own: a kind of
     * break that is about something other than the record (a bulletin, a forecast, a greeting to
     * somebody who has just arrived) is where a presenter handed four notes finds a way to read them
     * out. The shape vetoes and the sheet only offers, as with latitude, and the job asks the same
     * question before it widens the read, so a veto here withholds the extra facts as well as the
     * words about them.
     */
    allowsTrivia?: boolean;
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
     * The {@link BreakPromptShape.rules} to send INSTEAD when trivia is in force, and over
     * {@link BreakPromptShape.latitudeRules} when both are.
     *
     * {@link BreakPromptShape.latitudeRules}' argument exactly, and it was found the same way: by
     * reading a keen presenter's prompt back. The sheet it was built for tells the story first and
     * names the record last, and the ordinary rules said "name a record, and then say what you make of
     * it", which is the same slot with the order reversed. So the shape owns a third version, and the
     * rule a kind cannot give up is in it too: a listener still has to be able to tell which record the
     * story was about, and {@link BreakPromptShape.mustNameRecord} still refuses a break that never says.
     *
     * It wins over the latitude set because its first rule is written to hold under both rungs: one
     * story, told as far as it goes, is the one point and the thought taken all the way at once.
     */
    triviaRules?: readonly string[];
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
     * Whether this kind of break may choose how it is read: `hushed` or `frantic`.
     *
     * {@link BreakPromptShape.allowsCues}' rule for a whole break rather than a moment in one, and on
     * for the ordinary talk break alone. A bulletin's accuracy is not a mood, and a newsreader who
     * reads a story hushed has editorialised it as surely as one who sighs over it. The weather and
     * the welcome are excluded on the ground `allowsCues` gives for the welcome. The story break is
     * the obvious next one to switch on, left off until the talk break has been heard doing it.
     */
    allowsDeliveries?: boolean;
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
    /**
     * Whether this kind of break is handed the one quirk with a cadence that came up.
     *
     * `allowsPreoccupation`'s argument exactly, and the same one kind says yes: a bulletin that yells
     * for somebody halfway through the news, or a welcome that opens on the bat, is the character's
     * act in the one place it is not wanted. The quirk is not lost on those breaks; it simply did not
     * come up, and a quirk with a cadence was never a rule to be sent everywhere.
     */
    allowsOccasionalQuirk?: boolean;
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
    // The same terms for the sky, and the same word for them. What a presenter may DO with it is the
    // whole difference from the weather break: react to it, say what to do with an afternoon like
    // this, tie it to the record. The figures stay unfabricable either way. Whether a reading is here
    // at all is `WeatherSource`'s, behind `rotation.weatherInTalk`, which is off by default — so this
    // line changes nothing on a station that has not asked for it. See `BreakPromptShape.weather`.
    weather: 'offered',
    // And the same terms for the date, on the same word again. What a presenter may do with it is
    // smaller than what they may do with the sky — the freedom is whether to mention an anniversary
    // at all and how to tie it to the record, since everything else about an entry is somebody
    // else's sentence. Whether there are entries here at all is `AlmanacSource`'s, behind
    // `rotation.dateInTalk`, which is off by default. See `BreakPromptShape.almanac`.
    almanac: 'offered',
    // The link between two records is the one kind with room to give. See `allowsLatitude`.
    allowsLatitude: true,
    // And the one kind whose job is the record, so the one place a presenter keen on the story behind
    // it gets to tell it. See `allowsTrivia`.
    allowsTrivia: true,
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
    // The same three again for a presenter keen on the story behind the record, with the ORDER taken out
    // of the second: the story comes first and the record lands at the end of it, which "name a record,
    // and then say what you make of it" forbade in as many words. What is kept is what `mustNameRecord`
    // refuses over, so it is still asked for plainly before anything is refused for missing it.
    triviaRules: [
        'Tell one story, and tell it all the way. A break is the story behind one record told well, not everything you were given about ' +
            'both: pick the note worth telling and let the rest go.',
        'Make the story about a record a listener can name. Say its title, or who it is by, somewhere in the break: at the start, or at ' +
            'the end once the story has earned it. One of the two is plenty; both is usually one too many.',
        'Talk, do not announce. Naming the record is not the break, and neither is reading out what the station knows: the break is the ' +
            'story, told the way only you would tell it. If it would still make sense read out by anybody else, it is not yours yet.',
    ],
    // A link between two records is the presenter being a person, which is exactly what a cue is for.
    // See `allowsCues` for why the bulletin and the welcome are not.
    allowsCues: true,
    // And the same for a reading of the whole break, which is the same permission one size up.
    allowsDeliveries: true,
    // And the one place a soundboard belongs, on the same grounds read one step out: the link is
    // where the station gets to sound like itself.
    allowsPads: true,
    // The one kind with somewhere to put a subject of its own. See `allowsPreoccupation`.
    allowsPreoccupation: true,
    // And the one with room for a character's now-and-then act. See `allowsOccasionalQuirk`.
    allowsOccasionalQuirk: true,
};

/** How the station wants this break to sound, and how long it may run. */
export interface PromptSettings {
    /** What the station calls itself, from `stream.title`. */
    station?: string;
    /** What it calls its presenter: the active persona's name, or `station.djName` behind it. */
    dj?: string;
    /** Who the station is, from `station.identity`. Standing background. See `STATION_IDENTITY_KEY`. */
    stationIdentity?: string;
    /** What is true at the station now, from `station.context`. Background, never a topic. See `STATION_CONTEXT_KEY`. */
    stationContext?: string;
    /**
     * Where the station broadcasts from, from `station.location`, or absent when none is set.
     *
     * The only answer to "where is here". Absent is a statement too, and the prompt makes it: no place
     * may be called here. See `homeRule`.
     */
    location?: string;
    /**
     * Who the station is right now, from `deadair.personas`.
     *
     * The `style` completes "You are …" in place of the station's own sentence, and the sheet's
     * facets are rendered between that and the rules. A station with no persona is unchanged, which
     * is the state every fresh install is in until it picks one.
     */
    persona?: PersonaCharacter;
    /**
     * Whose show this is while the presenter is a guest host sitting in. Rendered as one line under
     * the role sentence, so the guest can say so and never claims the show as theirs. Absent leaves
     * the prompt byte-identical to an ordinary night's.
     */
    sittingInFor?: SittingIn;
    /**
     * Everybody else presenting this show tonight, by on-air name. One line under the role sentence,
     * so whoever speaks can hand to them or mention them; absent leaves an ordinary show's prompt
     * byte-identical.
     */
    coPresenters?: readonly string[];
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
     * The one quirk with a cadence that came up for this break, from `occasionalQuirkOf`, on
     * {@link PromptSettings.preoccupation}'s terms exactly: the caller draws it, and
     * {@link BreakPromptShape.allowsOccasionalQuirk} decides whether this kind of break hears it.
     */
    occasionalQuirk?: string;
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
     * The language the station broadcasts in, as a BCP 47 tag, when it is not English.
     *
     * Absent for English, and then the prompt is exactly what it was before a station could be
     * anything else. Present, it adds one closing instruction to write in that language and swaps the
     * few places the prompt names English or hands over English words to be copied. The rest of the
     * prompt stays in English on purpose: it is instructions to the model rather than words for the
     * air, and a model reads English instructions best whatever it is asked to write in.
     */
    language?: string;
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
    /**
     * Where each of those pads may land and when to reach for it, for the ones not at the default.
     *
     * Said beside the name and enforced by nothing in the guard, which is deliberate: placement is
     * enforced when the hits are resolved (a misplaced one is dropped, the words air without it), and
     * a cue names a moment no code can recognise. This is the model being told, so that the drop is
     * rare rather than the rule.
     */
    padUse?: Readonly<Record<string, PadUseNote>>;
    /**
     * The readings this break may ask for, or absent for an engine that performs none.
     *
     * {@link PromptSettings.reactions}' rule exactly, and resolved by the caller from the render side
     * for its reason: what the prompt offers and what the answer is read against must be the same
     * list. Empty or absent leaves the prompt byte-identical to one built before deliveries existed,
     * which is the state of every station whose engine has no such control, and of the live one
     * while its server holds the model that performs cues instead.
     */
    deliveries?: readonly SpeechDelivery[];
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
export const WORDS_PER_SECOND = 2.6;

/**
 * The rung in force for this prompt, or `undefined` for the station's ordinary discipline.
 *
 * The shape has the veto and the sheet only ever offers, which is why both are read here rather than
 * at either end. See {@link BreakPromptShape.allowsLatitude}.
 */
const latitudeIn = (settings: PromptSettings, shape: BreakPromptShape): PersonaLatitude | undefined =>
    shape.allowsLatitude === true ? latitudeOf(settings.persona) : undefined;

/**
 * What the user turn says about the notes, by rung.
 *
 * Keyed on the rung by NAME, so a rung added later falls to the ordinary paragraph until it is given
 * one of its own. What every paragraph shares is kept word for word: never read out as it stands, and
 * anything a note mentions that is not one of the records is background.
 *
 * `always` is shown ONE note, chosen in code (`BreakRequestBuilder`, through `factForBreak`), so its
 * paragraph says "the note" and asks for it outright. The optionality the ordinary paragraph states
 * first is the thing this rung exists to take away from the model, and saying both would be the
 * hedge `keen` had to be swapped in to cure.
 */
function notesParagraph(trivia: PersonaTrivia | undefined): string {
    switch (trivia) {
        case 'keen':
            return (
                'The notes are things the station knows to be true, and they are what your break is made of. Pick the one that tells ' +
                'the best story about a record, or two if they tell the same story, and tell it as yourself: who made it, where it ' +
                'came from, what happened to it. Never read a note out as it stands. A year, a name or a chart position is worth ' +
                'saying when it is part of the story, and only exactly as the note gives it. Anything a note mentions that is not one ' +
                'of the records above is background, never something to cue or play.'
            );
        // `sometimes` is shown a note only on a link that drew one, and is asked for it as `always` is.
        case 'always':
        case 'sometimes':
            return (
                'The note is something the station knows to be true, and this link carries it. Say it as yourself, in your own words, ' +
                'beside whatever else you would say about the music. Never read it out as it stands, and a year, a name or a figure only ' +
                'exactly as the note gives it. Anything the note mentions that is not one of the records above is background, never ' +
                'something to cue or play.'
            );
        default:
            return (
                'The notes are things the station knows to be true, offered in case one is worth saying. ' +
                'You do not have to use any of them, and most breaks are better without one: a note earns its place only if you can ' +
                'say it as yourself. Never more than one, never read out as it stands, never a date or a credit for its own sake. ' +
                'Anything a note mentions that is not one of the records above is background, never something to cue or play.'
            );
    }
}

/** {@link latitudeIn} for {@link PersonaSheet.trivia}, on the same terms. See {@link BreakPromptShape.allowsTrivia}. */
const triviaIn = (settings: PromptSettings, shape: BreakPromptShape): PersonaTrivia | undefined =>
    shape.allowsTrivia === true ? triviaOf(settings.persona) : undefined;

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
 * What readings this prompt may offer: the shape's permission and the engine's ability together.
 *
 * {@link offeredReactions}' intersection, and exported on {@link offeredPads}' rule: a writer lifts
 * the mark off its answer against THIS list, so a model that wrote `[hushed]` into a kind of break
 * that never offered it has that stripped as a stage direction rather than obeyed.
 */
export const offeredDeliveries = (settings: PromptSettings, shape: BreakPromptShape): readonly SpeechDelivery[] =>
    shape.allowsDeliveries === true ? (settings.deliveries ?? []) : [];

/**
 * The delivery rule, or nothing at all when there is none to offer, on {@link reactionRules}' argument.
 *
 * It says where the mark goes because the place is the whole of what makes it a delivery: first,
 * before any words, is the only position {@link liftDelivery} reads. Anywhere else it is a bracketed
 * run the tidying strips as a stage direction, which is safe and is also a reading the model asked
 * for and did not get, so the rule says so rather than leaving it to be learned.
 */
function deliveryRules(settings: PromptSettings, shape: BreakPromptShape): string[] {
    const deliveries = offeredDeliveries(settings, shape);
    if (deliveries.length === 0) return [];

    const written = deliveries.map(delivery => `[${delivery}]`).join(' or ');
    return [
        `- You can also choose how the whole break is read: ${written}. Put it on its own as the very first thing, before any words, and the voice reads everything after it that way. ` +
            'Most breaks want neither, so use one only when the moment really calls for it, and never anywhere but the start.',
    ];
}

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

    const written = pads.map(name => padOffer(name, settings.padUse?.[name.toLowerCase()])).join(', ');
    // Only when there is a note to keep to, so a rack nobody has set up asks exactly what it did.
    const noted = pads.some(name => settings.padUse?.[name.toLowerCase()] !== undefined);
    return [
        `- You have a soundboard: ${written}. Write one exactly like that, on its own, at the moment you hit it, and the sound is PLAYED — ` +
            'do not describe it or say its name as words. At most one in a break, and most breaks want none: a soundboard is funny once.' +
            (noted ? ' Where a sound has a note in brackets, keep to it: a sound put anywhere else is not played.' : ''),
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
    const trivia = triviaIn(settings, shape);
    // Both rungs are floors under the station's own figure, and under each other: a keen presenter
    // with `unleashed` has the larger of the two rather than whichever was read last.
    return Math.max(base, latitude === undefined ? 0 : LATITUDE_MAX_WORDS[latitude], trivia === undefined ? 0 : (TRIVIA_MAX_WORDS[trivia] ?? 0));
}

/**
 * The conversation, oldest first, with the system prompt as the first turn.
 *
 * One system turn and one user turn. The system turn is who the station is and what a break may
 * never do; the user turn is this particular moment. Split that way so the rules read as standing
 * instructions rather than as something about these two records, which is what they are.
 */
export function breakPrompt(request: BreakWriteRequest, settings: PromptSettings, shape: BreakPromptShape): LlmMessage[] {
    const asked: LlmMessage[] = [
        { role: 'system', content: systemPrompt(settings, shape) },
        { role: 'user', content: userPrompt(request, settings, shape) },
    ];

    // The second ask, when the registry made one. A third user turn rather than a rewritten first
    // one, so what the model is answering is still the break it was asked for, with one correction
    // after it — and rather than an `assistant` turn carrying the refused words, which is the same
    // information in a shape a local model reads as something to continue. `break.retry.ts` owns
    // which faults get here and what each one says.
    const nudge = request.retry === undefined ? undefined : retryNudge(request.retry);

    return nudge === undefined ? asked : [...asked, { role: 'user', content: nudge }];
}

/** The one line a presenter is given about who else is on the show with them tonight. */
function coPresentersLine(names: readonly string[]): string {
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

    return `You co-host this show with ${list}, who ${names.length === 1 ? 'is' : 'are'} in the studio with you. You can mention them or hand to them, but this break is yours to say.`;
}

/** The one line a guest host is given about whose show they are on. */
function sittingInLine(regular: SittingIn): string {
    const show = regular.show?.trim();

    return (
        `Tonight you are sitting in for ${regular.name}${show ? ` on ${show}` : ''}: it is their show and you are the guest presenter. ` +
        'Say so where it fits, and never call the show yours.'
    );
}

function systemPrompt(settings: PromptSettings, shape: BreakPromptShape): string {
    const station = settings.station?.trim();
    const dj = settings.dj?.trim();
    const persona = settings.persona;
    const maxWords = maxWordsFor(settings, shape);
    const seconds = Math.round(maxWords / WORDS_PER_SECOND);
    const latitude = latitudeIn(settings, shape);
    const trivia = triviaIn(settings, shape);

    // A persona replaces the role sentence rather than being appended to it, because "you are the
    // voice of a radio station" and "you are a pirate captain who runs one" are the same slot said
    // twice, and a model handed both hedges between them.
    const role =
        persona === undefined
            ? `You are the voice of a radio station${station ? ` called ${station}` : ''}${dj ? `, and your name is ${dj}` : ''}.`
            : `You are ${persona.style}${station ? `, on a station called ${station}` : ''}${dj ? `, and your name is ${dj}` : ''}.`;

    const lines = [
        role,
        // Straight under the role, because it is part of who the presenter is tonight rather than
        // something about the records: a guest who forgot whose show it is would welcome listeners
        // to "my show", and the regular host's listeners would notice.
        ...(settings.sittingInFor === undefined ? [] : [sittingInLine(settings.sittingInFor)]),
        ...(settings.coPresenters === undefined || settings.coPresenters.length === 0 ? [] : [coPresentersLine(settings.coPresenters)]),
        // The station before the character, because it is what the character is on. Both are
        // background: the second especially is put as something to know rather than to say, or a
        // fundraiser the operator mentioned once would open every break of the day.
        ...(settings.stationIdentity === undefined ? [] : [`About the station: ${settings.stationIdentity}`]),
        ...(settings.stationContext === undefined
            ? []
            : [
                  `What is true at the station right now, for you to know rather than to announce: ${settings.stationContext} ` +
                      'Mention it only where it genuinely fits what you are saying, and never in every break.',
              ]),
        // The sheet sits between the role and the rules, which leaves the grounding discipline in
        // the recency position it has always had.
        // The shape's veto is applied HERE rather than by the caller that chose the subject, which
        // is `offeredPads`' division: what a kind of break offers is a property of the kind, and a
        // job that filtered on it would be a second opinion about the same question.
        ...(persona === undefined
            ? []
            : personaLines(persona, {
                  ...(shape.allowsPreoccupation === true && settings.preoccupation !== undefined ? { preoccupation: settings.preoccupation } : {}),
                  ...(shape.allowsOccasionalQuirk === true && settings.occasionalQuirk !== undefined
                      ? { occasionalQuirk: settings.occasionalQuirk }
                      : {}),
                  ...(shape.voice === 'lean' ? { lean: true } : {}),
              })),
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
        // Beside the latitude line and for its reason: this is what the extra room is FOR. It sits in
        // the system turn whether or not these two records carry any notes, because it is who the
        // presenter is rather than something about this moment; the user turn's notes paragraph is
        // what changes with the records.
        ...(trivia === undefined || TRIVIA_INSTRUCTIONS[trivia] === undefined ? [] : [TRIVIA_INSTRUCTIONS[trivia]]),
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
        // than what it says. This is the delivery control EVERY engine has. A reading of the whole
        // break can also be asked for (`deliveryRules`, below), but only some engines perform one and
        // it sets the mood of the whole thing rather than the shape of each sentence, so the marks in
        // the words are still where most of the reading comes from. They survive intact, which is
        // what makes this worth asking for: `transposeForSpeech` keeps `.,!?;:` through `settle`,
        // turns an em or en dash into a comma (a real pause), and turns `…` into three dots.
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
        // Immediately after the reactions, because the two are the same KIND of instruction (things a
        // script may carry that are not words) and a model reading them together is reading one idea
        // rather than two unrelated notations.
        ...padRules(settings, shape),
        // The third of that kind, and last of them because it is the only one that is not placed at a
        // moment in a sentence. Offered on the reactions' two conditions: the shape permits it and the
        // engine performs it, which on the engine that has it means a different model from the one that
        // performs the reactions, so a station sees one rule or the other and rarely both.
        ...deliveryRules(settings, shape),
        '- Do not greet the listener by name, promise anything you have not been told, or mention the time unless you are given it.',
        // Where "here" is, on every kind. The role sentence above may carry a home town of the
        // character's own ("a Glaswegian night owl") and the station's own text may name somewhere,
        // and with nothing saying which place the station IS, a model reads either as the answer.
        // Stated whether or not a location is set, because the absence is a rule too: no here at all.
        `- ${homeRule(settings.location)}`,
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
        // Keyed on the rung by NAME: these are the story-first rules, and a rung that is not `keen`
        // asks for something other than a story.
        ...(trivia === 'keen' && shape.triviaRules !== undefined
            ? shape.triviaRules
            : latitude === undefined
              ? (shape.rules ?? [])
              : (shape.latitudeRules ?? shape.rules ?? [])
        ).map(rule => `- ${rule}`),
    ];

    // AFTER the rules, and that position is the whole reason it exists. The failure it addresses is
    // caused BY the rules: a host reads seven careful instructions about naming records accurately
    // and answers them in careful, plain English. See `persona.sheet.ts`.
    // Not for a break whose character is a lean: see `BreakPromptShape.voice`.
    const reminder = persona === undefined || shape.voice === 'lean' ? undefined : personaVoiceReminder(persona, settings.language);
    if (reminder !== undefined) lines.push('', reminder);

    // Last of all, after the persona's reminder, because it is the one instruction every other line
    // is subject to and the end of the prompt is the position a model weighs most. See `languageRule`.
    if (settings.language !== undefined) lines.push('', languageRule(settings.language));

    return lines.join('\n');
}

function userPrompt(request: BreakWriteRequest, settings: PromptSettings, shape: BreakPromptShape): string {
    const parts: string[] = [];

    const opening = shape.opening?.(request, settings);
    if (opening !== undefined) parts.push(opening);

    // A kind that does not look backwards never sees the record behind it, rather than seeing it and
    // being told not to mention it: a model shown a record will find a way to cue it.
    const previous = shape.showsPrevious ? request.previous : undefined;

    // Same doctrine, applied to the notes: a shape that has no use for them withholds them rather
    // than showing them and asking for restraint. See `BreakPromptShape.showsFacts`.
    const withFacts = shape.showsFacts !== false;

    // A neighbour may be a programme rather than a record: an episode of somebody else's show the
    // station carries whole. Said so in the heading, because a model told "the record" introduces an
    // hour of a podcast as though it were a song.
    if (previous)
        parts.push(`${previous.programme === undefined ? 'The record' : 'The programme'} that has just finished:\n${describe(previous, withFacts)}`);
    if (request.next)
        parts.push(`${request.next.programme === undefined ? 'The record' : 'The programme'} coming up next:\n${describe(request.next, withFacts)}`);

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
        // the station and stop would be telling it not to do its job. A changeover is the same case:
        // it has two shows and a host to name, which "nothing more" would forbid.
        if ((request.stories?.length ?? 0) === 0 && request.changeover === undefined) {
            parts.push('Say something brief that identifies the station and nothing more.');
        }
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

    // Said wherever a record's subject was shown, because that is when a model is likeliest to reach for
    // the words themselves. The guard refuses a script that does (`quotedLyricIn`); this asks first,
    // which is the bargain every refusal here is struck on.
    if (withFacts && (previous?.about?.trim() || request.next?.about?.trim())) {
        parts.push('Never quote the words of a song. If you say what one is about, say it in your own words.');
    }

    // The record coming up has an intro the presenter could talk over, and this is how much of it
    // there is. Advice only: whether the link actually goes over the intro is decided at hand-over on
    // its real length (`talk.up.ts`), and one that runs long simply airs before the record instead.
    // So it is an offer and says so, never a tighter ceiling.
    if (request.next && request.talkUp !== undefined) {
        parts.push(
            `The singing on the record coming up starts about ${Math.floor(request.talkUp.runwayMs / 1000)} seconds in. ` +
                `Say this in ${request.talkUp.words} words or fewer and it goes out over that intro, finishing just before the singer comes in. ` +
                'Anything longer is said before the record starts, which is fine too.',
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
            // SWAPPED under the trivia rung rather than appended to, because the two paragraphs say
            // opposite things about the same list: this one that most breaks are better without a
            // note, that one that the notes are the break. A model handed both hedges into neither,
            // which is the failure the rung exists to fix. What the two share is kept word for word:
            // never read out as it stands, and anything a note mentions that is not one of the
            // records is background.
            notesParagraph(triviaIn(settings, shape)),
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
            `The station knows nothing about ${unknown.map(track => `"${spoken(track.title)}"`).join(' or ')} beyond what is listed above. ` +
                'Say nothing else about it as fact — no dates beyond any year listed above, no labels, no pressings or catalogue numbers, ' +
                'no studios, no sessions, no chart placings beyond any listed above, no connection to any other record beyond any listed above. What you think of it is yours to say. ' +
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
                `and where, in a sentence or two of ordinary spoken ${settings.language === undefined ? 'English' : languageName(settings.language)}. ` +
                'A headline is not one of those sentences — it is written to be seen, and read aloud it sounds like a headline — ' +
                'so take what happened from it and say that, rather than reading it out and then repeating yourself. ' +
                'A bulletin that reads out headlines and nothing else has told the listener nothing. ' +
                'The wording is yours; the facts are not. Say only what each story actually says: do not add detail, ' +
                'do not explain what it means, do not say what will happen next, and do not merge two stories into one. ' +
                'When a story says who claims something, keep it theirs: say that they said it, rather than reporting it as a fact. ' +
                "The text is the publisher's own wording — use it to know what happened, not as lines to read out. " +
                'Where a story has no text under it, say what its headline says in one spoken sentence and move on rather than filling the gap. ' +
                'If a story is unclear, leave it out rather than guessing at it. ' +
                'If an item is a listing for a show, a puzzle or an episode rather than something that happened, leave it out. ' +
                'Do not say how you feel about any of it.',
        );
    }

    // The weather's substrate, rendered on the same terms as the stories above and carrying the same
    // shape of rule for the same reason. What differs is what "do not invent" means: a bulletin must
    // not add a detail to a story, and this must not add a NUMBER — and a plausible temperature is
    // much easier to write than a plausible news story, because the model knows roughly what August
    // in Atlanta is like and will say so if the line below does not stop it.
    //
    // Which of the two terms applies is the shape's, on `BreakPromptShape.weather`: a kind whose job
    // is the reading and a kind that may mention it in passing want the same figures under opposite
    // licences, and rendering one block for both is what made "nothing about how the weather makes
    // anyone feel" a rule for a presenter linking two records.
    if (request.weather !== undefined && shape.weather !== undefined) {
        parts.push(describeWeather(request.weather));
        parts.push(
            shape.weather === 'reported'
                ? 'Give the weather from those figures and nothing else. Every number and every word about the sky has to be one written ' +
                      'above: do not round, do not convert, do not add a figure that is not there, and do not say what it was like yesterday ' +
                      'or what it will be like after the days listed. ' +
                      'You may say it as a person would rather than reading a table, and you may leave a figure out — but a figure you say ' +
                      'has to be one you were given. ' +
                      'No advice about coats or umbrellas, and nothing about how the weather makes anyone feel.'
                : // The offered wording, and every clause of it is doing one job. The optionality is
                  // stated outright and FIRST, in the words the notes and the story block already use
                  // — "work at most one of them in" read as an instruction to work one in, and a
                  // labelled table of figures is that hazard at its largest, since a table is the one
                  // shape a model will simply read out. Then the licence, which is the whole feature:
                  // a presenter may react to the sky and say what to do about it, where the weather
                  // break may not. Then the figures rule, unchanged and unsoftened, because what a
                  // model may INVENT is not a question about what kind of break this is.
                  'You do not have to mention the weather, and most breaks are better without it. It is here in case the day gives you ' +
                      'something to say — a link that notices it is outside is worth more than one that reports it. ' +
                      'If you do use it: it is yours to react to. Say what you make of it, tell a listener what to do with an afternoon ' +
                      'like this, tie it to the record if it goes there. ' +
                      'What you may not do is make a figure up. Every number you say has to be one written above — do not round, do not ' +
                      'convert, do not add one that is not there, and do not say what it was like yesterday or what it will be like after ' +
                      'the days listed. Leaving every figure out and just saying what it is like is usually the better break.',
        );
    }

    // The date's substrate, rendered on the same terms as the two above and carrying the third
    // version of the same rule. A bulletin must not add a detail to a story, a forecast must not add
    // a NUMBER, and this must not add what it REMEMBERS — which is the hardest of the three to
    // resist, because a model handed "Nuno Bettencourt, Portuguese guitarist" knows what band he was
    // in, and that sentence is indistinguishable on air from the one the station was actually given.
    if (request.almanac !== undefined && request.almanac.entries.length > 0 && shape.almanac !== undefined) {
        parts.push(describeDay(request.almanac.day.date, request.almanac.entries));
        parts.push(
            shape.almanac === 'read'
                ? 'Pick one of those and say it. Everything you say about it has to be in the line you picked: do not add what somebody is ' +
                      'known for, which band they were in, what else happened that year, or how any of it was received — the station was not ' +
                      'told any of that, and what you remember about it sounds exactly like what you were given. ' +
                      'Say the year as it is written above. ' +
                      'You may say it as a person would rather than reading it out flat, and you may work out how long ago it was, since that ' +
                      'is arithmetic on the year you were given. ' +
                      'Nothing about what it means, what it led to, or how things were back then.'
                : // The offered wording, built like the weather's and for its reasons. The
                  // optionality first and outright, because a LIST is the shape a model will simply
                  // read out; then what the licence actually is, which is smaller than the weather's
                  // — there the presenter may react to the sky, and here the only freedom is whether
                  // to mention the date at all and how to tie it to the record. The evidence rule is
                  // unchanged and unsoftened, because what a model may add to somebody else's
                  // sentence is not a question about what kind of break this is.
                  'You do not have to mention any of that, and most breaks are better without it. It is here in case the date gives you ' +
                      'something the record wants — a link that notices an anniversary is worth more than one that reads a list out. ' +
                      'If you do use one: say the year as it is written above, and say it in passing rather than announcing it. ' +
                      'What you may not do is add to it. Nothing about what somebody is known for, which band they were in, what else ' +
                      'happened that year or how any of it was received: the station was not told any of that, and what you remember about ' +
                      'it sounds exactly like what you were given.',
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
                ...played.map(record => `- ${spoken(record.title)} by ${record.artist}`),
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
        // English only, because the stop list that keeps "the" and "and" out of it is English. On a
        // German station it would name "nicht" and "eine" as habits.
        const worn = settings.language === undefined ? overusedWords(request.recent) : [];
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
        //
        // And told what the new one may not be built on, because the invitation alone had an obvious
        // answer: a signature with a name in it ("Party on, Garth!") whose name is not in the room,
        // and the station's name in every prompt. A twenty-break audition of that character on
        // 2026-10-21 ended fifteen times on "Party on, Deadair!" or a cousin of it.
        const spent = settings.persona === undefined ? [] : spentCatchphrases(settings.persona, request.recent);
        if (spent.length > 0) {
            parts.push(
                `You have already said ${spent.map(phrase => `"${phrase}"`).join(' and ')} recently. Do not say ${spent.length === 1 ? 'it' : 'any of them'} again now.` +
                    // The prohibition stays for a break whose character is a lean, because the guard
                    // still refuses a spent signature there; the invitation to make a new sign-off
                    // does not. See `BreakPromptShape.voice`.
                    (shape.voice === 'lean'
                        ? ''
                        : " If you want a line to go out on, make up a new one of your own in the same voice, and do not build it on the station's name."),
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

    if (request.clock && settings.language !== undefined) {
        // The words are English and the break is not, so they cannot come back verbatim. The time is
        // handed over as the phrase it is and the model says the same rough time in its own language.
        // The station cannot search the answer for a translation of its own phrase, which is the price
        // of broadcasting in anything but the language the clock's words are written in.
        parts.push(
            `It is ${request.clock.words} (that is the English phrasing). Work the time in, rounded the same way, in ${languageName(settings.language)}. ` +
                'Do not give an exact time and do not name the minutes.',
        );
    } else if (request.clock) {
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

    // The last thing before the ask, so whatever it says is the freshest material the model has, and
    // for a long time all it said was the name. That made the name the nearest thing to hand for a
    // closing line, and the station got "Stay wired, Deadair." and "Stay laid back on Deadair." as
    // sign-offs, addressed to the station as though it were the listener. Naming the station is an
    // ident and stays allowed; the second sentence says what it is not. `stationSignOffIn` refuses
    // the vocative half of it, and this is the ask that keeps that refusal rare.
    const station = settings.station?.trim();
    if (station) {
        parts.push(
            `The station is called ${station}. You may say so, but you do not have to every time. It is the station you are on, ` +
                'not someone you are talking to: never say a line to it by name, and never end the break on it as a sign-off.',
        );
    }

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
    if (track.programme !== undefined) return describeProgramme(track, withFacts);

    // The title as it is READ rather than as it is filed. Shown the catalogue entry, a model reads it
    // out: a conspiracy-host audition on 2026-09-11 aired "Glycerine by Bush, 2014 remaster" and
    // "Tornado Of Souls by Megadeth, 2004 remix" while the floor beside it said the clean titles.
    const lines = [`- Title: ${spoken(track.title)}`, `- Artist: ${track.artist}`];
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
        if (track.album?.trim()) lines.push(`- Album: ${spoken(track.album.trim())}`);
        if (track.durationMs) lines.push(`- Length: ${spokenLength(track.durationMs)}`);
        if (track.chart) lines.push(`- Chart: ${spokenPlacing(track.chart)}`);
        // Said as why it is on, as a chart position is: a deep cut is a choice the station made.
        if (track.deepCut) lines.push('- Deep cut: an album track this station has not played in months');
        // The one connection to another record a break may state, because the station planned it.
        if (track.link?.trim()) lines.push(`- How it connects to the record before: ${track.link.trim()}`);
    }
    // What it is about, in the station's own words rather than the record's: the writer is shown this
    // and never the lyric. Behind `withFacts` with the rest of the material, for the same reason.
    if (withFacts && track.about?.trim()) lines.push(`- What it is about: ${track.about.trim()}`);
    if (withFacts && track.facts && track.facts.length > 0) lines.push('- Notes:', ...track.facts.map(fact => `  - ${fact}`));
    return lines.join('\n');
}

/**
 * Where a chart placed a record, as one line a presenter can say from.
 *
 * Said as the REASON the record is on, because it is: on a countdown the position is the content,
 * and a model shown a bare "Rank: 7" files it with the year as trivia it may skip. The peak and the
 * run are added only where the source gave them, on `describe`'s rule that a blank field is an
 * invitation to fill it in. No "this week": the edition's date is not something the station holds.
 */
function spokenPlacing(chart: ChartPlacing): string {
    const on = chart.name?.trim() ? `on ${chart.name.trim()}` : 'on the chart the station is playing from';
    const parts = [`it is here because it is number ${chart.rank} ${on}`];
    if (chart.peak !== undefined && chart.peak !== chart.rank) parts.push(`its highest position so far is number ${chart.peak}`);
    if (chart.peak !== undefined && chart.peak === chart.rank) parts.push('that is the highest it has been');
    if (chart.weeksOn !== undefined)
        parts.push(chart.weeksOn === 1 ? 'it is new on the chart' : `it has been on the chart for ${chart.weeksOn} weeks`);
    return `${parts.join('; ')}.`;
}

/**
 * An episode of somebody else's programme, as the model is shown it.
 *
 * Labelled as what it is, a show and an episode, rather than squeezed into a record's `Title` and
 * `Artist`: a model shown an artist says "a track from", and a programme has a presenter or a
 * publisher rather than a band. The one line of material is the publisher's own summary, behind
 * `withFacts` for `describe`'s reason, and the instruction says what the break is FOR, since a
 * presenter introducing a show says what it is about and does not review it.
 */
function describeProgramme(track: BreakTrack, withFacts: boolean): string {
    const lines = [`- Show: ${track.artist}`, `- Episode: ${spoken(track.title)}`];
    if (withFacts && track.durationMs) lines.push(`- Length: ${spokenLength(track.durationMs)}`);
    if (withFacts && track.programme?.summary?.trim()) lines.push(`- What the publisher says it is about: ${track.programme.summary.trim()}`);
    lines.push(
        '- This is a programme the station carries from somebody else, not a record. Name the show, and if it helps, what this episode is about. Do not call it a song or a track.',
    );
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

    // A programme runs an hour and more, and nobody says "sixty-two minutes three seconds" of one:
    // hours and whole minutes, the seconds dropped because at that length they are not a subject.
    if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        const spokenHours = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
        return rest === 0 ? spokenHours : `${spokenHours} ${rest} minutes`;
    }

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
/**
 * The day's entries, as lines a model chooses between.
 *
 * `describeStory`'s shape rather than `describeWeather`'s, because these are sentences somebody
 * wrote rather than figures somebody measured — and with `describeStory`'s hardest-won lesson
 * applied from the start: what is handed over is the entry and its year and NOTHING else. The
 * subjects' descriptions are deliberately withheld even though the station holds them, because a
 * model shown "Portuguese guitarist" beside a name treats the pair as a licence to say what else it
 * knows about him. The entry already carries whatever the source thought worth saying.
 *
 * The date is stated at the top so the model can say which day it is talking about without working
 * it out of anything, which is `describeWeather`'s reason for naming the place.
 */
function describeDay(date: string, entries: readonly AlmanacEntry[]): string {
    const lines = entries.map(entry => `- ${entry.year === undefined ? 'Today' : entry.year}: ${entry.text}`);

    return [`What happened on today's date (${date}), one line each. These were looked up; they are not yours to add to.`, ...lines].join('\n');
}

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
/**
 * The next part of a story the character has already started telling on air.
 *
 * ## It asks for ONE part, and that is the whole of what makes an arc an arc
 *
 * The instruction that matters most here is the one telling the model to stop: handed the shape of a
 * story a model will finish it, which is the measured failure this file records about every other
 * kind of material. A break that told parts two, three and four is not an arc, it is a story that
 * took one break and a listener who will never be asked back.
 *
 * ## Where it was left is the PREVIOUS part's own words
 *
 * Not what the break actually said about it, though the ledger holds that too. The previous beat is
 * prose an operator approved, it does not age out of `script_history`, and it says what the listener
 * was told rather than how — so a model reading it continues the story instead of being handed
 * somebody else's phrasing to echo.
 *
 * ## It still names the record
 *
 * `mustNameRecord` is unchanged, and this block does not excuse it. A break that told a beautiful
 * beat and never said what was playing is the failure `breaks.md` measured over thirty-nine
 * consecutive breaks, and an arc is not a reason to reopen it.
 */
function beatLines(story: PersonaStoryForPrompt, beat: NonNullable<PersonaStoryForPrompt['beat']>): string[] {
    return [
        'You have been telling this on air, a piece at a time:',
        story.story,
        ...(beat.leftAt === undefined ? [] : ['Last time you got as far as this:', beat.leftAt]),
        'This break carries the next piece, and only this piece:',
        beat.text,
        ...(beat.last ? ['That is the end of it, so land it rather than leaving it open.'] : []),
        // The stop instruction, stated as its own sentence because it is the one the model is most
        // likely to sail past. See the note at the top of this function.
        'Tell this much and no more, even if you can see where it goes — the rest is for another ' +
            'break. Work it in naturally and still say what is playing.',
        'It happened to you and it is yours to tell. It is not a fact about any record: do not attach it to what is playing, do not ' +
            'present it as something the station knows, and do not turn it into a claim about anybody real.',
    ];
}

/**
 * A running joke the character keeps coming back to.
 *
 * ## It is shown where it has been, which nothing else here does
 *
 * An anecdote is told and a beat moves a story on; a bit only works if the listener recognises it
 * returning, and the character can only do that knowing where it got to. So the last couple of
 * tellings go in, as the character's own past words.
 *
 * ## Which is why the verbatim guard exists
 *
 * Handing a model its own prior wording is the strongest possible invitation to reproduce it — the
 * measured failure this file records about sample lines, arriving through a door the sheet's own
 * check does not cover. `characterFault` refuses that as `retold-verbatim`, and the prompt ASKS
 * first, which is the bargain `spentCatchphrases` already makes: a script is only ever refused for
 * an instruction it was actually given.
 */
function bitLines(story: PersonaStoryForPrompt, shape: BreakPromptShape): string[] {
    return [
        'A running thing of yours, which listeners know you for:',
        story.story,
        // A recap where there is one, and the words themselves only until there is. The summary is
        // strictly better: it says what the thing has become over its whole life, where a pair of
        // tellings can only say where it is now — and a model cannot reproduce sentences it was
        // never shown, which is the hazard the raw form creates and `retold-verbatim` exists to
        // catch. The guard stays either way, because a coincidence is still possible.
        ...(story.recap !== undefined
            ? ['Where it has got to:', story.recap, 'Take it further than that. Coming back to it only works if it has moved.']
            : story.said === undefined || story.said.length === 0
              ? []
              : [
                    'The last times you came back to it you said:',
                    ...story.said.map(said => `- ${said}`),
                    'Do not say any of that again. Coming back to it only works if it has moved: take it somewhere it has not been.',
                ]),
        shape.stories === 'told'
            ? 'Pick it up now.'
            : 'You do not have to reach for it, and most breaks are better without it. If this moment gives you a reason to, pick it up.',
        'It is yours and it is a joke rather than a fact: do not attach it to what is playing, do not present it as something the station ' +
            'knows, and never let it become a claim about anybody real.',
    ];
}

function storyLines(settings: PromptSettings, shape: BreakPromptShape): string[] {
    const story = settings.story;
    if (shape.stories === undefined || story === undefined) return [];

    // A part of an ARC, which is the one case where the offer is not optional. The story has been
    // started on air and a listener is owed the next of it, so the wording that invites a break to
    // leave it alone would be inviting the station to drop a thread it began. The other half of that
    // bargain is the cadence gap, which is what stops this arriving on every break.
    if (story.beat !== undefined) return [beatLines(story, story.beat).join('\n')];

    // A running BIT, which is neither a one-off nor a story in parts: it has no end and no order, and
    // what makes it work is the character coming back to it having moved it on. So it is shown where
    // it has already been, and `retold-verbatim` refuses a script that simply says that again.
    if (story.kind === 'bit') return [bitLines(story, shape).join('\n')];

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
export const NOT_A_HABIT = new Set([
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

/** A text as bare lower-case words, so a title and a script can be compared as speech, not as text. */
export const bareWords = (text: string): string =>
    // A reaction comes out FIRST, or the brackets are stripped off it and `[laugh]` becomes the word
    // "laugh" for all three callers. Each would be wrong in its own way: `overusedWords` would tell a
    // station that laughs regularly it has a verbal tic, and the two matchers would find a word the
    // presenter never said. This is the one place all three agree on what a word is.
    withoutPads(withoutCues(text))
        .toLowerCase()
        .replace(/[‘’ʼ′]/g, "'")
        .replace(/[^\p{L}\p{N}']+/gu, ' ')
        .trim();
