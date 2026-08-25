/**
 * What each speaker in a production is allowed to PERFORM, as against say.
 *
 * `SPEECH_CUES` is the vocabulary and this is the permission, and they are two things for a reason
 * the SDK's own note gives: widening the vocabulary without narrowing the offer is how a presenter
 * starts coughing. The host keeps the four it always had. A caller gets the rest.
 *
 * ## Why a caller gets more, which is the whole of this file
 *
 * The four were chosen with a stated reason — "a cough or a sniff reads as illness rather than as
 * delivery" — and that is right about somebody being paid to talk into a microphone in a room built
 * for it. It is exactly wrong about somebody on the end of a telephone, where the throat-clear IS
 * the realism: a caller who never sniffs, never coughs and never groans is a second presenter with a
 * different sheet.
 *
 * ## Both are still intersected with what the engine can do
 *
 * Neither of these is a promise. `SpeechService.cues()` answers what the installed engine actually
 * performs, and the offer is the intersection — so a station on an engine that performs none gets a
 * prompt byte-identical to one built before any of this existed, which is the same bargain
 * `break.prompt.ts` already keeps.
 */

import type { SpeechCue } from '@deadair/plugin-sdk';
import { PRESENTER_CUES } from '#modules/director/break.prompt.js';
import type { CastRole } from './production.cast.js';

/**
 * What somebody who phoned in may do.
 *
 * The presenter's four plus the four that only make sense on a phone. `shush` is not among them and
 * is not in the vocabulary either — it is aimed at somebody in the room, which is a piece of
 * business rather than a way of delivering a line.
 */
export const CALLER_CUES: readonly SpeechCue[] = [...PRESENTER_CUES, 'cough', 'clear throat', 'sniff', 'groan'];

/**
 * What this speaker may perform, out of what the engine can do.
 *
 * An intersection rather than a fallback, because both halves are vetoes: a caller is not talked
 * into a cough by a capable engine, and a capable engine does not hand one to the presenter.
 */
export function cuesFor(role: CastRole | undefined, engine: readonly SpeechCue[]): readonly SpeechCue[] {
    const allowed = role === 'caller' ? CALLER_CUES : PRESENTER_CUES;

    return allowed.filter(cue => engine.includes(cue));
}
