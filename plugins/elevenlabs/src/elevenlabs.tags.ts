/**
 * The station's cues and deliveries, written as the audio tags a model performs.
 *
 * A cue arrives inside the text in the station's spelling (`[laugh]`), and ElevenLabs is told in its
 * own (`[laughs]`); a delivery arrives beside the text and becomes a tag at the head of it. The host
 * has already stripped every cue this plugin did not claim, so the strip here is a second line rather
 * than the first: a model changed between the claim and the call would otherwise read `[laugh]` out
 * loud.
 */

import { SPEECH_CUES, withoutCues, type SpeechCue, type SpeechDelivery } from '@deadair/plugin-sdk';
import type { Tags } from './elevenlabs.models.js';

/** The text as the model should receive it. */
export function performed(text: string, delivery: SpeechDelivery | undefined, tags: Tags | undefined): string {
    if (tags === undefined) return withoutCues(text);

    const claimed = SPEECH_CUES.filter(cue => tags.cues[cue] !== undefined);
    const kept = withoutCues(text, claimed);
    const spoken =
        claimed.length === 0 ? kept : kept.replace(cuePattern(claimed), (_match, cue: string) => tags.cues[cue.toLowerCase() as SpeechCue]!);

    const lead = delivery === undefined ? undefined : tags.deliveries[delivery];
    return lead === undefined ? spoken : `${lead} ${spoken}`;
}

/** Longest first, for the SDK's reason: `clear throat` must not lose to a shorter cue. */
const cuePattern = (cues: readonly SpeechCue[]): RegExp =>
    new RegExp(`\\[(${[...cues].sort((left, right) => right.length - left.length).join('|')})\\]`, 'gi');
