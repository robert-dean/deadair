import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak } from './break.writer.js';
import type { BreakPromptShape } from './break.prompt.js';

/**
 * The station telling one of the presenter's own stories.
 *
 * ## Why this is a KIND and not a longer talk break
 *
 * A story reaching an ordinary link comes out as a REFERENCE — at forty words there is room for the
 * record, one point about it, and a nod to the desert. That is most of what stories are for and it
 * is what `TALK_BREAK_SHAPE` carries them for. What it cannot ever be is the thing a listener
 * remembers a presenter for, which is the presenter stopping and telling them something. There is no
 * length at which a link becomes that: a link is about the records either side of it, and this is
 * about the person in the middle.
 *
 * So it is a kind, an operator puts it on the clock like a bulletin, and `rotation.storyWords` is its
 * own ceiling rather than a raised version of the talk break's.
 *
 * ## The floor here is the story, which happens nowhere else
 *
 * Every other deterministic writer in this module is a pool of phrasings an operator typed, and the
 * model earns its place by sounding like a person instead of a template. Here the material IS
 * speakable prose somebody wrote — that is what `persona_stories.story` holds — so the floor reads
 * it out, and the model earns its place by TELLING it: fitting it to the hour, to the record coming
 * up, to the fact that it has been told before.
 *
 * That inverts the usual relationship and is worth stating plainly, because it explains two things
 * that would otherwise look like omissions. There is no `rotation.storyTemplates`, and this writer
 * deliberately does NOT chain into `rotation.breakTemplates` or a persona's own `templates`, on
 * `NewsBreakWriter`'s reason: those are written as back-announces, and "That was Solid Air" is not
 * how somebody starts telling you about the night they saw something over the desert.
 *
 * ## No story means no break, which is the same branch a bulletin has
 *
 * A character with nothing written down declines the slot, and so does a station presenting as
 * nobody. That is the ordinary state of every install until somebody writes one, and it costs a
 * passed-over slot rather than anything the station has to recover from: the director skips a
 * segment that never reaches `ready`. Said in the log for the reason a bulletin's empty branch is —
 * a clock asking for a kind the station can never fill is the one decline an operator has to be able
 * to act on.
 */

/** The kind of segment this writes. The same string as `segments.kind`, and what a clock band names. */
export const STORY_KIND = 'story';

/** What `segments.writer` records for anything written here. */
export const STORY_WRITER = 'deterministic';

/**
 * What the model is told a story break IS.
 *
 * `stories: 'told'` is the whole of it: the story is not material for a break about something else,
 * it is what this break is, so the prompt drops the optionality that the talk break's version
 * carries.
 *
 * The rest is `NEWS_SHAPE`'s posture with one exception argued below. `showsPrevious: false` because
 * a story is not a back-announce and a model shown the record behind it will open by announcing it.
 * The record COMING UP is still shown, for the same reason a bulletin gets it: handing back to the
 * music is the continuity this break owes the hour. `showsFacts: false` because a note about the
 * record beside an anecdote about the presenter is an invitation to weld the two together, which is
 * the one failure this whole feature has to avoid.
 *
 * The exception is `showsNotebook`, left ON where a bulletin turns it off. A bulletin withholds it
 * because a model handed material while reporting the news reads the material out; here the material
 * is the point, and what this character has said before is the same kind of thing as what happened
 * to it. A story told in the voice of somebody who has been on this station for years is exactly the
 * ask.
 */
export const STORY_SHAPE: BreakPromptShape = {
    job: 'You tell one short story about yourself, on air, between records. It is read aloud exactly as you write it.',
    showsPrevious: false,
    showsFacts: false,
    stories: 'told',
    // A story is the presenter being a person for forty-five seconds, which is what a reaction is
    // for. See `BreakPromptShape.allowsCues`.
    allowsCues: true,
    // Offered, and it used to be refused here. The old argument was that a rung buys a character room
    // on a break that would otherwise be a link and this kind is already the room, so a latitude
    // raising the ceiling further would mean an `unleashed` character's stories ran to a length the
    // settings page never mentions.
    //
    // What that missed is that `maxWordsFor` takes the LARGER of the two, and `rotation.storyWords`
    // defaults to 120 against the top rung's 100: at any story ceiling the station would plausibly
    // set, the rung changes the length by nothing at all. What it changes is the register, which is
    // the whole of what an operator was asking for — a character whose links are unleashed and whose
    // stories about its own life are told in careful broadcast English was two characters.
    //
    // The one case where it does move the ceiling is an operator who has pulled `rotation.storyWords`
    // down near its floor of 40. There the rung lifts a story back to 70 or 100 words, which is the
    // same bargain the talk break already makes and is visible on the persona page rather than
    // nowhere.
    allowsLatitude: true,
    opening: () =>
        'Tell the story below as you would tell it on air: in your own words, out loud, to one person listening. ' +
        'Start in the middle of it rather than announcing that you are about to tell a story, and finish it — ' +
        'a story that trails off is worse than one you never started.',
    rules: [
        'It happened to YOU. Tell it as your own, and do not turn it into a fact about a record, an artist, or anybody real: ' +
            'nothing in it is something the station is claiming to know.',
        'Land it. One story, one ending, and then hand back to the record coming up in a line. Do not start a second one, and do not ' +
            'fill the end with atmosphere — when the story is over, you are done.',
    ],
    // The first rule word for word, because it is the one thing no amount of room excuses: a story
    // that turns into a claim about a real record is the failure this whole kind is written against,
    // and a rule quietly dropped from a prompt the station still refuses over would be the trick
    // question every guard here avoids.
    //
    // The second is turned around only where it asked for restraint. "Do not fill the end with
    // atmosphere" and "take the thought as far as it goes" are the same slot said twice, so what
    // survives is the half about landing it: one story, one ending, and a hand back to the record.
    latitudeRules: [
        'It happened to YOU. Tell it as your own, and do not turn it into a fact about a record, an artist, or anybody real: ' +
            'nothing in it is something the station is claiming to know.',
        'Tell the whole of it. Take the detour if there is one, say the part you would normally leave out, and do not tidy it up on the ' +
            'way. It is still ONE story with an ending: land it, hand back to the record coming up, and do not start a second.',
    ],
};

@Injectable()
export class StoryBreakWriter extends BreakWriter {
    readonly kind = STORY_KIND;
    readonly name = STORY_WRITER;

    /** Which story was read, for the record. See {@link detailOfLastWrite}. */
    private lastStory?: string;

    constructor(private readonly logger: Logger) {
        super();
    }

    detailOfLastWrite(): WriteDetail | undefined {
        return this.lastStory === undefined ? undefined : { source: this.lastStory };
    }

    async write(request: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        this.lastStory = undefined;

        const story = request.story;
        if (story === undefined) {
            // The ONE decline an operator has to be able to act on, exactly as an empty bulletin is:
            // a clock asking for a story from a character that has none is a slot passed over every
            // time it comes round, and the registry's generic sentence would not say which.
            this.logger.info('director: a story break had no story to tell, so the station passed over the slot');
            return undefined;
        }

        this.lastStory = story.title;

        return {
            // The operator's own sentences, and its details behind them. Joined rather than composed:
            // there is no phrasing to fit them into, which is this writer's whole difference.
            script: [story.story.trim(), ...story.details.map(detail => detail.trim())].filter(part => part.length > 0).join(' '),
            // Named for the story rather than the kind, so a running order and a script history can
            // be read without opening either. `persona_stories.title` exists for this and for the
            // console; it is never spoken.
            label: story.title,
            // Nothing here says a word about what plays next, so nothing to drift: the model binding
            // in front of this is told to hand back, and stamps its own claim.
            claimsNext: false,
        };
    }
}
