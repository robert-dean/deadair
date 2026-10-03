/**
 * What each ElevenLabs model can do, written down rather than asked for.
 *
 * ## Why a table and not `GET /v1/models`
 *
 * Because the part that matters is not in the answer. That route reports a model's languages and
 * its character ceiling, and says nothing about which `voice_settings` it reads, so the question
 * this file exists for — may a row's `speed` be sent here? — has no source but the documentation.
 * One table for all of it keeps a model's traits in one place rather than half fetched and half
 * typed.
 *
 * It is an ALLOWLIST in `plugins/chatterbox`'s sense: a model id that is not in it is still spoken
 * by, since the operator typed it and ElevenLabs may have released it since, but it is credited
 * with nothing beyond the two settings every model reads.
 */

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
}

const ALL_SETTINGS: readonly VoiceSettingKey[] = ['stability', 'similarity_boost', 'style', 'speed'];
const STABILITY_AND_SIMILARITY: readonly VoiceSettingKey[] = ['stability', 'similarity_boost'];

/**
 * The models worth offering, best first.
 *
 * `eleven_turbo_v2_5` is left out because ElevenLabs deprecated it in favour of `eleven_flash_v2_5`;
 * a station already pointed at it still speaks, as any unlisted model does.
 */
export const MODELS = {
    eleven_v4: { label: 'Eleven v4', maxCharacters: 10_000, settings: STABILITY_AND_SIMILARITY },
    eleven_v4_turbo: { label: 'Eleven v4 Turbo', maxCharacters: 10_000, settings: STABILITY_AND_SIMILARITY },
    eleven_v3: { label: 'Eleven v3', maxCharacters: 5_000, settings: ALL_SETTINGS },
    eleven_multilingual_v2: { label: 'Eleven Multilingual v2', maxCharacters: 10_000, settings: ALL_SETTINGS },
    eleven_flash_v2_5: { label: 'Eleven Flash v2.5', maxCharacters: 40_000, settings: ALL_SETTINGS },
} as const satisfies Record<string, ModelTraits>;

export type KnownModel = keyof typeof MODELS;

/** The newest and most expressive model, and the one a fresh install speaks with. */
export const DEFAULT_MODEL: KnownModel = 'eleven_v4';

/** What an unlisted model is credited with: the two settings every model reads, and nothing else. */
const UNKNOWN_MODEL: Omit<ModelTraits, 'label' | 'maxCharacters'> = { settings: STABILITY_AND_SIMILARITY };

/** A model's traits, or `undefined` for one this table does not know. */
export const traitsOf = (model: string): ModelTraits | undefined => (Object.hasOwn(MODELS, model) ? MODELS[model as KnownModel] : undefined);

/** The settings a model reads, falling back to the pair every model reads. */
export const settingsOf = (model: string): readonly VoiceSettingKey[] => traitsOf(model)?.settings ?? UNKNOWN_MODEL.settings;
