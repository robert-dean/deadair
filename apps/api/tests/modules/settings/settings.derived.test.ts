// Three settings whose help text says "leave empty to …", and this is where the sentence becomes a
// value the console can show. The property that is easy to break and expensive to get wrong: every
// entry is what an EMPTY box works out to, so the stored value is skipped rather than preferred. Ask
// the resolvers the rest of the app reads and each one answers with the operator's own value, which
// would put a watermark under a field repeating what is already typed in it.

import { describe, expect, it } from 'vitest';

import { derivedSettings } from '../../../src/modules/settings/settings.derived.js';
import { STREAM_KEYS } from '../../../src/modules/stream/stream.settings.js';
import { CLOCK_KEYS } from '../../../src/modules/director/clock.words.js';
import { settingsConfig } from '../../utils/settings.config.js';

describe('derivedSettings', () => {
    it('answers the deployed address for a public URL nobody set', () => {
        const { config } = settingsConfig({ SPA_BASE_URL: 'https://radio.test/' });

        // Trailing slash trimmed, because it is an origin to build on rather than an address to show.
        expect(derivedSettings(config)[STREAM_KEYS.publicUrl]).toBe('https://radio.test');
    });

    it('falls back to the API address, as the resolver behind it does', () => {
        const { config } = settingsConfig({ APP_BASE_URL: 'http://192.168.1.10:8080' });

        expect(derivedSettings(config)[STREAM_KEYS.publicUrl]).toBe('http://192.168.1.10:8080');
    });

    it('reports what clearing the public URL would fall back to, not what is in force', () => {
        // The whole point of the map. `resolvePublicUrl` prefers the stored setting, so asking it
        // here would answer `https://listen.test` and call it a derivation.
        const { config } = settingsConfig({ [STREAM_KEYS.publicUrl]: 'https://listen.test', SPA_BASE_URL: 'https://radio.test' });

        expect(derivedSettings(config)[STREAM_KEYS.publicUrl]).toBe('https://radio.test');
    });

    it('leaves the public URL out entirely when nothing in the environment names one', () => {
        // Absent rather than empty: an empty string is not something to put under a field, and the
        // console reads a missing key as "nothing to say".
        expect(STREAM_KEYS.publicUrl in derivedSettings(settingsConfig().config)).toBe(false);
    });

    it('takes the hostname from the public URL in force, stored or derived', () => {
        // This one derives from another SETTING rather than from the environment, so here the
        // operator's own value is the right input: it is what Icecast will be told.
        const stored = settingsConfig({ [STREAM_KEYS.publicUrl]: 'https://listen.test/', SPA_BASE_URL: 'https://radio.test' });
        expect(derivedSettings(stored.config)[STREAM_KEYS.hostname]).toBe('listen.test');

        const derivedUrl = settingsConfig({ SPA_BASE_URL: 'https://radio.test' });
        expect(derivedSettings(derivedUrl.config)[STREAM_KEYS.hostname]).toBe('radio.test');
    });

    it('ignores a hostname somebody stored, and says localhost when there is nothing to go on', () => {
        // Both halves of the same claim: the field reports what clearing it would give, and what it
        // would give is what Icecast really does call itself. Seeing `localhost` under an empty box
        // is how the operator finds out, which is the failure this whole thing came from.
        const { config } = settingsConfig({ [STREAM_KEYS.hostname]: 'stream.listen.test' });

        expect(derivedSettings(config)[STREAM_KEYS.hostname]).toBe('localhost');
    });

    it('answers this machine’s zone for a station that named none, whatever is stored', () => {
        const { config } = settingsConfig({ [CLOCK_KEYS.timezone]: 'Pacific/Auckland' });

        expect(derivedSettings(config)[CLOCK_KEYS.timezone]).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    });

    it('says nothing about a setting whose empty is simply empty', () => {
        // The map is the three derivations and not a second copy of the defaults. A location left
        // empty advertises none, and a watermark there would invent a fallback that does not exist.
        const { config } = settingsConfig({ SPA_BASE_URL: 'https://radio.test' });

        expect(STREAM_KEYS.location in derivedSettings(config)).toBe(false);
    });
});
