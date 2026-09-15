import { describe, expect, it } from 'vitest';

import { optionsFrom, settingsFor, SHOW_EVERYTHING } from '../../src/actions/now.playing.options.js';

describe('optionsFrom', () => {
    it('shows everything for a key that was never configured', () => {
        expect(optionsFrom({})).toEqual(SHOW_EVERYTHING);
        expect(optionsFrom(undefined)).toEqual(SHOW_EVERYTHING);
    });

    it('hides only what is explicitly turned off', () => {
        expect(optionsFrom({ showProgress: false })).toEqual({ progress: false, title: true });
        expect(optionsFrom({ showTitle: false })).toEqual({ progress: true, title: false });
        expect(optionsFrom({ showTitle: 'false', showProgress: 0 })).toEqual(SHOW_EVERYTHING);
    });

    it('reads back what it saves', () => {
        const options = { progress: false, title: true };
        expect(optionsFrom(settingsFor(options))).toEqual(options);
    });
});
