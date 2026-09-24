import { describe, expect, it } from 'vitest';

import { stationPromptSettings } from '../../../src/modules/director/prompt.settings.js';
import { STREAM_KEYS } from '../../../src/modules/stream/stream.settings.js';
import { settingsConfig } from '../../utils/settings.config.js';

describe('stationPromptSettings', () => {
    it('carries no language for an English station, so its prompt is unchanged', () => {
        expect(stationPromptSettings(settingsConfig().config, {})).not.toHaveProperty('language');
        expect(stationPromptSettings(settingsConfig({ [STREAM_KEYS.language]: 'en-GB' }).config, {})).not.toHaveProperty('language');
    });

    it('carries the language of a station that broadcasts in another one', () => {
        expect(stationPromptSettings(settingsConfig({ [STREAM_KEYS.language]: 'de' }).config, {}).language).toBe('de');
    });

    it('reads the setting per call, so a change lands on the next break', () => {
        const { config, set } = settingsConfig();
        expect(stationPromptSettings(config, {}).language).toBeUndefined();

        set(STREAM_KEYS.language, 'fr');
        expect(stationPromptSettings(config, {}).language).toBe('fr');
    });
});
