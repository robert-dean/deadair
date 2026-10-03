/**
 * What each ElevenLabs model can do, written down rather than asked for.
 *
 * ## Why a table and not `GET /v1/models`
 *
 * Because most of what matters is not in the answer. That route reports a model's languages and
 * its character ceiling, and says nothing about which `voice_settings` it reads or which audio tags
 * it performs, so those have no source but the documentation. The languages ARE read from it (see
 * `listLanguages`), since ninety of them are not worth copying by hand; the ceiling is copied here
 * because `listLimits` is asked on the render path and must not cost a request.
 *
 * It is an ALLOWLIST in `plugins/chatterbox`'s sense: a model id that is not in it is still spoken
 * by, since the operator typed it and ElevenLabs may have released it since, but it is credited
 * with nothing beyond the two settings every model reads.
 */

import type { SpeechCue, SpeechDelivery } from '@deadair/plugin-sdk';

/** The `voice_settings` keys a row can set, in the API's own spelling. */
export type VoiceSettingKey = 'stability' | 'similarity_boost' | 'style' | 'speed';

export interface ModelTraits {
    /** What the console calls it. */
    label: string;

    /** The most characters one request may carry, from the models page. */
    maxCharacters: number;

    /**
     * The settings this model reads.
     *
     * A setting is sent only where it is listed, on `plugins/rhapsode`'s rule about dials: v4
     * documents that it has "Style and Speed sliders … not available", and a value the model
     * ignores is a row an operator tuned for nothing, so the plugin does not pretend to send it.
     */
    settings: readonly VoiceSettingKey[];

    /**
     * How this model is told to laugh or to whisper, or absent for a model that performs no tags and
     * would read `[laughs]` out loud.
     */
    tags?: Tags;

    /**
     * Whether `language_code` may be sent. The API refuses one a model does not support, and a
     * refused line is a lost break, so this is true only where the documentation says so.
     */
    languageCode: boolean;
}

/**
 * The audio tags one model performs, keyed by the station's own words.
 *
 * Only cues with a tag ElevenLabs LISTS for the model are here: a cue claimed and then read aloud as
 * the word in brackets is the one failure `listCues` can cause. A delivery is a tag at the head of
 * the whole line, which is where a tag governs everything after it.
 */
export interface Tags {
    cues: Partial<Readonly<Record<SpeechCue, string>>>;
    deliveries: Partial<Readonly<Record<SpeechDelivery, string>>>;
}

/**
 * The v4 tags, from ElevenLabs' list for v4: `[laughs]`, `[sighs]`, `[gasps]` and `[clears throat]`
 * under reactions, and `[hushed]` and `[rushed]` under delivery and pacing. Chuckle, cough, sniff and
 * groan have no listed tag, so the host strips them rather than this plugin guessing a spelling.
 */
const V4_TAGS: Tags = {
    cues: { laugh: '[laughs]', sigh: '[sighs]', gasp: '[gasps]', 'clear throat': '[clears throat]' },
    deliveries: { hushed: '[hushed]', frantic: '[rushed]' },
};

/** v3's documented tags: the same reactions, and `[whispers]` and `[excited]` for the two readings. */
const V3_TAGS: Tags = {
    cues: { laugh: '[laughs]', sigh: '[sighs]', gasp: '[gasps]', 'clear throat': '[clears throat]' },
    deliveries: { hushed: '[whispers]', frantic: '[excited]' },
};

const ALL_SETTINGS: readonly VoiceSettingKey[] = ['stability', 'similarity_boost', 'style', 'speed'];
const STABILITY_AND_SIMILARITY: readonly VoiceSettingKey[] = ['stability', 'similarity_boost'];

/**
 * The models worth offering, best first.
 *
 * `eleven_turbo_v2_5` is left out because ElevenLabs deprecated it in favour of `eleven_flash_v2_5`;
 * a station already pointed at it still speaks, as any unlisted model does.
 */
export const MODELS = {
    eleven_v4: { label: 'Eleven v4', maxCharacters: 10_000, settings: STABILITY_AND_SIMILARITY, tags: V4_TAGS, languageCode: false },
    eleven_v4_turbo: { label: 'Eleven v4 Turbo', maxCharacters: 10_000, settings: STABILITY_AND_SIMILARITY, tags: V4_TAGS, languageCode: false },
    eleven_v3: { label: 'Eleven v3', maxCharacters: 5_000, settings: ALL_SETTINGS, tags: V3_TAGS, languageCode: false },
    eleven_multilingual_v2: { label: 'Eleven Multilingual v2', maxCharacters: 10_000, settings: ALL_SETTINGS, languageCode: false },
    eleven_flash_v2_5: { label: 'Eleven Flash v2.5', maxCharacters: 40_000, settings: ALL_SETTINGS, languageCode: true },
} as const satisfies Record<string, ModelTraits>;

export type KnownModel = keyof typeof MODELS;

/** The newest and most expressive model, and the one a fresh install speaks with. */
export const DEFAULT_MODEL: KnownModel = 'eleven_v4';

/** What an unlisted model is credited with: the two settings every model reads, and nothing else. */
const UNKNOWN_MODEL: Omit<ModelTraits, 'label' | 'maxCharacters'> = { settings: STABILITY_AND_SIMILARITY, languageCode: false };

/** The tags a model performs, or `undefined` for one that performs none or is not in the table. */
export const tagsOf = (model: string): Tags | undefined => traitsOf(model)?.tags;

/** Whether `language_code` may be sent to a model. */
export const takesLanguageCode = (model: string): boolean => traitsOf(model)?.languageCode ?? UNKNOWN_MODEL.languageCode;

/** A model's traits, or `undefined` for one this table does not know. */
export const traitsOf = (model: string): ModelTraits | undefined => (Object.hasOwn(MODELS, model) ? MODELS[model as KnownModel] : undefined);

/** The settings a model reads, falling back to the pair every model reads. */
export const settingsOf = (model: string): readonly VoiceSettingKey[] => traitsOf(model)?.settings ?? UNKNOWN_MODEL.settings;
