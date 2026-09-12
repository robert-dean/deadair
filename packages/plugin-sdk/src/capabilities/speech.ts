/**
 * The `speech` capability. A speech plugin takes a line of text and answers
 * with audio: the station saying its own name, reading a back-announce, or
 * delivering a whole talk break.
 *
 * ## The audio comes back as a stream, not as a value
 *
 * {@link SpeechPluginInstance.speak} returns a stream rather than bytes, and
 * the usual implementation is to hand back the `host.fetch` body of the engine
 * call unchanged. So the audio is never held whole anywhere, and a long script
 * costs a chunk of memory rather than a file of it.
 *
 * Cancellation is the host's `cancel()` on that stream, and forwarding a
 * `host.fetch` body propagates it to the socket for you. There is nothing to
 * implement.
 *
 * ## A voice is a name the station chose, not one your engine knows
 *
 * {@link SpeechRequest.voice} is an opaque id from the station's side of the
 * fence — `host`, `newsreader` — and mapping it to whatever your engine actually
 * takes is your job, out of your own config. The host never reads it, never
 * validates it, and never stores anything engine-specific.
 *
 * The indirection is the point, and it was paid for once already: it is what
 * lets the same station voice be a named preset on one engine and a cloned
 * reference clip on another, so changing engine does not rewrite every persona.
 * Keep engine-specific tuning (an expressiveness dial, a similarity weight)
 * inside your own config where it belongs, rather than asking the host to carry
 * knobs only you understand.
 *
 * ## A delivery is a word the station chose, too
 *
 * The one thing about HOW a line is read that the host does carry is
 * {@link SpeechRequest.delivery}: `hushed` or `frantic`, in the station's words
 * and never as a number. That is the same bargain as a voice and a cue. The host
 * says what it wants in a vocabulary every engine can be asked in, and each plugin
 * translates it into whatever its engine has, whether that is an expressiveness
 * dial, a speed, a style preset or nothing at all. The numbers stay in your config.
 *
 * Every shape here is JSON-safe.
 */

import type { PluginLifecycle } from '../plugin.lifecycle.js';

/**
 * The things a presenter DOES that are not words, as the station names them.
 *
 * A cue rides inside {@link SpeechRequest.text} rather than beside it, written
 * `[laugh]`, which is why nothing in this interface carries one. That is not a
 * shortcut: a laugh happens at a place in a sentence, and a field would have to
 * invent a way to say where.
 *
 * The vocabulary is the STATION's and mapping it is yours, exactly as for
 * {@link SpeechVoice}. A laugh is something a presenter does; whether your engine
 * spells it `[laugh]`, `<laugh>` or not at all is engine business, and the host
 * never learns which.
 *
 * ## Eight, and the second four are not for the presenter
 *
 * This was four, and its stated reason for stopping there was that "a cough or a
 * sniff reads as illness rather than as delivery". That is right about somebody
 * being paid to talk and exactly wrong about somebody on the end of a telephone,
 * where the throat-clear IS the realism — so the vocabulary is wider now and WHO
 * may use which is the host's business rather than this list's.
 *
 * The host keeps the first four. A caller in a production may use all eight. Both
 * sets live app-side, because they are permissions rather than capabilities, and
 * a plugin has no way to know which of its speakers is which.
 *
 * **Widening this list without narrowing the offer is how the presenter starts
 * coughing.** Whatever reads a script back has to be told which of these were
 * actually on offer to the person who wrote it, rather than reaching for the whole
 * vocabulary.
 *
 * Still chosen rather than copied from an engine: `shush` is one this list does
 * not take, because shushing is aimed AT somebody in the room. That is a piece of
 * business rather than a way of delivering a line.
 *
 * **Answer {@link SpeechPluginInstance.listCues} honestly and the rest is free.**
 * The host strips every cue you do not claim before it calls {@link
 * SpeechPluginInstance.speak}, so a plugin that implements nothing here never sees
 * one, and the failure where an engine READS the word "laugh" out loud cannot
 * happen. Claiming one you cannot perform is the only way to break that.
 */
export const SPEECH_CUES = ['laugh', 'chuckle', 'sigh', 'gasp', 'cough', 'clear throat', 'sniff', 'groan'] as const;

/** One of {@link SPEECH_CUES}. */
export type SpeechCue = (typeof SPEECH_CUES)[number];

/** Every cue written into a script, in the order they appear, with repeats. */
export function cuesIn(text: string): SpeechCue[] {
    return [...text.matchAll(cuePattern())].map(match => match[1]!.toLowerCase() as SpeechCue);
}

/**
 * The same text with cues removed, or with only some of them kept.
 *
 * `keep` is the set to LEAVE, so the default of none is "take them all out" — the
 * safe direction, and the one an engine that has never heard of a cue wants. A
 * removal closes the space it leaves behind, because `word [laugh] word` would
 * otherwise render with a double space that {@link SPEECH_CUES}' own consumers
 * would have to know to tidy.
 *
 * Only the four are touched. Anything else in brackets is somebody else's problem
 * and stays exactly as it arrived: this is not a bracket stripper.
 */
export function withoutCues(text: string, keep: Iterable<SpeechCue> = []): string {
    const kept = new Set<string>([...keep]);

    return text
        .replace(cuePattern(), (match, cue: string) => (kept.has(cue.toLowerCase()) ? match : ' '))
        .replace(/[^\S\n]{2,}/g, ' ')
        .replace(/[^\S\n]+([.,!?;:])/g, '$1')
        .trim();
}

/**
 * A fresh matcher every call, because a `g` flag carries `lastIndex` between them.
 *
 * **Longest form first**, which is `applyPronunciations`' rule one layer up and became
 * load-bearing the moment `clear throat` joined the list: an alternation takes the
 * earliest branch that matches at a position, so a shorter cue that is a prefix of a
 * longer one would claim it and leave the rest as text an engine reads out.
 */
const cuePattern = (): RegExp => new RegExp(`\\[(${[...SPEECH_CUES].sort((left, right) => right.length - left.length).join('|')})\\]`, 'gi');

/**
 * How a whole line is read, as the station names it.
 *
 * Two, and the middle is deliberately not one of them: a request with no delivery is the voice's own
 * ordinary reading, which is what nearly every line should be. A third word for "ordinary" would be a
 * second way to ask for nothing, and would key a second cached preview of identical audio.
 *
 * The vocabulary is the STATION's and translating it is yours, exactly as for {@link SPEECH_CUES}.
 * `hushed` is quieter, slower, closer to the microphone; `frantic` is urgent, faster, barely holding
 * on. Whether your engine gets there with an expressiveness dial, a speed, a style token or a
 * different reference clip is engine business, and the host never learns which.
 *
 * ## Why a word and not a number
 *
 * A number is a promise about one engine's scale. `exaggeration: 0.9` means something to one family of
 * models and nothing to the next, so a station that asked for it would be tied to the engine it was
 * built against, which is the thing the voice indirection exists to prevent. A word survives a change
 * of engine. The numbers it becomes live in each plugin's own config, beside the voice they tune.
 *
 * ## Claim only what you can perform
 *
 * {@link SpeechPluginInstance.listDeliveries} says which of these your engine can do RIGHT NOW, and the
 * host drops any delivery you did not claim before it calls {@link SpeechPluginInstance.speak}. So a
 * plugin that implements nothing here never sees one, and the writer is never offered a delivery the
 * engine would ignore. Claiming one you cannot perform is the only way to break it.
 */
export const SPEECH_DELIVERIES = ['hushed', 'frantic'] as const;

/** One of {@link SPEECH_DELIVERIES}. */
export type SpeechDelivery = (typeof SPEECH_DELIVERIES)[number];

/** Whether a value is one of {@link SPEECH_DELIVERIES}, exactly as written. */
export function isSpeechDelivery(value: unknown): value is SpeechDelivery {
    return typeof value === 'string' && (SPEECH_DELIVERIES as readonly string[]).includes(value);
}

/** One thing to say. */
export interface SpeechRequest {
    /**
     * The words, already final. Nothing downstream rewrites them, so any
     * pronunciation fixing your engine needs is yours to apply.
     */
    text: string;

    /**
     * Which station voice to use, or absent for this plugin's default.
     *
     * Opaque, and a name the operator chose. An id you have no mapping for
     * should fall back to your default rather than fail: a missing voice is
     * worth a `logger.warn` and a rendered line, not a silent station.
     */
    voice?: string;

    /**
     * The audio format the caller would prefer, as a bare extension (`mp3`).
     *
     * A hint, and the weakest thing in this interface: answer with whatever you
     * actually produced in {@link SpeechHandle.mime} and the host will believe
     * that instead. Ignore it entirely if your engine emits one format.
     */
    format?: string;

    /**
     * How to read the whole line, or absent for the voice's own ordinary reading.
     *
     * Only ever one you claimed through {@link SpeechPluginInstance.listDeliveries}: the host drops the
     * rest before this call. Translate it into your engine's own controls, relative to whatever the
     * voice already sounds like, so a voice that is intense at rest is still more intense than its
     * neighbours when hushed. See {@link SPEECH_DELIVERIES}.
     */
    delivery?: SpeechDelivery;
}

/** The audio for one {@link SpeechPluginInstance.speak}, and what it is. */
export interface SpeechHandle {
    /**
     * What the bytes ARE, as a media type (`audio/mpeg`).
     *
     * Load-bearing rather than decoration: it is what the host stores the audio
     * under and what it later serves, and both consumers of station audio (a
     * browser's `<audio>`, which does not sniff, and the playout engine, which
     * picks its decoder from the content type) go by that header rather than by
     * the bytes. A wav announced as `audio/mpeg` fails as silence rather than
     * as an error anybody sees.
     */
    mime: string;

    /**
     * The audio.
     *
     * The host reads it to the end or cancels it, and either one releases
     * whatever is underneath. Usually a `host.fetch` body forwarded unchanged,
     * which is what makes that true for free.
     */
    audio: ReadableStream<Uint8Array>;
}

/** One voice this plugin can be asked for. */
export interface SpeechVoice {
    /** The id to pass back as {@link SpeechRequest.voice}. */
    id: string;

    /** What the console calls it. */
    label: string;

    /** Anything worth knowing when choosing between them: an accent, a register. */
    description?: string;

    /**
     * An opaque token that changes when what this voice SOUNDS LIKE changes.
     *
     * The host does not interpret it, parse it, store it or show it. It uses it
     * for one thing: keying the cached preview at `GET /voices/{id}/sample`, so
     * that remapping `host` from one engine voice to another — or nudging its
     * speed, or swapping its reference clip — mints a new key and the next
     * preview renders instead of playing the old voice back.
     *
     * That was already the claim `VoiceSampleStore` made in its own doc comment
     * and it was not true: the key held the STATION voice id, which is exactly
     * the part that does not change when an operator edits the mapping under it.
     * The fence is intact because this stays opaque — whatever string identifies
     * a rendering to you is the right value, and `engineVoice@speed` is a fine
     * one.
     *
     * Absent is normal. A plugin that omits it keys previews as it always did,
     * which is correct for one whose voices cannot be reconfigured.
     */
    spec?: string;
}

/** A plugin that can speak. */
export interface SpeechPluginInstance extends PluginLifecycle {
    /**
     * Start turning `request.text` into audio.
     *
     * May return before any audio exists, because the handle carries a stream
     * and not the bytes, so a slow engine shows up as a slow first chunk rather
     * than as a slow `speak`.
     *
     * @throws {PluginError} `config` when the plugin is not set up enough to try
     *   (no server address), `upstream` when the engine refused or answered with
     *   something that is not audio, `timeout` when it did not answer at all.
     */
    speak(request: SpeechRequest): Promise<SpeechHandle>;

    /**
     * The voices this plugin can be asked for, for a console that has to draw a
     * list.
     *
     * Optional, because a plugin with exactly one voice is a legitimate thing to
     * be and should not have to describe it. Absent is normal, not broken.
     */
    listVoices?(): Promise<SpeechVoice[]>;

    /**
     * Which of {@link SPEECH_CUES} this plugin can perform RIGHT NOW.
     *
     * Optional, and absent means none: an engine that only reads words is the
     * ordinary case and should not have to say so. That default is what makes this
     * safe to add — the host strips what you do not claim, so silence costs a
     * plugin nothing and risks nothing.
     *
     * **Answer from what the engine currently IS, not from what this plugin was
     * built against.** On the engine this was written for, cues belong to the
     * loaded MODEL rather than to the server, so swapping the model takes them away
     * with no plugin change involved — which is exactly the case a manifest flag
     * would get wrong, and it would get it wrong by having the station perform to
     * an engine that reads the word out.
     *
     * Called on the path that writes a break as well as the one that speaks it, so
     * keep it cheap and answer empty rather than throwing when the engine cannot be
     * reached: a station that cannot ask should write a script with no cues in it,
     * not fail to write one.
     */
    listCues?(): Promise<readonly SpeechCue[]>;

    /**
     * Which of {@link SPEECH_DELIVERIES} this plugin can perform RIGHT NOW.
     *
     * Optional, and absent means none, for the reason {@link listCues} gives: most engines have no
     * such control, and saying nothing costs a plugin nothing because the host drops what you do not
     * claim.
     *
     * The same three rules as for cues, too. Answer from what the engine currently IS, since on some
     * engines the control belongs to the loaded model rather than to the server. Keep it cheap,
     * because it is asked on the path that writes a break. And answer empty rather than throwing when
     * the engine cannot be reached, because a station that cannot ask should write an ordinary
     * reading rather than fail to write one.
     */
    listDeliveries?(): Promise<readonly SpeechDelivery[]>;
}
